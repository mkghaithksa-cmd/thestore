-- =====================================================================
-- Ghaith platform — Day 8, step 2: service for any device.
--
-- Customers can add (and report on, and book maintenance for) devices from
-- other companies: type, brand and number of stages, no product needed.
-- Such devices — and our own models with no known filters — get one
-- «طقم الفلاتر» row with settings.default_filter_life_months, so they show
-- in the due-maintenance list too; the technician corrects it later.
-- =====================================================================

alter table public.customer_devices
  alter column product_id drop not null,
  add column device_kind text check (device_kind is null or device_kind in ('under_sink', 'central', 'cooler', 'other')),
  add column brand text check (brand is null or length(brand) between 1 and 60),
  add column stages smallint check (stages is null or stages between 1 and 12),
  add constraint customer_devices_product_or_kind check (product_id is not null or device_kind is not null);

comment on column public.customer_devices.device_kind is 'Set for devices that are not one of our products (other companies).';

alter table public.settings
  add column default_filter_life_months smallint not null default 6 check (default_filter_life_months between 1 and 60);

grant update (default_filter_life_months) on public.settings to authenticated;

-- Known filters of the model; otherwise one generic filter set.
create or replace function private.device_add_filters(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
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

  if not exists (select 1 from public.device_filters x where x.device_id = p_device_id) then
    insert into public.device_filters (device_id, name_ar, life_months, last_changed_on)
    select d.id, 'طقم الفلاتر',
           (select s.default_filter_life_months from public.settings s where s.id = 1),
           d.started_on
      from public.customer_devices d
     where d.id = p_device_id;
  end if;
end;
$$;

revoke execute on function private.device_add_filters(uuid) from public, anon, authenticated;

-- Devices that still have no filters get the generic set.
select private.device_add_filters(d.id)
  from public.customer_devices d
 where not exists (select 1 from public.device_filters x where x.device_id = d.id);

create function private.device_kind_label(p_kind text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'under_sink' then 'منقي تحت المغسلة'
    when 'central' then 'جهاز مركزي للبيت'
    when 'cooler' then 'برادة مياه'
    else 'جهاز تنقية'
  end;
$$;

revoke execute on function private.device_kind_label(text) from public, anon, authenticated;

-- A device that is not one of our products. The start date may be unknown.
create function private.device_create_external(
  p_customer_id uuid,
  p_owner_phone text,
  p_kind text,
  p_brand text,
  p_stages integer,
  p_started_on date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Asia/Riyadh')::date;
  v_brand text := nullif(btrim(regexp_replace(coalesce(p_brand, ''), '\s+', ' ', 'g')), '');
  new_id uuid;
begin
  if p_kind is null or p_kind not in ('under_sink', 'central', 'cooler', 'other') then
    raise exception 'invalid_device_kind';
  end if;
  if length(coalesce(v_brand, '')) > 60 then
    raise exception 'invalid_brand';
  end if;
  if p_stages is not null and p_stages not between 1 and 12 then
    raise exception 'invalid_stages';
  end if;
  if p_started_on is not null and (p_started_on > today or p_started_on < today - 365 * 20) then
    raise exception 'invalid_date';
  end if;
  if (select count(*) from public.customer_devices d
       where d.is_active and ((p_customer_id is not null and d.customer_id = p_customer_id)
                              or (p_customer_id is null and d.owner_phone = p_owner_phone))) >= 20 then
    raise exception 'too_many_devices';
  end if;

  insert into public.customer_devices (
    customer_id, owner_phone, product_id, name_ar, installed, started_on, date_uncertain,
    device_kind, brand, stages, added_by
  ) values (
    p_customer_id, case when p_customer_id is null then p_owner_phone end, null,
    left(private.device_kind_label(p_kind) || coalesce(' · ' || v_brand, ''), 120), false,
    coalesce(p_started_on, today), p_started_on is null,
    p_kind, v_brand, p_stages, (select auth.uid())
  ) returning id into new_id;
  return new_id;
end;
$$;

revoke execute on function private.device_create_external(uuid, text, text, text, integer, date) from public, anon, authenticated;

-- The customer adds a device they already have (any company).
create function public.device_add_mine(p_kind text, p_brand text default null, p_stages integer default null, p_started_on date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if not exists (select 1 from public.customers c where c.id = uid) then
    raise exception 'not_allowed';
  end if;
  return private.device_create_external(uid, null, p_kind, p_brand, p_stages, p_started_on);
end;
$$;

revoke execute on function public.device_add_mine(text, text, integer, date) from public, anon;
grant execute on function public.device_add_mine(text, text, integer, date) to authenticated;

-- The customer removes a device they added themselves (archived, history kept).
create function public.device_remove_mine(p_device_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.service_requests s
              where s.device_id = p_device_id and s.status in ('new', 'scheduled', 'in_progress')) then
    raise exception 'device_has_open_request';
  end if;
  update public.customer_devices set is_active = false
   where id = p_device_id and customer_id = (select auth.uid()) and product_id is null and is_active;
  if not found then
    raise exception 'device_not_found';
  end if;
end;
$$;

revoke execute on function public.device_remove_mine(uuid) from public, anon;
grant execute on function public.device_remove_mine(uuid) to authenticated;

-- Staff add another company's device for a phone (account or not).
create function public.device_add_staff_external(
  p_phone text,
  p_kind text,
  p_brand text default null,
  p_stages integer default null,
  p_started_on date default null,
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
  dev uuid;
begin
  if not public.has_permission('customers', 'add') then
    raise exception 'not_allowed';
  end if;
  if length(coalesce(p_notes, '')) > 500 then
    raise exception 'note_too_long';
  end if;
  v_phone := private.normalize_phone(p_phone);
  select id into cust from public.customers where phone = v_phone;
  dev := private.device_create_external(cust, v_phone, p_kind, p_brand, p_stages, p_started_on);
  update public.customer_devices set notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = dev and p_notes is not null;
  return dev;
end;
$$;

revoke execute on function public.device_add_staff_external(text, text, text, integer, date, text) from public, anon;
grant execute on function public.device_add_staff_external(text, text, text, integer, date, text) to authenticated;

-- Reports and bookings may name a new device inline ("جهاز ثاني").
drop function public.request_service(text, uuid, uuid, date, text, text, text, text, text, double precision, double precision, text, text);
drop function public.staff_request_service(text, text, text, date, text, uuid, text, text, uuid, text, text);

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
  p_street text default null,
  p_device_kind text default null,
  p_brand text default null,
  p_stages integer default null
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
  v_device uuid := p_device_id;
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
  if p_kind = 'maintenance' and p_device_id is null and p_device_kind is null then
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

  -- «جهاز ثاني»: saved to the customer's devices so reminders and history follow it.
  if v_device is null and p_device_kind is not null then
    v_device := private.device_create_external(uid, null, p_device_kind, p_brand, p_stages, null);
  end if;

  hood := coalesce(a.neighborhood_name, (select n.name_ar from public.service_neighborhoods n where n.id = a.neighborhood_id));

  insert into public.service_requests (
    kind, source, customer_id, contact_name, contact_phone, device_id, fault_type, description, photo_path,
    preferred_date, preferred_period, address_id, city, neighborhood_name, street, lat, lng, inspection_fee, created_by
  ) values (
    p_kind, 'web', uid, name, c.phone, v_device, fault, nullif(btrim(coalesce(p_description, '')), ''), p_photo_path,
    p_preferred_date, p_preferred_period, a.id, a.city, hood, a.street, a.lat, a.lng,
    case when p_kind = 'emergency' then (select s.inspection_fee from public.settings s where s.id = 1) else 0 end,
    uid
  ) returning * into r;
  perform private.request_log(r.id, null, 'new', null, null);

  if v_device is not null then
    update public.customer_devices set next_contact_on = null where id = v_device and next_contact_on is not null;
  end if;
  return jsonb_build_object('id', r.id, 'request_number', r.request_number);
end;
$$;

revoke execute on function public.request_service(text, uuid, uuid, date, text, text, text, text, text, double precision, double precision, text, text, text, text, integer) from public, anon;
grant execute on function public.request_service(text, uuid, uuid, date, text, text, text, text, text, double precision, double precision, text, text, text, text, integer) to authenticated;

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
  p_street text default null,
  p_device_kind text default null,
  p_brand text default null,
  p_stages integer default null
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
  v_device uuid := p_device_id;
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

  if v_device is null and p_device_kind is not null then
    v_device := private.device_create_external(cust, v_phone, p_device_kind, p_brand, p_stages, null);
  end if;

  insert into public.service_requests (
    kind, source, customer_id, contact_name, contact_phone, device_id, fault_type, description,
    preferred_date, preferred_period, address_id, city, neighborhood_name, street, lat, lng, inspection_fee, created_by
  ) values (
    p_kind, 'phone', cust, name, v_phone, v_device, fault, nullif(btrim(coalesce(p_description, '')), ''),
    p_preferred_date, p_preferred_period, a.id, coalesce(a.city, 'makkah'), hood,
    coalesce(a.street, left(nullif(btrim(coalesce(p_street, '')), ''), 300)), a.lat, a.lng,
    case when p_kind = 'emergency' then (select s.inspection_fee from public.settings s where s.id = 1) else 0 end,
    (select auth.uid())
  ) returning * into r;
  perform private.request_log(r.id, null, 'new', null, 'بلاغ هاتفي');
  return jsonb_build_object('id', r.id, 'request_number', r.request_number);
end;
$$;

revoke execute on function public.staff_request_service(text, text, text, date, text, uuid, text, text, uuid, text, text, text, text, integer) from public, anon;
grant execute on function public.staff_request_service(text, text, text, date, text, uuid, text, text, uuid, text, text, text, text, integer) to authenticated;
