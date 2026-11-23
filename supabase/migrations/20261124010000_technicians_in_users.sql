-- «الفنيين» moves from Settings to «المستخدمون»: who manages staff also
-- manages technicians (users_roles add/edit). settings:edit still works.
drop policy "technicians: staff read" on public.technicians;
create policy "technicians: staff read" on public.technicians
  for select to authenticated using (
    (select public.has_permission('appointments', 'view'))
    or (select public.has_permission('work_orders', 'view'))
    or (select public.has_permission('payments', 'view'))
    or (select public.has_permission('settings', 'view'))
    or (select public.has_permission('users_roles', 'view'))
  );

create or replace function public.technician_save(p_id uuid, p_name text, p_phone text, p_active boolean default true)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ph text := private.normalize_phone(p_phone);
  nm text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  tid uuid;
begin
  if not (public.has_permission('settings', 'edit')
          or public.has_permission('users_roles', 'edit')
          or (p_id is null and public.has_permission('users_roles', 'add'))) then
    raise exception 'not_allowed';
  end if;
  if length(nm) < 2 or length(nm) > 60 then
    raise exception 'invalid_name';
  end if;
  if ph is null then
    raise exception 'invalid_phone';
  end if;
  if exists (select 1 from public.technicians t where t.phone = ph and t.id is distinct from p_id) then
    raise exception 'phone_taken';
  end if;
  if p_id is null then
    insert into public.technicians (full_name, phone, is_active)
    values (nm, ph, coalesce(p_active, true)) returning id into tid;
  else
    update public.technicians set full_name = nm, phone = ph, is_active = coalesce(p_active, true)
     where id = p_id returning id into tid;
    if tid is null then
      raise exception 'technician_not_found';
    end if;
  end if;
  return tid;
end;
$$;

revoke execute on function public.technician_save(uuid, text, text, boolean) from public, anon;
grant execute on function public.technician_save(uuid, text, text, boolean) to authenticated;
