-- Day 8: filter reminders are set from the dashboard settings.
--   * on / off
--   * from: start reminding N days before the filter is due (maintenance_alert_days, already there)
--   * to:   stop showing a device N days after it became overdue (0 = keep showing)
--   * after the customer declines: back on the list after N days
--   * the WhatsApp message staff send, with {الاسم} {الجهاز} {الفلاتر} {الموعد}

alter table public.settings
  add column maintenance_reminders_on boolean not null default true,
  add column maintenance_overdue_days smallint not null default 60 check (maintenance_overdue_days between 0 and 365),
  add column maintenance_decline_days smallint not null default 90 check (maintenance_decline_days between 7 and 365),
  add column maintenance_wa_message text not null default
    'السلام عليكم {الاسم}، معك تنقية غيث. حان موعد تغيير فلاتر جهازك ({الجهاز}). متى يناسبك نزورك؟ الصباح أو المساء؟'
    check (char_length(btrim(maintenance_wa_message)) between 10 and 500);

alter table public.settings
  add constraint settings_maintenance_alert_days_max check (maintenance_alert_days <= 180);

grant update (maintenance_reminders_on, maintenance_overdue_days, maintenance_decline_days, maintenance_wa_message)
  on public.settings to authenticated;

-- The due list follows the settings window.
create or replace function public.maintenance_due()
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
  st public.settings%rowtype;
begin
  if not public.has_permission('appointments', 'view') then
    raise exception 'not_allowed';
  end if;
  select * into st from public.settings s where s.id = 1;
  if not coalesce(st.maintenance_reminders_on, true) then
    return;
  end if;
  return query
  select d.id, d.name_ar, d.model, d.customer_id, c.full_name, coalesce(c.phone, d.owner_phone),
         min(f.next_due_on),
         array_agg(f.name_ar order by f.next_due_on) filter (where f.next_due_on <= today + st.maintenance_alert_days),
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
  having min(f.next_due_on) <= today + st.maintenance_alert_days
     and (st.maintenance_overdue_days = 0 or min(f.next_due_on) >= today - st.maintenance_overdue_days)
   order by min(f.next_due_on);
end;
$$;

-- Staff record the customer's answer to the reminder.
--   agreed    → a maintenance request on the chosen day/period
--   postponed → off the list until the new date
--   declined  → off the list for settings.maintenance_decline_days
--   no_answer → stays on the list
create or replace function public.maintenance_log_contact(
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
    update public.customer_devices set next_contact_on = today + (select s.maintenance_decline_days from public.settings s where s.id = 1) where id = d.id;
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
