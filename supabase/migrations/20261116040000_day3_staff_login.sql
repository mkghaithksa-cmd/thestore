-- =====================================================================
-- Ghaith platform — Day 3: staff login
--
-- Staff sign in with phone + a 6-digit code set by the manager.
--   * The code is stored only as a bcrypt hash in private.staff_credentials.
--   * Staff auth users have NO password and NO phone in Supabase Auth, so
--     the only way in is the staff-login Edge Function, which calls
--     staff_verify_code() (5 wrong codes -> locked for 15 minutes).
--   * Changing a code or disabling a member bumps sessions_valid_after:
--     older tokens lose staff rights immediately, and their refresh
--     sessions are deleted.
--   * Staff management goes through the functions below (they enforce the
--     locked system-admin rules); every change lands in audit_log.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.staff_credentials (
  user_id uuid primary key references public.staff_profiles (user_id) on delete cascade,
  code_hash text not null,
  updated_at timestamptz not null default now()
);

alter table private.staff_credentials enable row level security;
revoke all on private.staff_credentials from public, anon, authenticated;

alter table public.staff_profiles
  add column sessions_valid_after timestamptz not null default 'epoch';

-- Role and active flag only change through the functions below.
revoke update (role_id, is_active) on public.staff_profiles from authenticated;

-- Staff auth users (app_metadata.kind = 'staff') never get a customer row.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.raw_app_meta_data ->> 'kind', '') = 'staff' then
    return new;
  end if;
  if new.phone is not null and new.phone <> '' then
    insert into public.customers (id, phone)
    values (new.id, '+' || ltrim(new.phone, '+'))
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Permission helpers: also require a token issued after the last
-- code change / disable (sessions_valid_after).
-- ---------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_profiles s
    join public.roles r on r.id = s.role_id
    where s.user_id = (select auth.uid())
      and s.is_active and r.is_active
      and coalesce(((select auth.jwt()) ->> 'iat')::bigint, 0)
          >= floor(extract(epoch from s.sessions_valid_after))
  );
$$;

create or replace function public.has_permission(page text, action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case action
      when 'view'    then rp.can_view
      when 'add'     then rp.can_add
      when 'edit'    then rp.can_edit
      when 'approve' then rp.can_approve
      else false
    end
    from public.staff_profiles s
    join public.roles r on r.id = s.role_id and r.is_active
    join public.role_permissions rp on rp.role_id = s.role_id and rp.page = has_permission.page
    where s.user_id = (select auth.uid())
      and s.is_active
      and coalesce(((select auth.jwt()) ->> 'iat')::bigint, 0)
          >= floor(extract(epoch from s.sessions_valid_after))
  ), false);
$$;

-- The signed-in staff member's permission matrix (empty for non-staff).
create function public.my_permissions()
returns table (page text, can_view boolean, can_add boolean, can_edit boolean, can_approve boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select rp.page, rp.can_view, rp.can_add, rp.can_edit, rp.can_approve
  from public.staff_profiles s
  join public.role_permissions rp on rp.role_id = s.role_id
  where s.user_id = (select auth.uid()) and (select public.is_staff());
$$;

-- ---------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------
create function private.is_locked_role(role uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select r.is_locked from public.roles r where r.id = role), false);
$$;

create function private.staff_role(target uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.role_id from public.staff_profiles s where s.user_id = target;
$$;

create function private.assert_valid_code(code text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if code is null or code !~ '^[0-9]{6}$' then
    raise exception 'invalid_code' using hint = 'The staff code must be exactly 6 digits';
  end if;
end;
$$;

create function private.assert_valid_phone(phone text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if phone is null or phone !~ '^\+9665[0-9]{8}$' then
    raise exception 'invalid_phone' using hint = 'Phone must be +9665XXXXXXXX';
  end if;
end;
$$;

-- Store the hash, end every session of that member.
create function private.write_code_and_revoke(target uuid, code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_valid_code(code);
  insert into private.staff_credentials (user_id, code_hash)
  values (target, extensions.crypt(code, extensions.gen_salt('bf', 10)))
  on conflict (user_id) do update set code_hash = excluded.code_hash, updated_at = now();
  perform private.revoke_sessions(target);
end;
$$;

create function private.revoke_sessions(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.staff_profiles
     set sessions_valid_after = now(), failed_attempts = 0, locked_until = null
   where user_id = target;
  delete from auth.sessions where user_id = target;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Login check (Edge Function staff-login, service role only)
-- ---------------------------------------------------------------------
create function public.staff_verify_code(p_phone text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  matches boolean;
  attempts integer;
begin
  select sp.user_id, sp.is_active, sp.failed_attempts, sp.locked_until, r.is_active as role_active
    into s
    from public.staff_profiles sp
    join public.roles r on r.id = sp.role_id
   where sp.phone = p_phone
   for update of sp;

  if not found then
    return jsonb_build_object('status', 'invalid');
  end if;

  if s.locked_until is not null and s.locked_until > now() then
    return jsonb_build_object('status', 'locked', 'locked_until', s.locked_until);
  end if;

  select c.code_hash = extensions.crypt(coalesce(p_code, ''), c.code_hash)
    into matches
    from private.staff_credentials c
   where c.user_id = s.user_id;

  if coalesce(matches, false) then
    if s.failed_attempts <> 0 or s.locked_until is not null then
      update public.staff_profiles set failed_attempts = 0, locked_until = null where user_id = s.user_id;
    end if;
    if not s.is_active or not s.role_active then
      return jsonb_build_object('status', 'disabled');
    end if;
    return jsonb_build_object('status', 'ok', 'user_id', s.user_id);
  end if;

  attempts := s.failed_attempts + 1;
  if attempts >= 5 then
    update public.staff_profiles
       set failed_attempts = 0, locked_until = now() + interval '15 minutes'
     where user_id = s.user_id;
    return jsonb_build_object('status', 'locked', 'locked_until', now() + interval '15 minutes');
  end if;

  update public.staff_profiles set failed_attempts = attempts where user_id = s.user_id;
  return jsonb_build_object('status', 'invalid', 'attempts_left', 5 - attempts);
end;
$$;

-- ---------------------------------------------------------------------
-- First system admin (Edge Function bootstrap-admin, service role only).
-- Works only while no system admin exists.
-- ---------------------------------------------------------------------
create function public.staff_bootstrap_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.staff_profiles s join public.roles r on r.id = s.role_id where r.is_locked
  );
$$;

create function public.staff_bootstrap(p_user uuid, p_name text, p_phone text, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_role uuid;
begin
  -- Serialise concurrent bootstrap calls.
  perform pg_advisory_xact_lock(hashtext('ghaith.staff_bootstrap'));
  if not public.staff_bootstrap_open() then
    raise exception 'already_bootstrapped';
  end if;
  perform private.assert_valid_phone(p_phone);
  perform private.assert_valid_code(p_code);
  select id into admin_role from public.roles where is_locked limit 1;
  insert into public.staff_profiles (user_id, full_name, phone, role_id)
  values (p_user, btrim(p_name), p_phone, admin_role);
  perform private.write_code_and_revoke(p_user, p_code);
end;
$$;

-- ---------------------------------------------------------------------
-- Staff management (dashboard, signed-in staff). Each checks permissions.
-- ---------------------------------------------------------------------

-- Called by the admin-users Edge Function with the caller's own token,
-- after it created the auth user.
create function public.staff_register(p_user uuid, p_name text, p_phone text, p_role uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('users_roles', 'add') then
    raise exception 'forbidden';
  end if;
  if private.is_locked_role(p_role)
     and not private.is_locked_role(private.staff_role((select auth.uid()))) then
    raise exception 'forbidden' using hint = 'Only a system admin can add another system admin';
  end if;
  if not exists (select 1 from public.roles where id = p_role and is_active) then
    raise exception 'invalid_role';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'invalid_name';
  end if;
  perform private.assert_valid_phone(p_phone);
  perform private.assert_valid_code(p_code);
  if exists (select 1 from public.staff_profiles where phone = p_phone) then
    raise exception 'phone_taken';
  end if;
  insert into public.staff_profiles (user_id, full_name, phone, role_id)
  values (p_user, btrim(p_name), p_phone, p_role);
  perform private.write_code_and_revoke(p_user, p_code);
end;
$$;

-- Change a member's code (or your own). Ends all their sessions.
create function public.staff_set_code(p_user uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if not exists (select 1 from public.staff_profiles where user_id = p_user) then
    raise exception 'not_found';
  end if;
  if p_user <> me then
    if not public.has_permission('users_roles', 'edit') then
      raise exception 'forbidden';
    end if;
    if private.is_locked_role(private.staff_role(p_user)) then
      raise exception 'locked_admin' using hint = 'Only the system admin can change their own code';
    end if;
  elsif not public.is_staff() then
    raise exception 'forbidden';
  end if;
  perform private.write_code_and_revoke(p_user, p_code);
end;
$$;

-- Enable / disable (staff are never deleted).
create function public.staff_set_active(p_user uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('users_roles', 'edit') then
    raise exception 'forbidden';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'cannot_change_self';
  end if;
  if private.is_locked_role(private.staff_role(p_user)) then
    raise exception 'locked_admin';
  end if;
  update public.staff_profiles set is_active = p_active where user_id = p_user;
  if not found then
    raise exception 'not_found';
  end if;
  if not p_active then
    perform private.revoke_sessions(p_user);
  end if;
end;
$$;

create function public.staff_set_role(p_user uuid, p_role uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('users_roles', 'edit') then
    raise exception 'forbidden';
  end if;
  if p_user = (select auth.uid()) then
    raise exception 'cannot_change_self';
  end if;
  if private.is_locked_role(private.staff_role(p_user)) then
    raise exception 'locked_admin';
  end if;
  if private.is_locked_role(p_role)
     and not private.is_locked_role(private.staff_role((select auth.uid()))) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.roles where id = p_role and is_active) then
    raise exception 'invalid_role';
  end if;
  update public.staff_profiles set role_id = p_role where user_id = p_user;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

-- New role, copying the permissions of an existing one.
create function public.role_create(p_name text, p_copy_from uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
begin
  if not public.has_permission('users_roles', 'add') then
    raise exception 'forbidden';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then
    raise exception 'invalid_name';
  end if;
  insert into public.roles (name) values (btrim(p_name)) returning id into new_id;
  insert into public.role_permissions (role_id, page, can_view, can_add, can_edit, can_approve)
  select new_id, p.page,
         coalesce(src.can_view, false), coalesce(src.can_add, false),
         coalesce(src.can_edit, false), coalesce(src.can_approve, false)
  from unnest(array['dashboard', 'orders', 'appointments', 'work_orders', 'customers', 'payments',
                    'inventory', 'catalog', 'reports', 'users_roles', 'settings', 'audit_log']) as p(page)
  left join public.role_permissions src on src.role_id = p_copy_from and src.page = p.page;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.my_permissions() from public, anon;
revoke execute on function public.staff_verify_code(text, text) from public, anon, authenticated;
revoke execute on function public.staff_bootstrap_open() from public, anon, authenticated;
revoke execute on function public.staff_bootstrap(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.staff_register(uuid, text, text, uuid, text) from public, anon;
revoke execute on function public.staff_set_code(uuid, text) from public, anon;
revoke execute on function public.staff_set_active(uuid, boolean) from public, anon;
revoke execute on function public.staff_set_role(uuid, uuid) from public, anon;
revoke execute on function public.role_create(text, uuid) from public, anon;

grant execute on function public.my_permissions() to authenticated;
grant execute on function public.staff_register(uuid, text, text, uuid, text) to authenticated;
grant execute on function public.staff_set_code(uuid, text) to authenticated;
grant execute on function public.staff_set_active(uuid, boolean) to authenticated;
grant execute on function public.staff_set_role(uuid, uuid) to authenticated;
grant execute on function public.role_create(text, uuid) to authenticated;
grant execute on function public.staff_verify_code(text, text) to service_role;
grant execute on function public.staff_bootstrap_open() to service_role;
grant execute on function public.staff_bootstrap(uuid, text, text, text) to service_role;
