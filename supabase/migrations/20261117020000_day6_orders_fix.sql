-- Day 6 fix: Supabase (pg_safeupdate) refuses a DELETE without WHERE, which
-- create_order() used to clear its temporary list of order lines.

create or replace function public.create_order(
  items jsonb,
  fulfillment text,
  lat double precision,
  lng double precision,
  neighborhood_id uuid default null,
  street text default null,
  address_notes text default null,
  contact_name text default null,
  preferred_visit_date date default null,
  customer_notes text default null,
  privacy_accepted boolean default false,
  city text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cust public.customers%rowtype;
  s public.settings%rowtype;
  in_area boolean;
  v_zone text;
  v_city text;
  hood public.service_neighborhoods%rowtype;
  n_lines integer;
  n_valid integer;
  has_service boolean;
  n_install integer;
  v_subtotal numeric(12, 2);
  v_install numeric(12, 2) := 0;
  v_shipping numeric(12, 2) := 0;
  v_vat numeric(12, 2);
  v_total numeric(12, 2);
  today date := (now() at time zone 'Asia/Riyadh')::date;
  v_addr uuid;
  v_name text := nullif(btrim(regexp_replace(coalesce(contact_name, ''), '\s+', ' ', 'g')), '');
  o public.orders%rowtype;
begin
  if uid is null then
    raise exception 'not_signed_in';
  end if;
  select * into cust from public.customers where id = uid;
  if not found then
    raise exception 'not_a_customer';
  end if;

  -- Contact name and privacy consent are completed once, at the first order.
  if v_name is not null and (length(v_name) < 2 or length(v_name) > 100) then
    raise exception 'invalid_name';
  end if;
  if coalesce(v_name, cust.full_name) is null then
    raise exception 'name_required';
  end if;
  if cust.privacy_accepted_at is null and not coalesce(privacy_accepted, false) then
    raise exception 'privacy_required';
  end if;
  update public.customers
     set full_name = coalesce(v_name, full_name),
         privacy_accepted_at = coalesce(privacy_accepted_at, now())
   where id = uid
  returning * into cust;

  -- Abuse guard: a handful of unpaid orders at a time.
  if (select count(*) from public.orders
       where customer_id = uid and status = 'pending_payment' and expires_at > now()) >= 5 then
    raise exception 'too_many_pending';
  end if;

  -- Location: the pin decides; Saudi Arabia only (rough box, the address is confirmed by phone).
  if lat is null or lng is null then
    raise exception 'location_required';
  end if;
  if lat not between 16.3 and 32.2 or lng not between 34.5 and 55.7 then
    raise exception 'outside_ksa';
  end if;
  in_area := public.is_in_service_area(lat, lng);
  v_zone := case when in_area then 'mecca' else 'outside' end;

  if v_zone = 'mecca' then
    if fulfillment not in ('delivery', 'delivery_install') then
      raise exception 'invalid_fulfillment';
    end if;
    select * into hood from public.service_neighborhoods h where h.id = neighborhood_id and h.is_active;
    if not found then
      raise exception 'neighborhood_required';
    end if;
    v_city := 'مكة المكرمة';
  else
    if fulfillment <> 'shipping' then
      raise exception 'invalid_fulfillment';
    end if;
    -- Outside Mecca the city is a label for shipping (the pin is what counts).
    v_city := left(coalesce(nullif(btrim(city), ''), 'خارج مكة'), 60);
  end if;

  -- Items: merge repeated products; 1-20 of each; at most 50 lines.
  if items is null or jsonb_typeof(items) <> 'array' or jsonb_array_length(items) = 0 then
    raise exception 'empty_cart';
  end if;
  if jsonb_array_length(items) > 50 then
    raise exception 'too_many_items';
  end if;

  create temporary table if not exists pg_temp.order_lines (
    product_id uuid primary key, qty integer, sku text, name_ar text, type text,
    unit_price numeric(12, 2), installable boolean
  ) on commit drop;
  delete from pg_temp.order_lines where true; -- Supabase refuses DELETE without WHERE

  begin
    insert into pg_temp.order_lines (product_id, qty)
    select (e ->> 'product_id')::uuid, sum((e ->> 'qty')::integer)
      from jsonb_array_elements(items) e
     group by 1;
  exception when others then
    raise exception 'invalid_items';
  end;

  if exists (select 1 from pg_temp.order_lines where product_id is null or qty is null or qty < 1 or qty > 20) then
    raise exception 'invalid_qty';
  end if;

  update pg_temp.order_lines l
     set sku = p.sku, name_ar = p.name_ar, type = p.type, unit_price = p.price_before_vat,
         installable = p.installable_in_mecca
    from public.products p
   where p.id = l.product_id and p.status = 'published' and public.category_is_public(p.category_id);

  select count(*), count(sku), bool_or(type = 'service'),
         coalesce(sum(qty) filter (where installable), 0),
         coalesce(sum(unit_price * qty), 0)
    into n_lines, n_valid, has_service, n_install, v_subtotal
    from pg_temp.order_lines;

  if n_valid < n_lines then
    raise exception 'product_unavailable';
  end if;
  if has_service and v_zone <> 'mecca' then
    raise exception 'service_outside_area';
  end if;

  select * into s from public.settings where id = 1;

  if fulfillment = 'delivery_install' then
    if n_install = 0 then
      raise exception 'nothing_to_install';
    end if;
    v_install := s.install_fee * n_install;
  else
    n_install := 0;
  end if;
  if v_zone = 'outside' then
    v_shipping := s.shipping_fee;
  end if;

  -- A visit (installation or a service) needs a preferred working day, tomorrow to 30 days out.
  if fulfillment = 'delivery_install' or has_service then
    if preferred_visit_date is null then
      raise exception 'visit_date_required';
    end if;
    if preferred_visit_date <= today or preferred_visit_date > today + 30
       or not exists (select 1 from public.work_days w
                       where w.day_of_week = extract(dow from preferred_visit_date) and w.is_working) then
      raise exception 'invalid_visit_date';
    end if;
  else
    preferred_visit_date := null;
  end if;

  v_vat := round((v_subtotal + v_install + v_shipping) * s.vat_rate, 2);
  v_total := v_subtotal + v_install + v_shipping + v_vat;

  -- Remember the address for next time (same pin → same address).
  select a.id into v_addr from public.addresses a
   where a.customer_id = uid and a.is_active
     and abs(a.lat - create_order.lat) < 0.00001 and abs(a.lng - create_order.lng) < 0.00001
   limit 1;
  if v_addr is null then
    insert into public.addresses (customer_id, city, neighborhood_id, street, lat, lng, is_default, last_used_at)
    values (uid, case when v_zone = 'mecca' then 'makkah' else 'outside' end,
            case when v_zone = 'mecca' then hood.id end, nullif(btrim(street), ''), lat, lng, true, now())
    returning id into v_addr;
  else
    update public.addresses
       set neighborhood_id = case when v_zone = 'mecca' then hood.id end,
           street = nullif(btrim(create_order.street), ''),
           is_default = true,
           last_used_at = now()
     where id = v_addr;
  end if;

  insert into public.orders (
    customer_id, fulfillment, zone, address_id, city, neighborhood_id, neighborhood_name,
    street, address_notes, lat, lng, contact_name, contact_phone, preferred_visit_date, customer_notes,
    vat_rate, subtotal, install_units, install_fee, shipping_fee, vat_amount, total
  ) values (
    uid, fulfillment, v_zone, v_addr, v_city,
    case when v_zone = 'mecca' then hood.id end, case when v_zone = 'mecca' then hood.name_ar end,
    nullif(btrim(street), ''), nullif(btrim(address_notes), ''), lat, lng,
    cust.full_name, cust.phone, preferred_visit_date, nullif(btrim(customer_notes), ''),
    s.vat_rate, v_subtotal, n_install, v_install, v_shipping, v_vat, v_total
  )
  returning * into o;

  insert into public.order_items (order_id, product_id, sku, name_ar, type, qty, unit_price, line_total, installable)
  select o.id, l.product_id, l.sku, l.name_ar, l.type, l.qty, l.unit_price, l.unit_price * l.qty, l.installable
    from pg_temp.order_lines l;

  insert into public.payment_requests (order_id, amount_halalas)
  values (o.id, (round(v_total * 100))::integer);

  return jsonb_build_object('id', o.id, 'order_number', o.order_number, 'total', o.total, 'expires_at', o.expires_at);
end;
$$;
