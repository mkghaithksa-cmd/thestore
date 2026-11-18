-- =====================================================================
-- Ghaith platform — Day 8: maintenance and appointments.
--
--   A. Filter life: a default on each filter product; each device gets its
--      own filter rows (life editable per device by staff).
--   B. Devices of existing customers: staff add them by phone, even before
--      the customer has an account (claimed on first login).
--   C. Service requests (emergency / maintenance) with the appointment on
--      the same row, and a log of every change (reschedule needs a reason).
--   D. Due maintenance list and the customer's answer to the reminder.
--
-- Every write goes through SECURITY DEFINER functions below; clients only
-- read through RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Filter life and fault types
-- ---------------------------------------------------------------------
alter table public.products
  add column filter_life_months smallint check (filter_life_months is null or filter_life_months between 1 and 60);

comment on column public.products.filter_life_months is
  'Default life of a filter product. filter_compatibility.lifetime_months wins for a known device model.';

update public.products set filter_life_months = 6 where type = 'filter' and filter_life_months is null;

alter table public.settings
  add column fault_types text[] not null default array[
    'تسريب ماء', 'الجهاز ما يشتغل', 'ضعف في الضغط', 'طعم أو ريحة في الماء',
    'صوت مزعج', 'تغيير فلاتر', 'غير ذلك'
  ]::text[]
  check (cardinality(fault_types) between 1 and 30);

grant update (fault_types) on public.settings to authenticated;

-- Fault types: trimmed, no blanks, no duplicates, each 2..40 characters.
create function public.settings_fault_types_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cleaned text[];
begin
  select coalesce(array_agg(t order by ord), '{}')
    into cleaned
    from (
      select distinct on (t) t, ord
        from unnest(new.fault_types) with ordinality as u(raw, ord)
        cross join lateral (select btrim(regexp_replace(u.raw, '\s+', ' ', 'g')) as t) x
       where t <> ''
       order by t, ord
    ) s;
  if cardinality(cleaned) = 0 or exists (select 1 from unnest(cleaned) t where length(t) not between 2 and 40) then
    raise exception 'invalid_fault_types';
  end if;
  new.fault_types := cleaned;
  return new;
end;
$$;

revoke execute on function public.settings_fault_types_normalize() from public, anon, authenticated;

create trigger settings_fault_types_normalize before update of fault_types on public.settings
  for each row execute function public.settings_fault_types_normalize();

-- ---------------------------------------------------------------------
-- B. Devices
-- ---------------------------------------------------------------------
create function private.normalize_phone(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if d ~ '^05[0-9]{8}$' then
    d := '966' || substr(d, 2);
  elsif d ~ '^5[0-9]{8}$' then
    d := '966' || d;
  elsif d ~ '^009665[0-9]{8}$' then
    d := substr(d, 3);
  end if;
  if d !~ '^9665[0-9]{8}$' then
    raise exception 'invalid_phone';
  end if;
  return '+' || d;
end;
$$;

revoke execute on function private.normalize_phone(text) from public, anon, authenticated;

alter table public.customer_devices
  alter column customer_id drop not null,
  add column owner_phone text check (owner_phone is null or owner_phone ~ '^\+9665[0-9]{8}$'),
  add column model text check (model is null or length(model) <= 40),
  add column date_uncertain boolean not null default false,
  add column address_id uuid references public.addresses (id) on delete set null,
  add column notes text check (notes is null or length(notes) <= 500),
  add column next_contact_on date,
  add column added_by uuid references auth.users (id) on delete set null,
  add constraint customer_devices_has_owner check (customer_id is not null or owner_phone is not null);

comment on column public.customer_devices.owner_phone is
  'Set when staff add a device for a phone that has no account yet; cleared when the customer signs up.';
comment on column public.customer_devices.next_contact_on is
  'Reminder postponed until this day (customer or staff).';

create index customer_devices_owner_phone_idx on public.customer_devices (owner_phone) where owner_phone is not null;

update public.customer_devices d
   set model = p.model
  from public.products p
 where p.id = d.product_id and d.model is null and p.model is not null;

create function public.customer_devices_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.model is null then
    select p.model into new.model from public.products p where p.id = new.product_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.customer_devices_before_insert() from public, anon, authenticated;

create trigger customer_devices_before_insert before insert on public.customer_devices
  for each row execute function public.customer_devices_before_insert();

-- One row per filter in a device.
create table public.device_filters (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.customer_devices (id) on delete cascade,
  filter_product_id uuid references public.products (id) on delete set null,
  stage_number smallint check (stage_number > 0),
  name_ar text not null check (length(name_ar) between 2 and 120),
  life_months smallint not null check (life_months between 1 and 60),
  last_changed_on date not null,
  next_due_on date generated always as ((last_changed_on + make_interval(months => life_months::integer))::date) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index device_filters_device_idx on public.device_filters (device_id);
create index device_filters_due_idx on public.device_filters (next_due_on) where is_active;

create trigger device_filters_set_updated_at before update on public.device_filters
  for each row execute function public.set_updated_at();

create function private.device_add_filters(p_device_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.device_filters (device_id, filter_product_id, stage_number, name_ar, life_months, last_changed_on)
  select d.id, f.id, fc.stage_number,
         left(f.name_ar || coalesce(' (المرحلة ' || fc.stage_number || ')', ''), 120),
         coalesce(fc.lifetime_months, f.filter_life_months, 6),
         d.started_on
    from public.customer_devices d
    join public.filter_compatibility fc on fc.device_model = d.model
    join public.products f on f.id = fc.filter_product_id
   where d.id = p_device_id
     and not exists (select 1 from public.device_filters x where x.device_id = d.id);
$$;

revoke execute on function private.device_add_filters(uuid) from public, anon, authenticated;

create function public.customer_devices_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.device_add_filters(new.id);
  return null;
end;
$$;

revoke execute on function public.customer_devices_after_insert() from public, anon, authenticated;

create trigger customer_devices_after_insert after insert on public.customer_devices
  for each row execute function public.customer_devices_after_insert();

-- Devices that already exist get their filters now.
select private.device_add_filters(id) from public.customer_devices;

alter table public.device_filters enable row level security;
create policy "device_filters: own read" on public.device_filters
  for select to authenticated using (
    exists (select 1 from public.customer_devices d where d.id = device_id and d.customer_id = (select auth.uid()))
  );
create policy "device_filters: staff read" on public.device_filters
  for select to authenticated using ((select public.has_permission('customers', 'view')));
revoke all on public.device_filters from anon;
revoke insert, update, delete, truncate on public.device_filters from authenticated;

create trigger device_filters_audit after insert or update or delete on public.device_filters
  for each row execute function public.record_audit();

-- Staff see devices added for a phone without an account through customers:view (policy from Day 7).

-- ---------------------------------------------------------------------
-- C. Service requests (emergency report / maintenance booking)
-- ---------------------------------------------------------------------
create sequence public.service_request_seq start with 5001;
revoke all on sequence public.service_request_seq from anon, authenticated;

create table public.service_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null unique default ('SR-' || nextval('public.service_request_seq')),
  kind text not null check (kind in ('emergency', 'maintenance')),
  source text not null check (source in ('web', 'phone')),
  customer_id uuid references public.customers (id) on delete set null,
  contact_name text not null check (length(contact_name) between 2 and 100),
  contact_phone text not null check (contact_phone ~ '^\+9665[0-9]{8}$'),
  device_id uuid references public.customer_devices (id) on delete set null,
  fault_type text check (fault_type is null or length(fault_type) <= 40),
  description text check (description is null or length(description) <= 1000),
  photo_path text check (photo_path is null or length(photo_path) <= 200),
  preferred_date date not null,
  preferred_period text not null check (preferred_period in ('morning', 'evening')),
  address_id uuid references public.addresses (id) on delete set null,
  city text not null default 'makkah',
  neighborhood_name text check (neighborhood_name is null or length(neighborhood_name) <= 80),
  street text check (street is null or length(street) <= 300),
  lat double precision,
  lng double precision,
  inspection_fee numeric(10, 2) not null default 0 check (inspection_fee >= 0),
  status text not null default 'new' check (status in ('new', 'scheduled', 'in_progress', 'done', 'cancelled')),
  scheduled_at timestamptz,
  technician_id uuid references public.staff_profiles (user_id) on delete set null,
  done_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status not in ('scheduled', 'in_progress') or scheduled_at is not null)
);

comment on column public.service_requests.inspection_fee is
  'Inspection fee from settings when the request was made (emergency only). Paid on the visit, no prepayment.';

create index service_requests_customer_idx on public.service_requests (customer_id);
create index service_requests_device_idx on public.service_requests (device_id);
create index service_requests_open_idx on public.service_requests (status, kind, preferred_date)
  where status in ('new', 'scheduled', 'in_progress');

create trigger service_requests_set_updated_at before update on public.service_requests
  for each row execute function public.set_updated_at();

create table public.service_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.service_requests (id) on delete cascade,
  from_status text,
  to_status text not null,
  scheduled_at timestamptz,
  note text check (note is null or length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index service_request_events_request_idx on public.service_request_events (request_id, created_at);

alter table public.service_requests enable row level security;
alter table public.service_request_events enable row level security;

create policy "service_requests: own read" on public.service_requests
  for select to authenticated using (customer_id = (select auth.uid()));
create policy "service_requests: staff read" on public.service_requests
  for select to authenticated using ((select public.has_permission('appointments', 'view')));
create policy "service_request_events: own read" on public.service_request_events
  for select to authenticated using (
    exists (select 1 from public.service_requests r where r.id = request_id and r.customer_id = (select auth.uid()))
  );
create policy "service_request_events: staff read" on public.service_request_events
  for select to authenticated using ((select public.has_permission('appointments', 'view')));

revoke all on public.service_requests, public.service_request_events from anon;
revoke insert, update, delete, truncate on public.service_requests, public.service_request_events from authenticated;

create trigger service_requests_audit after insert or update or delete on public.service_requests
  for each row execute function public.record_audit();

-- Photo of the fault: private bucket, each customer writes under their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('service-photos', 'service-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "service-photos: own upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'service-photos' and split_part(name, '/', 1) = (select auth.uid())::text);
create policy "service-photos: own read" on storage.objects
  for select to authenticated
  using (bucket_id = 'service-photos' and split_part(name, '/', 1) = (select auth.uid())::text);
create policy "service-photos: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'service-photos' and (select public.has_permission('appointments', 'view')));

create function private.request_log(p_id uuid, p_from text, p_to text, p_at timestamptz, p_note text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.service_request_events (request_id, from_status, to_status, scheduled_at, note, created_by)
  values (p_id, p_from, p_to, p_at, nullif(btrim(coalesce(p_note, '')), ''), (select auth.uid()));
$$;

revoke execute on function private.request_log(uuid, text, text, timestamptz, text) from public, anon, authenticated;

-- Shared checks for the preferred day and the fault type.
create function private.request_check(p_kind text, p_fault_type text, p_date date, p_period text, p_staff boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if p_kind not in ('emergency', 'maintenance') then
    raise exception 'invalid_kind';
  end if;
  if p_period is null or p_period not in ('morning', 'evening') then
    raise exception 'invalid_period';
  end if;
  if p_fault_type is not null and not exists (
    select 1 from public.settings s where s.id = 1 and p_fault_type = any (s.fault_types)
  ) then
    raise exception 'invalid_fault_type';
  end if;
  if p_kind = 'emergency' and p_fault_type is null then
    raise exception 'fault_type_required';
  end if;
  -- Staff may book any day from today; the customer gets today only for an emergency.
  if p_date is null or p_date > today + 30
     or p_date < (case when p_kind = 'emergency' or p_staff then today else today + 1 end) then
    raise exception 'invalid_date';
  end if;
  if not p_staff and p_kind = 'maintenance' and not exists (
    select 1 from public.work_days w where w.day_of_week = extract(dow from p_date) and w.is_working
  ) then
    raise exception 'day_off';
  end if;
end;
$$;

revoke execute on function private.request_check(text, text, date, text, boolean) from public, anon, authenticated;

-- The customer reports a fault or books a maintenance visit (Mecca only).
create function public.request_service(
  p_kind text,
  p_device_id uuid,
  p_address_id uuid,
  p_preferred_date date,
  p_preferred_period text,
  p_fault_type text default null,
  p_description text default null,
  p_photo_path text default null,
  p_contact_name text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_neighborhood_name text default null,
  p_street text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  c public.customers%rowtype;
  a public.addresses%rowtype;
  hood text;
  r public.service_requests%rowtype;
  fault text := nullif(btrim(coalesce(p_fault_type, '')), '');
  name text;
  v_addr uuid := p_address_id;
  pin_hood text := nullif(btrim(regexp_replace(coalesce(p_neighborhood_name, ''), '\s+', ' ', 'g')), '');
begin
  select * into c from public.customers where id = uid;
  if not found then
    raise exception 'not_allowed';
  end if;
  if p_kind = 'maintenance' and fault is null then
    fault := 'تغيير فلاتر';
    if not exists (select 1 from public.settings s where s.id = 1 and fault = any (s.fault_types)) then
      fault := null;
    end if;
  end if;
  perform private.request_check(p_kind, fault, p_preferred_date, p_preferred_period, false);

  if p_device_id is not null and not exists (
    select 1 from public.customer_devices d where d.id = p_device_id and d.customer_id = uid and d.is_active
  ) then
    raise exception 'device_not_found';
  end if;
  if p_kind = 'maintenance' and p_device_id is null then
    raise exception 'device_required';
  end if;

  -- A saved address, or the map pin (saved as a new address of the customer).
  if v_addr is null then
    if p_lat is null or p_lng is null then
      raise exception 'address_required';
    end if;
    if not public.is_in_service_area(p_lat, p_lng) then
      raise exception 'outside_service_area';
    end if;
    if pin_hood is null then
      raise exception 'neighborhood_required';
    end if;
    if length(pin_hood) > 80 or length(coalesce(p_street, '')) > 300 then
      raise exception 'invalid_neighborhood';
    end if;
  end if;

  if (select count(*) from public.service_requests s
       where s.customer_id = uid and s.status in ('new', 'scheduled', 'in_progress')) >= 2 then
    raise exception 'too_many_open';
  end if;
  if p_device_id is not null and exists (
    select 1 from public.service_requests s
     where s.device_id = p_device_id and s.status in ('new', 'scheduled', 'in_progress')
  ) then
    raise exception 'device_has_open_request';
  end if;

  if p_photo_path is not null and (p_photo_path not like uid::text || '/%' or length(p_photo_path) > 200) then
    raise exception 'invalid_photo';
  end if;
  if length(coalesce(p_description, '')) > 1000 then
    raise exception 'description_too_long';
  end if;
  name := coalesce(nullif(btrim(coalesce(p_contact_name, '')), ''), c.full_name);
  if name is null or length(name) not between 2 and 100 then
    raise exception 'name_required';
  end if;

  if v_addr is null then
    select x.id into v_addr from public.addresses x
     where x.customer_id = uid and x.is_active
       and abs(x.lat - p_lat) < 0.00001 and abs(x.lng - p_lng) < 0.00001
     limit 1;
    if v_addr is null then
      insert into public.addresses (customer_id, city, neighborhood_id, neighborhood_name, street, lat, lng, is_default, last_used_at)
      values (uid, 'makkah',
              (select n.id from public.service_neighborhoods n
                where n.is_active and public.hood_key(n.name_ar) = public.hood_key(pin_hood) limit 1),
              pin_hood, nullif(btrim(coalesce(p_street, '')), ''), p_lat, p_lng,
              not exists (select 1 from public.addresses x where x.customer_id = uid and x.is_active and x.is_default),
              now())
      returning id into v_addr;
    else
      update public.addresses
         set neighborhood_name = pin_hood, street = nullif(btrim(coalesce(p_street, '')), ''), last_used_at = now()
       where id = v_addr;
    end if;
  end if;
  select * into a from public.addresses where id = v_addr and customer_id = uid and is_active;
  if not found then
    raise exception 'address_required';
  end if;
  if not a.in_service_area then
    raise exception 'outside_service_area';
  end if;

  hood := coalesce(a.neighborhood_name, (select n.name_ar from public.service_neighborhoods n where n.id = a.neighborhood_id));

  insert into public.service_requests (
    kind, source, customer_id, contact_name, contact_phone, device_id, fault_type, description, photo_path,
    preferred_date, preferred_period, address_id, city, neighborhood_name, street, lat, lng, inspection_fee, created_by
  ) values (
    p_kind, 'web', uid, name, c.phone, p_device_id, fault, nullif(btrim(coalesce(p_description, '')), ''), p_photo_path,
    p_preferred_date, p_preferred_period, a.id, a.city, hood, a.street, a.lat, a.lng,
    case when p_kind = 'emergency' then (select s.inspection_fee from public.settings s where s.id = 1) else 0 end,
    uid
  ) returning * into r;
  perform private.request_log(r.id, null, 'new', null, null);

  if p_device_id is not null then
    update public.customer_devices set next_contact_on = null where id = p_device_id and next_contact_on is not null;
  end if;
  return jsonb_build_object('id', r.id, 'request_number', r.request_number);
end;
$$;

revoke execute on function public.request_service(text, uuid, uuid, date, text, text, text, text, text, double precision, double precision, text, text) from public, anon;
grant execute on function public.request_service(text, uuid, uuid, date, text, text, text, text, text, double precision, double precision, text, text) to authenticated;

-- The customer cancels a request that is not under way yet.
create function public.request_cancel_mine(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.service_requests%rowtype;
begin
  select * into r from public.service_requests
   where id = p_request_id and customer_id = (select auth.uid()) for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if r.status not in ('new', 'scheduled') then
    raise exception 'cannot_cancel';
  end if;
  update public.service_requests
     set status = 'cancelled', cancelled_at = now(), cancel_reason = 'ألغاه العميل'
   where id = r.id;
  perform private.request_log(r.id, r.status, 'cancelled', null, 'ألغاه العميل');
end;
$$;

revoke execute on function public.request_cancel_mine(uuid) from public, anon;
grant execute on function public.request_cancel_mine(uuid) to authenticated;

-- Staff log a report that came in by phone (the caller may have no account).
create function public.staff_request_service(
  p_phone text,
  p_contact_name text,
  p_kind text,
  p_preferred_date date,
  p_preferred_period text,
  p_device_id uuid default null,
  p_fault_type text default null,
  p_description text default null,
  p_address_id uuid default null,
  p_neighborhood_name text default null,
  p_street text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  cust uuid;
  a public.addresses%rowtype;
  r public.service_requests%rowtype;
  fault text := nullif(btrim(coalesce(p_fault_type, '')), '');
  name text := nullif(btrim(coalesce(p_contact_name, '')), '');
  hood text := nullif(btrim(coalesce(p_neighborhood_name, '')), '');
begin
  if not public.has_permission('appointments', 'add') then
    raise exception 'not_allowed';
  end if;
  v_phone := private.normalize_phone(p_phone);
  select id into cust from public.customers where customers.phone = v_phone;
  name := coalesce(name, (select full_name from public.customers where id = cust));
  if name is null or length(name) not between 2 and 100 then
    raise exception 'name_required';
  end if;
  perform private.request_check(p_kind, fault, p_preferred_date, p_preferred_period, true);

  if p_device_id is not null and not exists (
    select 1 from public.customer_devices d
     where d.id = p_device_id and d.is_active
       and ((cust is not null and d.customer_id = cust) or d.owner_phone = v_phone)
  ) then
    raise exception 'device_not_found';
  end if;

  if p_address_id is not null then
    select * into a from public.addresses where id = p_address_id and customer_id = cust and is_active;
    if not found then
      raise exception 'address_required';
    end if;
    if not a.in_service_area then
      raise exception 'outside_service_area';
    end if;
    hood := coalesce(a.neighborhood_name, (select n.name_ar from public.service_neighborhoods n where n.id = a.neighborhood_id));
  elsif hood is null then
    raise exception 'neighborhood_required';
  end if;
  if length(hood) > 80 then
    raise exception 'invalid_neighborhood';
  end if;
  if length(coalesce(p_description, '')) > 1000 then
    raise exception 'description_too_long';
  end if;

  insert into public.service_requests (
    kind, source, customer_id, contact_name, contact_phone, device_id, fault_type, description,
    preferred_date, preferred_period, address_id, city, neighborhood_name, street, lat, lng, inspection_fee, created_by
  ) values (
    p_kind, 'phone', cust, name, v_phone, p_device_id, fault, nullif(btrim(coalesce(p_description, '')), ''),
    p_preferred_date, p_preferred_period, a.id, coalesce(a.city, 'makkah'), hood,
    coalesce(a.street, left(nullif(btrim(coalesce(p_street, '')), ''), 300)), a.lat, a.lng,
    case when p_kind = 'emergency' then (select s.inspection_fee from public.settings s where s.id = 1) else 0 end,
    (select auth.uid())
  ) returning * into r;
  perform private.request_log(r.id, null, 'new', null, 'بلاغ هاتفي');
  return jsonb_build_object('id', r.id, 'request_number', r.request_number);
end;
$$;

revoke execute on function public.staff_request_service(text, text, text, date, text, uuid, text, text, uuid, text, text) from public, anon;
grant execute on function public.staff_request_service(text, text, text, date, text, uuid, text, text, uuid, text, text) to authenticated;

-- Staff set (or change) the hour and the technician. A change needs a reason.
create function public.request_schedule(
  p_request_id uuid,
  p_scheduled_at timestamptz,
  p_technician_id uuid default null,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.service_requests%rowtype;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.has_permission('appointments', 'edit') then
    raise exception 'not_allowed';
  end if;
  select * into r from public.service_requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if r.status not in ('new', 'scheduled') then
    raise exception 'invalid_transition';
  end if;
  if p_scheduled_at is null or p_scheduled_at < now() - interval '1 hour'
     or p_scheduled_at > now() + interval '90 days' then
    raise exception 'invalid_date';
  end if;
  if p_technician_id is not null and not exists (
    select 1 from public.staff_profiles s where s.user_id = p_technician_id and s.is_active
  ) then
    raise exception 'technician_not_found';
  end if;
  if r.status = 'scheduled' and r.scheduled_at is distinct from p_scheduled_at and reason is null then
    raise exception 'reason_required';
  end if;
  if length(coalesce(reason, '')) > 300 then
    raise exception 'note_too_long';
  end if;

  update public.service_requests
     set status = 'scheduled', scheduled_at = p_scheduled_at, technician_id = p_technician_id
   where id = r.id;
  perform private.request_log(r.id, r.status, 'scheduled', p_scheduled_at, reason);
end;
$$;

revoke execute on function public.request_schedule(uuid, timestamptz, uuid, text) from public, anon;
grant execute on function public.request_schedule(uuid, timestamptz, uuid, text) to authenticated;

-- Staff move a request on: in_progress, done or cancelled (cancel needs a reason).
-- A finished maintenance visit marks the device's due filters as changed today.
create function public.request_set_status(p_request_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.service_requests%rowtype;
  note text := nullif(btrim(coalesce(p_note, '')), '');
  today date := (now() at time zone 'Asia/Riyadh')::date;
  alert integer := (select s.maintenance_alert_days from public.settings s where s.id = 1);
begin
  if not public.has_permission('appointments', 'edit') then
    raise exception 'not_allowed';
  end if;
  select * into r from public.service_requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if not (
    (p_status = 'in_progress' and r.status = 'scheduled')
    or (p_status = 'done' and r.status in ('scheduled', 'in_progress'))
    or (p_status = 'cancelled' and r.status in ('new', 'scheduled', 'in_progress'))
  ) then
    raise exception 'invalid_transition';
  end if;
  if p_status = 'cancelled' and note is null then
    raise exception 'reason_required';
  end if;
  if length(coalesce(note, '')) > 300 then
    raise exception 'note_too_long';
  end if;

  update public.service_requests
     set status = p_status,
         done_at = case when p_status = 'done' then now() else done_at end,
         cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
         cancel_reason = case when p_status = 'cancelled' then note else cancel_reason end
   where id = r.id;
  perform private.request_log(r.id, r.status, p_status, null, note);

  if p_status = 'done' and r.device_id is not null then
    if r.kind = 'maintenance' then
      update public.device_filters
         set last_changed_on = today
       where device_id = r.device_id and is_active and next_due_on <= today + alert;
    end if;
    update public.customer_devices set next_contact_on = null where id = r.device_id and next_contact_on is not null;
  end if;
end;
$$;

revoke execute on function public.request_set_status(uuid, text, text) from public, anon;
grant execute on function public.request_set_status(uuid, text, text) to authenticated;

-- Staff who can be picked as the technician (names only).
create function public.technicians_list()
returns table (user_id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, s.full_name
    from public.staff_profiles s
    join public.roles r on r.id = s.role_id and r.is_active
   where s.is_active and public.has_permission('appointments', 'view')
   order by s.full_name;
$$;

revoke execute on function public.technicians_list() from public, anon;
grant execute on function public.technicians_list() to authenticated;

-- ---------------------------------------------------------------------
-- D. Due maintenance and the customer's answer
-- ---------------------------------------------------------------------
create table public.maintenance_contacts (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.customer_devices (id) on delete cascade,
  outcome text not null check (outcome in ('agreed', 'postponed', 'declined', 'no_answer')),
  postponed_to date,
  request_id uuid references public.service_requests (id) on delete set null,
  note text check (note is null or length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (outcome <> 'postponed' or postponed_to is not null)
);

create index maintenance_contacts_device_idx on public.maintenance_contacts (device_id, created_at desc);

alter table public.maintenance_contacts enable row level security;
create policy "maintenance_contacts: staff read" on public.maintenance_contacts
  for select to authenticated using ((select public.has_permission('appointments', 'view')));
revoke all on public.maintenance_contacts from anon;
revoke insert, update, delete, truncate on public.maintenance_contacts from authenticated;

-- Devices whose next filter is due within settings.maintenance_alert_days,
-- not postponed, and without an open request.
create function public.maintenance_due()
returns table (
  device_id uuid,
  device_name text,
  model text,
  customer_id uuid,
  customer_name text,
  phone text,
  next_due_on date,
  due_filters text[],
  date_uncertain boolean,
  last_outcome text,
  last_contact_at timestamptz,
  no_answer_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Riyadh')::date;
  alert integer := (select s.maintenance_alert_days from public.settings s where s.id = 1);
begin
  if not public.has_permission('appointments', 'view') then
    raise exception 'not_allowed';
  end if;
  return query
  select d.id, d.name_ar, d.model, d.customer_id, c.full_name, coalesce(c.phone, d.owner_phone),
         min(f.next_due_on),
         array_agg(f.name_ar order by f.next_due_on) filter (where f.next_due_on <= today + alert),
         d.date_uncertain,
         lc.outcome, lc.created_at,
         (select count(*)::integer from public.maintenance_contacts m
           where m.device_id = d.id and m.outcome = 'no_answer' and m.created_at > now() - interval '30 days')
    from public.customer_devices d
    join public.device_filters f on f.device_id = d.id and f.is_active
    left join public.customers c on c.id = d.customer_id
    left join lateral (
      select m.outcome, m.created_at from public.maintenance_contacts m
       where m.device_id = d.id order by m.created_at desc limit 1
    ) lc on true
   where d.is_active
     and (d.next_contact_on is null or d.next_contact_on <= today)
     and not exists (
       select 1 from public.service_requests s
        where s.device_id = d.id and s.status in ('new', 'scheduled', 'in_progress')
     )
   group by d.id, c.full_name, c.phone, lc.outcome, lc.created_at
  having min(f.next_due_on) <= today + alert
   order by min(f.next_due_on);
end;
$$;

revoke execute on function public.maintenance_due() from public, anon;
grant execute on function public.maintenance_due() to authenticated;

-- Staff record the customer's answer to the reminder.
--   agreed    → a maintenance request on the chosen day/period
--   postponed → off the list until the new date
--   declined  → off the list for 90 days
--   no_answer → stays on the list
create function public.maintenance_log_contact(
  p_device_id uuid,
  p_outcome text,
  p_postpone_to date default null,
  p_preferred_date date default null,
  p_preferred_period text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.customer_devices%rowtype;
  c public.customers%rowtype;
  a public.addresses%rowtype;
  today date := (now() at time zone 'Asia/Riyadh')::date;
  note text := nullif(btrim(coalesce(p_note, '')), '');
  req uuid;
  num text;
  hood text;
  fault text;
begin
  if not public.has_permission('appointments', 'edit') then
    raise exception 'not_allowed';
  end if;
  select * into d from public.customer_devices where id = p_device_id and is_active for update;
  if not found then
    raise exception 'device_not_found';
  end if;
  if p_outcome is null or p_outcome not in ('agreed', 'postponed', 'declined', 'no_answer') then
    raise exception 'invalid_outcome';
  end if;
  if length(coalesce(note, '')) > 300 then
    raise exception 'note_too_long';
  end if;

  if p_outcome = 'postponed' then
    if p_postpone_to is null or p_postpone_to <= today or p_postpone_to > today + 180 then
      raise exception 'invalid_date';
    end if;
    update public.customer_devices set next_contact_on = p_postpone_to where id = d.id;
  elsif p_outcome = 'declined' then
    update public.customer_devices set next_contact_on = today + 90 where id = d.id;
  elsif p_outcome = 'agreed' then
    if exists (select 1 from public.service_requests s
                where s.device_id = d.id and s.status in ('new', 'scheduled', 'in_progress')) then
      raise exception 'device_has_open_request';
    end if;
    select 'تغيير فلاتر' into fault from public.settings s where s.id = 1 and 'تغيير فلاتر' = any (s.fault_types);
    perform private.request_check('maintenance', fault, p_preferred_date, p_preferred_period, true);
    select * into c from public.customers where id = d.customer_id;
    select * into a from public.addresses
     where id = coalesce(d.address_id, (
       select x.id from public.addresses x
        where x.customer_id = d.customer_id and x.is_active and x.in_service_area
        order by x.is_default desc, x.last_used_at desc nulls last limit 1))
       and is_active;
    hood := coalesce(a.neighborhood_name, (select n.name_ar from public.service_neighborhoods n where n.id = a.neighborhood_id));
    insert into public.service_requests (
      kind, source, customer_id, contact_name, contact_phone, device_id, fault_type,
      preferred_date, preferred_period, address_id, city, neighborhood_name, street, lat, lng, created_by
    ) values (
      'maintenance', 'phone', d.customer_id, coalesce(c.full_name, 'عميل'), coalesce(c.phone, d.owner_phone), d.id, fault,
      p_preferred_date, p_preferred_period, a.id, coalesce(a.city, 'makkah'), hood, a.street, a.lat, a.lng,
      (select auth.uid())
    ) returning id, request_number into req, num;
    perform private.request_log(req, null, 'new', null, 'وافق العميل على الصيانة');
    update public.customer_devices set next_contact_on = null where id = d.id and next_contact_on is not null;
  end if;

  insert into public.maintenance_contacts (device_id, outcome, postponed_to, request_id, note, created_by)
  values (d.id, p_outcome, case when p_outcome = 'postponed' then p_postpone_to end, req, note, (select auth.uid()));
  return jsonb_build_object('request_id', req, 'request_number', num);
end;
$$;

revoke execute on function public.maintenance_log_contact(uuid, text, date, date, text, text) from public, anon;
grant execute on function public.maintenance_log_contact(uuid, text, date, date, text, text) to authenticated;

-- The customer postpones the reminder for one of their devices.
create function public.device_snooze_mine(p_device_id uuid, p_until date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if p_until is null or p_until <= today or p_until > today + 180 then
    raise exception 'invalid_date';
  end if;
  update public.customer_devices set next_contact_on = p_until
   where id = p_device_id and customer_id = (select auth.uid()) and is_active;
  if not found then
    raise exception 'device_not_found';
  end if;
end;
$$;

revoke execute on function public.device_snooze_mine(uuid, date) from public, anon;
grant execute on function public.device_snooze_mine(uuid, date) to authenticated;

-- Staff add an old device for a customer found by phone (account or not).
create function public.device_add_staff(
  p_phone text,
  p_product_id uuid,
  p_started_on date default null,
  p_installed boolean default true,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  cust uuid;
  p public.products%rowtype;
  today date := (now() at time zone 'Asia/Riyadh')::date;
  started date := coalesce(p_started_on, today);
  dev uuid;
begin
  if not public.has_permission('customers', 'add') then
    raise exception 'not_allowed';
  end if;
  v_phone := private.normalize_phone(p_phone);
  select id into cust from public.customers where customers.phone = v_phone;
  select * into p from public.products where id = p_product_id and type = 'device';
  if not found then
    raise exception 'product_not_found';
  end if;
  if started > today or started < today - 365 * 20 then
    raise exception 'invalid_date';
  end if;
  if length(coalesce(p_notes, '')) > 500 then
    raise exception 'note_too_long';
  end if;

  insert into public.customer_devices (
    customer_id, owner_phone, product_id, name_ar, installed, started_on, warranty_until,
    date_uncertain, notes, added_by
  ) values (
    cust, case when cust is null then v_phone end, p.id, p.name_ar, coalesce(p_installed, true), started,
    case when p_started_on is not null and p.warranty_months > 0
         then (started + make_interval(months => p.warranty_months))::date end,
    p_started_on is null, nullif(btrim(coalesce(p_notes, '')), ''), (select auth.uid())
  ) returning id into dev;
  return dev;
end;
$$;

revoke execute on function public.device_add_staff(text, uuid, date, boolean, text) from public, anon;
grant execute on function public.device_add_staff(text, uuid, date, boolean, text) to authenticated;

-- Staff correct a device: start date (and whether it is confirmed), notes, archive.
create function public.device_update_staff(
  p_device_id uuid,
  p_started_on date,
  p_date_uncertain boolean,
  p_notes text default null,
  p_is_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if not public.has_permission('customers', 'edit') then
    raise exception 'not_allowed';
  end if;
  if p_started_on is null or p_started_on > today or p_started_on < today - 365 * 20 then
    raise exception 'invalid_date';
  end if;
  if length(coalesce(p_notes, '')) > 500 then
    raise exception 'note_too_long';
  end if;
  update public.customer_devices
     set started_on = p_started_on,
         date_uncertain = coalesce(p_date_uncertain, false),
         notes = nullif(btrim(coalesce(p_notes, '')), ''),
         is_active = coalesce(p_is_active, true)
   where id = p_device_id;
  if not found then
    raise exception 'device_not_found';
  end if;
end;
$$;

revoke execute on function public.device_update_staff(uuid, date, boolean, text, boolean) from public, anon;
grant execute on function public.device_update_staff(uuid, date, boolean, text, boolean) to authenticated;

-- Staff edit one filter of a device: its life, the last change, or remove it.
create function public.device_filter_update(
  p_filter_id uuid,
  p_life_months integer,
  p_last_changed_on date,
  p_is_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if not public.has_permission('customers', 'edit') then
    raise exception 'not_allowed';
  end if;
  if p_life_months is null or p_life_months not between 1 and 60 then
    raise exception 'invalid_life';
  end if;
  if p_last_changed_on is null or p_last_changed_on > today or p_last_changed_on < today - 365 * 20 then
    raise exception 'invalid_date';
  end if;
  update public.device_filters
     set life_months = p_life_months, last_changed_on = p_last_changed_on, is_active = coalesce(p_is_active, true)
   where id = p_filter_id;
  if not found then
    raise exception 'filter_not_found';
  end if;
end;
$$;

revoke execute on function public.device_filter_update(uuid, integer, date, boolean) from public, anon;
grant execute on function public.device_filter_update(uuid, integer, date, boolean) to authenticated;

-- Staff add a filter to a device (e.g. a model with no known filters).
create function public.device_filter_add(p_device_id uuid, p_filter_product_id uuid, p_life_months integer default null, p_last_changed_on date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.customer_devices%rowtype;
  f public.products%rowtype;
  today date := (now() at time zone 'Asia/Riyadh')::date;
  life integer;
  new_id uuid;
begin
  if not public.has_permission('customers', 'edit') then
    raise exception 'not_allowed';
  end if;
  select * into d from public.customer_devices where customer_devices.id = p_device_id;
  if not found then
    raise exception 'device_not_found';
  end if;
  select * into f from public.products where products.id = p_filter_product_id and type = 'filter';
  if not found then
    raise exception 'product_not_found';
  end if;
  life := coalesce(p_life_months, f.filter_life_months, 6);
  if life not between 1 and 60 then
    raise exception 'invalid_life';
  end if;
  if coalesce(p_last_changed_on, d.started_on) > today then
    raise exception 'invalid_date';
  end if;
  insert into public.device_filters (device_id, filter_product_id, name_ar, life_months, last_changed_on)
  values (d.id, f.id, left(f.name_ar, 120), life, coalesce(p_last_changed_on, d.started_on))
  returning device_filters.id into new_id;
  return new_id;
end;
$$;

revoke execute on function public.device_filter_add(uuid, uuid, integer, date) from public, anon;
grant execute on function public.device_filter_add(uuid, uuid, integer, date) to authenticated;

-- ---------------------------------------------------------------------
-- E. A new customer takes over the devices and requests logged for their phone.
-- ---------------------------------------------------------------------
create function public.customers_claim_by_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.customer_devices
     set customer_id = new.id, owner_phone = null
   where owner_phone = new.phone and customer_id is null;
  update public.service_requests
     set customer_id = new.id
   where contact_phone = new.phone and customer_id is null;
  return null;
end;
$$;

revoke execute on function public.customers_claim_by_phone() from public, anon, authenticated;

create trigger customers_claim_by_phone after insert on public.customers
  for each row execute function public.customers_claim_by_phone();
