-- Day 10 (home page, second pass): the lists and the chart beside the
-- numbers of dashboard_summary(). Needs dashboard:view; each block is
-- filled only for staff who can see its page, like dashboard_summary():
--
--   chart       (reports)       store + maintenance sales per day, last 30 days,
--                               and this month so far vs. the same days last month
--   visits      (appointments)  today's visits, by time
--   actions     (per page)      what needs someone now
--   activity    (audit_log)     the last 10 changes
--   technicians (payments)      this month: closed visits, cash collected, cash held

create function public.dashboard_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_month date := date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date;
  v_prev date := (date_trunc('month', (now() at time zone 'Asia/Riyadh')) - interval '1 month')::date;
  v_out jsonb := '{}'::jsonb;
  v_actions jsonb := '[]'::jsonb;
  v_n integer;
begin
  if not public.has_permission('dashboard', 'view') then
    raise exception 'forbidden';
  end if;

  if public.has_permission('reports', 'view') then
    v_out := v_out || jsonb_build_object('chart', jsonb_build_object(
      'days', (
        select jsonb_agg(jsonb_build_object(
          'd', g.d,
          'store', (select coalesce(sum(o.total), 0) from public.orders o
                     where o.paid_at is not null and o.status <> 'cancelled'
                       and (o.paid_at at time zone 'Asia/Riyadh')::date = g.d),
          'service', (select coalesce(sum(p.amount), 0) from public.service_payments p
                       where (p.created_at at time zone 'Asia/Riyadh')::date = g.d)
        ) order by g.d)
        from (select gs::date as d from generate_series(v_today - 29, v_today, interval '1 day') gs) g
      ),
      -- This month so far, and the same number of days of last month.
      'month_to_date', (
        (select coalesce(sum(o.total), 0) from public.orders o
          where o.paid_at is not null and o.status <> 'cancelled'
            and (o.paid_at at time zone 'Asia/Riyadh')::date between v_month and v_today)
        + (select coalesce(sum(p.amount), 0) from public.service_payments p
            where (p.created_at at time zone 'Asia/Riyadh')::date between v_month and v_today)),
      'prev_month_to_date', (
        (select coalesce(sum(o.total), 0) from public.orders o
          where o.paid_at is not null and o.status <> 'cancelled'
            and (o.paid_at at time zone 'Asia/Riyadh')::date between v_prev and least(v_prev + (v_today - v_month), v_month - 1))
        + (select coalesce(sum(p.amount), 0) from public.service_payments p
            where (p.created_at at time zone 'Asia/Riyadh')::date between v_prev and least(v_prev + (v_today - v_month), v_month - 1)))
    ));
  end if;

  if public.has_permission('appointments', 'view') then
    v_out := v_out || jsonb_build_object('visits', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'number', r.request_number, 'kind', r.kind, 'status', r.status,
        'at', r.scheduled_at, 'name', r.contact_name, 'area', r.neighborhood_name,
        'technician', t.full_name
      ) order by r.scheduled_at), '[]'::jsonb)
      from public.service_requests r
      left join public.technicians t on t.id = r.technician_id
      where r.status in ('scheduled', 'in_progress', 'done')
        and (r.scheduled_at at time zone 'Asia/Riyadh')::date = v_today
    ));

    select count(*) into v_n from public.service_requests where status = 'new' and kind = 'emergency';
    if v_n > 0 then
      v_actions := v_actions || jsonb_build_object('key', 'emergency', 'n', v_n, 'level', 'bad', 'to', '/p/appointments');
    end if;
    select count(*) into v_n from public.service_requests where status = 'new' and kind = 'maintenance';
    if v_n > 0 then
      v_actions := v_actions || jsonb_build_object('key', 'unscheduled', 'n', v_n, 'level', 'warn', 'to', '/p/appointments');
    end if;
    select count(*) into v_n from public.service_requests
     where status = 'scheduled' and scheduled_at < now() - interval '2 hours';
    if v_n > 0 then
      v_actions := v_actions || jsonb_build_object('key', 'late_visits', 'n', v_n, 'level', 'warn', 'to', '/p/appointments');
    end if;
  end if;

  if public.has_permission('orders', 'view') then
    select count(*) into v_n from public.orders where status = 'paid';
    if v_n > 0 then
      v_actions := v_actions || jsonb_build_object('key', 'orders_to_prepare', 'n', v_n, 'level', 'warn', 'to', '/p/orders');
    end if;
  end if;

  if public.has_permission('work_orders', 'view') then
    select count(*) into v_n from public.work_orders where status = 'report';
    if v_n > 0 then
      v_actions := v_actions || jsonb_build_object('key', 'quotes_to_price', 'n', v_n, 'level', 'warn', 'to', '/p/work_orders');
    end if;
    select count(*) into v_n from public.work_orders
     where status = 'quote' and decision is null and quote_at < now() - interval '1 day';
    if v_n > 0 then
      v_actions := v_actions || jsonb_build_object('key', 'quotes_waiting', 'n', v_n, 'level', 'info', 'to', '/p/work_orders');
    end if;
    select count(*) into v_n from public.work_orders where status = 'paid';
    if v_n > 0 then
      v_actions := v_actions || jsonb_build_object('key', 'paid_not_closed', 'n', v_n, 'level', 'info', 'to', '/p/work_orders');
    end if;
  end if;

  if public.has_permission('payments', 'view') then
    select count(*) into v_n from public.custodies
     where status = 'open' and created_at < now() - interval '1 day';
    if v_n > 0 then
      v_actions := v_actions || jsonb_build_object('key', 'old_custody', 'n', v_n, 'level', 'warn', 'to', '/p/payments');
    end if;
  end if;

  if public.has_permission('payments', 'approve') or public.has_permission('inventory', 'approve') then
    select count(*) into v_n from public.approvals where status = 'pending';
    if v_n > 0 then
      v_actions := v_actions || jsonb_build_object('key', 'approvals', 'n', v_n, 'level', 'warn', 'to', '/approvals');
    end if;
  end if;

  v_out := v_out || jsonb_build_object('actions', v_actions);

  if public.has_permission('audit_log', 'view') then
    v_out := v_out || jsonb_build_object('activity', (
      select coalesce(jsonb_agg(x order by x.id desc), '[]'::jsonb) from (
        select a.id, a.created_at as at, a.action, a.entity,
               coalesce(sp.full_name, case when a.actor is null then null else 'عميل' end) as who,
               coalesce(a.after, a.before) ->> 'status' as status,
               coalesce(
                 coalesce(a.after, a.before) ->> 'order_number',
                 coalesce(a.after, a.before) ->> 'request_number',
                 coalesce(a.after, a.before) ->> 'number',
                 coalesce(a.after, a.before) ->> 'name_ar',
                 coalesce(a.after, a.before) ->> 'full_name'
               ) as label,
               case when a.entity = 'discount' then (a.after ->> 'discount')::numeric end as discount
        from public.audit_log a
        left join public.staff_profiles sp on sp.user_id = a.actor
        -- Skip noisy rows nobody needs on the home page.
        where a.entity not in ('stock_movements', 'payment_requests', 'role_permissions', 'product_images', 'work_days')
        order by a.id desc
        limit 10
      ) x
    ));
  end if;

  if public.has_permission('payments', 'view') then
    v_out := v_out || jsonb_build_object('technicians', (
      select coalesce(jsonb_agg(x order by x.closed desc, x.name), '[]'::jsonb) from (
        select t.full_name as name,
               (select count(*) from public.work_orders w
                 join public.service_requests r on r.id = w.request_id
                 where r.technician_id = t.id and w.status = 'closed' and not w.customer_absent
                   and (w.closed_at at time zone 'Asia/Riyadh')::date >= v_month)::int as closed,
               (select coalesce(sum(p.amount), 0) from public.service_payments p
                 where p.technician_id = t.id and p.method = 'cash'
                   and (p.created_at at time zone 'Asia/Riyadh')::date >= v_month) as cash,
               (select coalesce(sum(c.amount), 0) from public.custodies c
                 where c.technician_id = t.id and c.status = 'open') as holding
        from public.technicians t
        where t.is_active
      ) x
    ));
  end if;

  return v_out;
end;
$$;

revoke execute on function public.dashboard_home() from public, anon;
grant execute on function public.dashboard_home() to authenticated;
