-- Day 10: manager home numbers and the basic reports.
--
--   * dashboard_summary(): the five morning numbers. Needs dashboard:view;
--     each block is filled only for staff who can see its page
--     (money: reports, orders: orders, visits: appointments,
--     cash and approvals: payments, stock: inventory, discounts: audit_log).
--     Others get null.
--   * report_summary(from, to): one date range (Mecca days, inclusive) for
--     the «التقارير» page. Needs reports:view.
--
-- A store sale counts when the order is paid (paid_at) and not cancelled.
-- A maintenance sale counts when it is collected (service_payments).

create function public.dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
  v_month date := date_trunc('month', (now() at time zone 'Asia/Riyadh'))::date;
  v_out jsonb := '{}'::jsonb;
begin
  if not public.has_permission('dashboard', 'view') then
    raise exception 'forbidden';
  end if;

  if public.has_permission('reports', 'view') then
    v_out := v_out || jsonb_build_object('sales', jsonb_build_object(
      'store_today', (select coalesce(sum(o.total), 0) from public.orders o
                       where o.paid_at is not null and o.status <> 'cancelled'
                         and (o.paid_at at time zone 'Asia/Riyadh')::date = v_today),
      'store_month', (select coalesce(sum(o.total), 0) from public.orders o
                       where o.paid_at is not null and o.status <> 'cancelled'
                         and (o.paid_at at time zone 'Asia/Riyadh')::date >= v_month),
      'service_today', (select coalesce(sum(p.amount), 0) from public.service_payments p
                         where (p.created_at at time zone 'Asia/Riyadh')::date = v_today),
      'service_month', (select coalesce(sum(p.amount), 0) from public.service_payments p
                         where (p.created_at at time zone 'Asia/Riyadh')::date >= v_month)
    ));
  end if;

  if public.has_permission('orders', 'view') then
    v_out := v_out || jsonb_build_object('orders', jsonb_build_object(
      'to_prepare', (select count(*) from public.orders o where o.status = 'paid'),
      'in_progress', (select count(*) from public.orders o where o.status in ('preparing', 'shipped', 'installing')),
      'awaiting_payment', (select count(*) from public.orders o where o.status = 'pending_payment' and o.expires_at > now())
    ));
  end if;

  if public.has_permission('appointments', 'view') then
    v_out := v_out || jsonb_build_object('visits', jsonb_build_object(
      'today', (select count(*) from public.service_requests r
                 where r.status in ('scheduled', 'in_progress')
                   and (r.scheduled_at at time zone 'Asia/Riyadh')::date = v_today),
      'unscheduled', (select count(*) from public.service_requests r where r.status = 'new'),
      'emergency_unscheduled', (select count(*) from public.service_requests r where r.status = 'new' and r.kind = 'emergency')
    ));
  end if;

  if public.has_permission('payments', 'view') then
    v_out := v_out || jsonb_build_object('cash', jsonb_build_object(
      'custody_amount', (select coalesce(sum(c.amount), 0) from public.custodies c where c.status = 'open'),
      'custody_count', (select count(*) from public.custodies c where c.status = 'open'),
      'approvals_pending', (select count(*) from public.approvals a where a.status = 'pending')
    ));
  end if;

  if public.has_permission('inventory', 'view') then
    v_out := v_out || jsonb_build_object('stock', (
      select jsonb_build_object(
        'low_count', count(*),
        'out_count', count(*) filter (where coalesce(s.on_hand, 0) <= 0),
        'items', coalesce(jsonb_agg(jsonb_build_object('name', p.name_ar, 'on_hand', coalesce(s.on_hand, 0))
                   order by coalesce(s.on_hand, 0), p.name_ar), '[]'::jsonb)
      )
      from public.products p
      left join public.stock_levels s on s.product_id = p.id
      where p.tracks_stock and p.status = 'published'
        and (coalesce(s.on_hand, 0) < 0 or (p.reorder_level > 0 and coalesce(s.on_hand, 0) <= p.reorder_level))
    ));
  end if;

  if public.has_permission('audit_log', 'view') then
    v_out := v_out || jsonb_build_object('discounts', (
      select jsonb_build_object(
        'today_count', count(*) filter (where (a.created_at at time zone 'Asia/Riyadh')::date = v_today),
        'today_amount', coalesce(sum((a.after ->> 'discount')::numeric) filter (where (a.created_at at time zone 'Asia/Riyadh')::date = v_today), 0),
        'week_count', count(*),
        'week_amount', coalesce(sum((a.after ->> 'discount')::numeric), 0)
      )
      from public.audit_log a
      where a.entity = 'discount' and (a.created_at at time zone 'Asia/Riyadh')::date > v_today - 7
    ));
  end if;

  return v_out || jsonb_build_object('today', v_today);
end;
$$;

revoke execute on function public.dashboard_summary() from public, anon;
grant execute on function public.dashboard_summary() to authenticated;

create function public.report_summary(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if not public.has_permission('reports', 'view') then
    raise exception 'forbidden';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid_range';
  end if;
  if p_to - p_from > 366 then
    raise exception 'range_too_long';
  end if;

  with
  paid as (
    select o.*, (o.paid_at at time zone 'Asia/Riyadh')::date as d
    from public.orders o
    where o.paid_at is not null and o.status <> 'cancelled'
      and (o.paid_at at time zone 'Asia/Riyadh')::date between p_from and p_to
  ),
  created as (
    select o.status from public.orders o
    where (o.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to
  ),
  sp as (
    select p.*, (p.created_at at time zone 'Asia/Riyadh')::date as d
    from public.service_payments p
    where (p.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to
  ),
  sr as (
    select r.kind, r.status from public.service_requests r
    where (r.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to
  ),
  wo as (
    select w.* from public.work_orders w
    where w.closed_at is not null and (w.closed_at at time zone 'Asia/Riyadh')::date between p_from and p_to
  ),
  days as (
    select g::date as d from generate_series(p_from, p_to, interval '1 day') g
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'store', jsonb_build_object(
      'paid_orders', (select count(*) from paid),
      'total', (select coalesce(sum(total), 0) from paid),
      'vat', (select coalesce(sum(vat_amount), 0) from paid),
      'install_fees', (select coalesce(sum(install_fee), 0) from paid),
      'shipping_fees', (select coalesce(sum(shipping_fee), 0) from paid),
      'average', (select coalesce(round(avg(total), 2), 0) from paid),
      'created', (select count(*) from created),
      'cancelled', (select count(*) from created where status = 'cancelled'),
      'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                    from (select status, count(*) n from created group by status) x)
    ),
    'service', jsonb_build_object(
      'requests', (select count(*) from sr),
      'emergency', (select count(*) from sr where kind = 'emergency'),
      'maintenance', (select count(*) from sr where kind = 'maintenance'),
      'cancelled', (select count(*) from sr where status = 'cancelled'),
      'closed_work_orders', (select count(*) from wo where status = 'closed'),
      'customer_absent', (select count(*) from wo where customer_absent),
      'rejected_quotes', (select count(*) from wo where decision = 'rejected'),
      'total', (select coalesce(sum(amount), 0) from sp)
    ),
    'collections', jsonb_build_object(
      'store_card', (select coalesce(sum(p.amount_halalas), 0) / 100.0 from public.payments p
                      where p.status = 'paid'
                        and (p.created_at at time zone 'Asia/Riyadh')::date between p_from and p_to),
      'service_card', (select coalesce(sum(amount), 0) from sp where method = 'moyasar'),
      'service_cash', (select coalesce(sum(amount), 0) from sp where method = 'cash'),
      'custody_open', (select coalesce(sum(c.amount), 0) from public.custodies c where c.status = 'open')
    ),
    'top_products', (
      select coalesce(jsonb_agg(t order by t.revenue desc), '[]'::jsonb) from (
        select i.name_ar as name, i.sku, sum(i.qty)::int as qty, sum(i.line_total) as revenue
        from public.order_items i join paid on paid.id = i.order_id
        group by i.name_ar, i.sku
        order by sum(i.line_total) desc
        limit 10
      ) t
    ),
    'parts_used', (
      select coalesce(jsonb_agg(t order by t.qty desc), '[]'::jsonb) from (
        select pt.name_ar as name, sum(pt.qty)::int as qty
        from public.work_order_parts pt join wo on wo.id = pt.work_order_id
        where wo.status = 'closed' and wo.decision = 'approved'
        group by pt.name_ar
        order by sum(pt.qty) desc
        limit 10
      ) t
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'd', days.d,
        'orders', (select count(*) from paid where paid.d = days.d),
        'store', (select coalesce(sum(total), 0) from paid where paid.d = days.d),
        'service', (select coalesce(sum(amount), 0) from sp where sp.d = days.d)
      ) order by days.d)
      from days
    )
  ) into v_out;

  return v_out;
end;
$$;

revoke execute on function public.report_summary(date, date) from public, anon;
grant execute on function public.report_summary(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Discounts no longer wait for a manager. The quote goes to the customer
-- at once, and the manager gets an alert row in the audit log
-- (entity 'discount') plus a count on the home page.
-- ---------------------------------------------------------------------
create or replace function public.wo_quote(p_work_order_id uuid, p_labor_fee numeric, p_discount numeric default 0, p_discount_reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.work_orders%rowtype;
  st public.settings%rowtype;
  v_parts numeric;
  v_base numeric;
  v_gross numeric;
  v_disc numeric := round(coalesce(p_discount, 0), 2);
  v_why text := nullif(btrim(coalesce(p_discount_reason, '')), '');
  v_number text;
begin
  if not public.has_permission('work_orders', 'edit') then
    raise exception 'not_allowed';
  end if;
  select * into w from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'work_order_not_found';
  end if;
  if w.status not in ('report', 'quote', 'approval') or w.decision is not null then
    raise exception 'invalid_transition';
  end if;
  if p_labor_fee is null or p_labor_fee < 0 or p_labor_fee > 100000 or v_disc < 0 then
    raise exception 'invalid_amount';
  end if;
  if v_disc > 0 and v_why is null then
    raise exception 'reason_required';
  end if;
  if length(coalesce(v_why, '')) > 300 then
    raise exception 'note_too_long';
  end if;
  select * into st from public.settings where id = 1;

  update public.work_order_parts p set unit_price = pr.price_before_vat
    from public.products pr where pr.id = p.product_id and p.work_order_id = w.id;
  select coalesce(sum(p.qty * p.unit_price), 0) into v_parts from public.work_order_parts p where p.work_order_id = w.id;
  v_gross := v_parts + round(p_labor_fee, 2) + w.inspection_fee;
  if v_disc > v_gross then
    raise exception 'discount_too_big';
  end if;
  v_base := v_gross - v_disc;

  update public.work_orders
     set labor_fee = round(p_labor_fee, 2), discount = v_disc, discount_reason = v_why,
         vat_rate = st.vat_rate, subtotal = v_base, vat = round(v_base * st.vat_rate, 2),
         total = v_base + round(v_base * st.vat_rate, 2),
         status = 'quote', quote_at = now(), quote_by = auth.uid()
   where id = w.id
  returning number into v_number;

  -- Any old discount request for this work order is no longer needed.
  delete from public.approvals where work_order_id = w.id and kind = 'discount' and status = 'pending';

  if v_disc > 0 and v_disc is distinct from w.discount then
    insert into public.audit_log (actor, action, entity, entity_id, before, after)
    values (auth.uid(), 'INSERT', 'discount', w.id::text,
            case when coalesce(w.discount, 0) > 0 then jsonb_build_object('discount', w.discount) end,
            jsonb_build_object('number', v_number, 'discount', v_disc, 'reason', v_why,
                               'before_discount', v_gross, 'total', v_base + round(v_base * st.vat_rate, 2)));
  end if;
  return 'quote';
end;
$$;

revoke execute on function public.wo_quote(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.wo_quote(uuid, numeric, numeric, text) to authenticated;

-- Work orders already waiting on a discount approval go to the customer now.
update public.work_orders set status = 'quote', quote_at = now() where status = 'approval';
delete from public.approvals where kind = 'discount' and status = 'pending';
