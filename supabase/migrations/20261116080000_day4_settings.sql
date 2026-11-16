-- =====================================================================
-- Ghaith platform — Day 4, step 4: operational settings page.
--
-- Staff with settings:edit may change only operational values. Integration
-- secrets (payment, SMS, shipping) never live in these tables: they go in
-- Edge Function secrets when each integration is built.
-- =====================================================================

revoke update on public.settings from authenticated;
grant update (
  vat_rate, install_fee, inspection_fee, shipping_fee,
  charge_inspection_if_absent, maintenance_alert_days, technician_link_hours
) on public.settings to authenticated;

revoke update on public.work_days from authenticated;
grant update (is_working, start_time, end_time) on public.work_days to authenticated;

-- A day off carries no hours.
create function public.work_days_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not new.is_working then
    new.start_time := null;
    new.end_time := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.work_days_normalize() from public, anon, authenticated;

create trigger work_days_normalize before update on public.work_days
  for each row execute function public.work_days_normalize();

create function public.neighborhoods_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name_ar := btrim(regexp_replace(new.name_ar, '\s+', ' ', 'g'));
  if length(new.name_ar) < 2 then
    raise exception 'invalid_name';
  end if;
  return new;
end;
$$;

revoke execute on function public.neighborhoods_normalize() from public, anon, authenticated;

create trigger neighborhoods_normalize before insert or update on public.service_neighborhoods
  for each row execute function public.neighborhoods_normalize();

revoke update on public.service_neighborhoods from authenticated;
grant update (name_ar, is_active, sort_order) on public.service_neighborhoods to authenticated;
revoke insert on public.service_neighborhoods from authenticated;
grant insert (name_ar, sort_order) on public.service_neighborhoods to authenticated;
