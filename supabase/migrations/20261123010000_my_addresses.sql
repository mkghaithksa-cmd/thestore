-- «عناويني»: the customer's address book.
--   * building_note: floor, door colour… for the driver and the technician.
--   * address_save(): add or edit one address; a new pin within 50 m of a
--     saved one updates that one instead of adding a copy; at most 5.
--   * address_remove(): hides an address (orders keep their copy).
--   * A maintenance request copies the address's building note.

alter table public.addresses
  add column building_note text check (building_note is null or length(building_note) <= 200);

alter table public.service_requests
  add column building_note text check (building_note is null or length(building_note) <= 200);

grant insert (building_note) on public.addresses to authenticated;
grant update (building_note) on public.addresses to authenticated;

-- Distance in metres between two pins (good enough at city scale).
create function public.pin_distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)));
$$;

create function public.address_save(
  p_id uuid,
  p_label text,
  p_lat double precision,
  p_lng double precision,
  p_neighborhood_name text,
  p_street text,
  p_building_note text,
  p_default boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_id uuid := p_id;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_hood text := nullif(btrim(coalesce(p_neighborhood_name, '')), '');
  v_street text := nullif(btrim(coalesce(p_street, '')), '');
  v_note text := nullif(btrim(coalesce(p_building_note, '')), '');
  v_mecca boolean;
begin
  if uid is null or not exists (select 1 from public.customers where id = uid) then
    raise exception 'not_allowed';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'pin_required';
  end if;
  if length(coalesce(v_label, '')) > 50 or length(coalesce(v_hood, '')) > 80
     or length(coalesce(v_street, '')) > 300 or length(coalesce(v_note, '')) > 200 then
    raise exception 'too_long';
  end if;
  v_mecca := public.is_in_service_area(p_lat, p_lng);

  if v_id is not null then
    if not exists (select 1 from public.addresses where id = v_id and customer_id = uid and is_active) then
      raise exception 'address_not_found';
    end if;
  else
    -- Same house (within 50 m): update the saved one.
    select a.id into v_id from public.addresses a
     where a.customer_id = uid and a.is_active and a.lat is not null
       and public.pin_distance_m(a.lat, a.lng, p_lat, p_lng) <= 50
     order by public.pin_distance_m(a.lat, a.lng, p_lat, p_lng)
     limit 1;
  end if;

  if v_id is null then
    if (select count(*) from public.addresses where customer_id = uid and is_active) >= 5 then
      raise exception 'too_many_addresses';
    end if;
    insert into public.addresses (customer_id, label, city, neighborhood_id, neighborhood_name, street, building_note, lat, lng, is_default, last_used_at)
    values (uid, v_label, case when v_mecca then 'makkah' else 'outside' end,
            case when v_mecca then (select n.id from public.service_neighborhoods n
                                     where n.is_active and public.hood_key(n.name_ar) = public.hood_key(v_hood) limit 1) end,
            v_hood, v_street, v_note, p_lat, p_lng,
            coalesce(p_default, false)
              or not exists (select 1 from public.addresses x where x.customer_id = uid and x.is_active and x.is_default),
            now())
    returning id into v_id;
  else
    update public.addresses
       set label = coalesce(v_label, label),
           city = case when v_mecca then 'makkah' else 'outside' end,
           neighborhood_id = case when v_mecca then (select n.id from public.service_neighborhoods n
                                     where n.is_active and public.hood_key(n.name_ar) = public.hood_key(v_hood) limit 1) end,
           neighborhood_name = v_hood,
           street = v_street,
           building_note = v_note,
           lat = p_lat,
           lng = p_lng,
           is_default = is_default or coalesce(p_default, false)
     where id = v_id;
  end if;
  return v_id;
end;
$$;

create function public.address_remove(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  was_default boolean;
begin
  select is_default into was_default from public.addresses where id = p_id and customer_id = uid and is_active;
  if not found then
    raise exception 'address_not_found';
  end if;
  update public.addresses set is_active = false, is_default = false where id = p_id;
  -- Keep one default: the most recently used of the rest.
  if was_default then
    update public.addresses set is_default = true
     where id = (select id from public.addresses
                  where customer_id = uid and is_active
                  order by last_used_at desc nulls last, created_at desc limit 1);
  end if;
end;
$$;

revoke execute on function public.address_save(uuid, text, double precision, double precision, text, text, text, boolean) from public, anon;
grant execute on function public.address_save(uuid, text, double precision, double precision, text, text, text, boolean) to authenticated;
revoke execute on function public.address_remove(uuid) from public, anon;
grant execute on function public.address_remove(uuid) to authenticated;
revoke execute on function public.pin_distance_m(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.pin_distance_m(double precision, double precision, double precision, double precision) to authenticated;

-- A maintenance request takes the building note of its address.
create function private.service_request_building_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.building_note is null and new.address_id is not null then
    select a.building_note into new.building_note from public.addresses a where a.id = new.address_id;
  end if;
  return new;
end;
$$;

revoke execute on function private.service_request_building_note() from public, anon, authenticated;

create trigger service_requests_building_note
  before insert or update of address_id on public.service_requests
  for each row execute function private.service_request_building_note();
