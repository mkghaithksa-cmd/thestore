-- =====================================================================
-- Ghaith platform — Day 7: order stages, stock, the customer's account.
--
--  * Orders move through their stages only through the functions below
--    (no direct writes). Every status change is written to order_events,
--    which the customer sees as the order's tracking.
--      paid → preparing → shipped → delivered → completed     (shipping)
--      paid → preparing → delivered → completed               (delivery)
--      paid → preparing → installing → completed              (installation)
--  * Operations staff (orders:edit) move an order forward; cancelling is
--    for the admin (orders:approve); a manual payment or refund needs
--    payments:approve. The customer may cancel before preparing starts.
--  * Stock: one warehouse. Stock is issued when preparing starts (a bundle
--    issues its parts) and returned if the order is cancelled afterwards.
--    The balance may go below zero: selling continues and staff see a
--    shortage alert until the opening stock count is done.
--  * A delivered or installed device appears in the customer's «أجهزتي».
--  * Reviews: only from a customer who received the product; staff approve.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Seller VAT number for the simplified tax invoice (QR)
-- ---------------------------------------------------------------------
alter table public.settings
  add column seller_vat_number text check (seller_vat_number is null or seller_vat_number ~ '^3[0-9]{13}3$');

grant update (seller_vat_number) on public.settings to authenticated;

-- ---------------------------------------------------------------------
-- B. Orders: stage dates, tracking, refunds, history
-- ---------------------------------------------------------------------
alter table public.orders
  add column tracking_number text check (tracking_number is null or length(tracking_number) between 3 and 60),
  add column shipping_carrier text check (shipping_carrier is null or length(shipping_carrier) <= 40),
  add column preparing_at timestamptz,
  add column shipped_at timestamptz,
  add column delivered_at timestamptz,
  add column completed_at timestamptz,
  add column stock_issued_at timestamptz,
  add column refund_status text not null default 'none' check (refund_status in ('none', 'due', 'done'));

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  status text not null,
  note text check (note is null or length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id, id);

-- Each status change leaves one event. A note can be passed by the calling
-- function through the transaction-local setting ghaith.event_note.
create function public.orders_log_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.order_events (order_id, status, note, created_by)
    values (new.id, new.status, nullif(current_setting('ghaith.event_note', true), ''), (select auth.uid()));
  end if;
  return null;
end;
$$;

revoke execute on function public.orders_log_event() from public, anon, authenticated;

create trigger orders_log_event after insert or update of status on public.orders
  for each row execute function public.orders_log_event();

-- Orders placed before Day 7 get their first event.
insert into public.order_events (order_id, status, created_at)
select id, 'pending_payment', created_at from public.orders;
insert into public.order_events (order_id, status, note, created_at)
select id, 'cancelled', cancel_reason, coalesce(cancelled_at, now()) from public.orders where status = 'cancelled';

alter table public.order_events enable row level security;
create policy "order_events: own read" on public.order_events
  for select to authenticated using (
    exists (select 1 from public.orders o where o.id = order_events.order_id and o.customer_id = (select auth.uid()))
  );
create policy "order_events: staff read" on public.order_events
  for select to authenticated using ((select public.has_permission('orders', 'view')));
revoke all on public.order_events from anon;
revoke insert, update, delete, truncate on public.order_events from authenticated;

-- Manual payments (bank transfer / cash) carry a reference and who recorded them.
alter table public.payments
  add column reference text check (reference is null or length(reference) <= 60),
  add column recorded_by uuid references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------
-- C. Stock: one warehouse
-- ---------------------------------------------------------------------
create table public.stock_levels (
  product_id uuid primary key references public.products (id) on delete cascade,
  on_hand integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.stock_movements (
  id bigint generated always as identity primary key,
  product_id uuid not null references public.products (id) on delete restrict,
  qty integer not null check (qty <> 0),
  kind text not null check (kind in ('receive', 'issue', 'return', 'adjust')),
  order_id uuid references public.orders (id) on delete restrict,
  reference text check (reference is null or length(reference) <= 60),
  note text check (note is null or length(note) <= 300),
  balance_after integer not null default 0,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check ((kind in ('issue', 'return')) = (order_id is not null)),
  check (kind <> 'receive' or qty > 0),
  check (kind <> 'issue' or qty < 0),
  check (kind <> 'return' or qty > 0)
);

create index stock_movements_product_idx on public.stock_movements (product_id, id desc);
create index stock_movements_order_idx on public.stock_movements (order_id);

-- The balance follows the movements (and each movement records the balance after it).
create function public.stock_apply_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bal integer;
begin
  insert into public.stock_levels (product_id, on_hand, updated_at)
  values (new.product_id, new.qty, now())
  on conflict (product_id) do update
    set on_hand = public.stock_levels.on_hand + excluded.on_hand, updated_at = now()
  returning on_hand into bal;
  new.balance_after := bal;
  return new;
end;
$$;

revoke execute on function public.stock_apply_movement() from public, anon, authenticated;

create trigger stock_apply_movement before insert on public.stock_movements
  for each row execute function public.stock_apply_movement();

create function public.stock_movements_block_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'stock_movements_are_permanent';
end;
$$;

revoke execute on function public.stock_movements_block_changes() from public, anon, authenticated;

create trigger stock_movements_block_changes before update or delete on public.stock_movements
  for each row execute function public.stock_movements_block_changes();

create trigger stock_movements_audit after insert on public.stock_movements
  for each row execute function public.record_audit();

alter table public.stock_levels    enable row level security;
alter table public.stock_movements enable row level security;
create policy "stock_levels: staff read" on public.stock_levels
  for select to authenticated using ((select public.has_permission('inventory', 'view')));
create policy "stock_movements: staff read" on public.stock_movements
  for select to authenticated using ((select public.has_permission('inventory', 'view')));
revoke all on public.stock_levels, public.stock_movements from anon;
revoke insert, update, delete, truncate on public.stock_levels, public.stock_movements from authenticated;

-- Receive stock (supplier invoice number required).
create function public.stock_receive(p_product_id uuid, p_qty integer, p_reference text, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  ref text := nullif(btrim(p_reference), '');
  m public.stock_movements%rowtype;
begin
  if not (select public.has_permission('inventory', 'add')) then
    raise exception 'not_allowed';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and tracks_stock) then
    raise exception 'not_stocked';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 100000 then
    raise exception 'invalid_qty';
  end if;
  if ref is null or length(ref) > 60 then
    raise exception 'reference_required';
  end if;
  insert into public.stock_movements (product_id, qty, kind, reference, note)
  values (p_product_id, p_qty, 'receive', ref, nullif(btrim(p_note), ''))
  returning * into m;
  return m.balance_after;
end;
$$;

-- Stock count: set the real balance (the difference is recorded with a note).
create function public.stock_count(p_product_id uuid, p_on_hand integer, p_note text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur integer;
  why text := nullif(btrim(p_note), '');
begin
  if not (select public.has_permission('inventory', 'edit')) then
    raise exception 'not_allowed';
  end if;
  if not exists (select 1 from public.products where id = p_product_id and tracks_stock) then
    raise exception 'not_stocked';
  end if;
  if p_on_hand is null or p_on_hand < 0 or p_on_hand > 1000000 then
    raise exception 'invalid_qty';
  end if;
  if why is null or length(why) > 300 then
    raise exception 'note_required';
  end if;
  select coalesce((select on_hand from public.stock_levels where product_id = p_product_id for update), 0) into cur;
  if p_on_hand <> cur then
    insert into public.stock_movements (product_id, qty, kind, note)
    values (p_product_id, p_on_hand - cur, 'adjust', why);
  end if;
  return p_on_hand;
end;
$$;

create function public.stock_set_reorder_level(p_product_id uuid, p_level integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.has_permission('inventory', 'edit')) then
    raise exception 'not_allowed';
  end if;
  if p_level is null or p_level < 0 or p_level > 100000 then
    raise exception 'invalid_qty';
  end if;
  update public.products set reorder_level = p_level where id = p_product_id and tracks_stock;
  if not found then
    raise exception 'not_stocked';
  end if;
end;
$$;

revoke execute on function public.stock_receive(uuid, integer, text, text) from public, anon;
revoke execute on function public.stock_count(uuid, integer, text) from public, anon;
revoke execute on function public.stock_set_reorder_level(uuid, integer) from public, anon;
grant execute on function public.stock_receive(uuid, integer, text, text) to authenticated;
grant execute on function public.stock_count(uuid, integer, text) to authenticated;
grant execute on function public.stock_set_reorder_level(uuid, integer) to authenticated;

-- What an order takes from stock: its stocked products, and the stocked parts of its bundles.
create function private.order_stock_lines(p_order_id uuid)
returns table (product_id uuid, qty integer)
language sql
stable
security definer
set search_path = ''
as $$
  select x.product_id, sum(x.qty)::integer
  from (
    select i.product_id, i.qty
      from public.order_items i
      join public.products p on p.id = i.product_id and p.tracks_stock
     where i.order_id = p_order_id
    union all
    select b.component_product_id, b.qty * i.qty
      from public.order_items i
      join public.bundle_items b on b.bundle_product_id = i.product_id
      join public.products p on p.id = b.component_product_id and p.tracks_stock
     where i.order_id = p_order_id
  ) x
  group by x.product_id;
$$;

revoke execute on function private.order_stock_lines(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- D. The customer's devices («أجهزتي»); maintenance details come on Day 8
-- ---------------------------------------------------------------------
create table public.customer_devices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  order_id uuid references public.orders (id) on delete set null,
  name_ar text not null,
  installed boolean not null default false,
  started_on date not null default ((now() at time zone 'Asia/Riyadh')::date),
  warranty_until date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index customer_devices_customer_idx on public.customer_devices (customer_id);
create index customer_devices_order_idx on public.customer_devices (order_id);

alter table public.customer_devices enable row level security;
create policy "customer_devices: own read" on public.customer_devices
  for select to authenticated using (customer_id = (select auth.uid()));
create policy "customer_devices: staff read" on public.customer_devices
  for select to authenticated using ((select public.has_permission('customers', 'view')));
revoke all on public.customer_devices from anon;
revoke insert, update, delete, truncate on public.customer_devices from authenticated;

create trigger customer_devices_audit after insert or update or delete on public.customer_devices
  for each row execute function public.record_audit();

-- ---------------------------------------------------------------------
-- E. Moving an order through its stages
-- ---------------------------------------------------------------------
create function private.order_issue_stock(o public.orders)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if o.stock_issued_at is not null then
    return;
  end if;
  insert into public.stock_movements (product_id, qty, kind, order_id, reference)
  select l.product_id, -l.qty, 'issue', o.id, o.order_number from private.order_stock_lines(o.id) l;
  update public.orders set stock_issued_at = now() where id = o.id;
end;
$$;

create function private.order_return_stock(o public.orders)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if o.stock_issued_at is null then
    return;
  end if;
  insert into public.stock_movements (product_id, qty, kind, order_id, reference)
  select m.product_id, -sum(m.qty)::integer, 'return', o.id, o.order_number
    from public.stock_movements m
   where m.order_id = o.id
   group by m.product_id
  having sum(m.qty) < 0;
  update public.orders set stock_issued_at = null where id = o.id;
end;
$$;

create function private.order_register_devices(o public.orders)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.customer_devices where order_id = o.id) then
    return;
  end if;
  insert into public.customer_devices (customer_id, product_id, order_id, name_ar, installed, warranty_until)
  select o.customer_id, d.id, o.id, d.name_ar, o.fulfillment = 'delivery_install',
         case when d.warranty_months > 0
              then ((now() at time zone 'Asia/Riyadh')::date + make_interval(months => d.warranty_months))::date end
    from (
      select p.id, p.name_ar, p.warranty_months, i.qty
        from public.order_items i join public.products p on p.id = i.product_id
       where i.order_id = o.id and p.type = 'device'
      union all
      select p.id, p.name_ar, p.warranty_months, b.qty * i.qty
        from public.order_items i
        join public.bundle_items b on b.bundle_product_id = i.product_id
        join public.products p on p.id = b.component_product_id
       where i.order_id = o.id and p.type = 'device'
    ) d
    cross join lateral generate_series(1, least(d.qty, 20));
end;
$$;

revoke execute on function private.order_issue_stock(public.orders) from public, anon, authenticated;
revoke execute on function private.order_return_stock(public.orders) from public, anon, authenticated;
revoke execute on function private.order_register_devices(public.orders) from public, anon, authenticated;

create function public.order_advance(
  p_order_id uuid,
  p_to text,
  p_tracking_number text default null,
  p_carrier text default null,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  ok boolean;
  trk text := nullif(btrim(p_tracking_number), '');
begin
  if not (select public.has_permission('orders', 'edit')) then
    raise exception 'not_allowed';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;

  ok := case o.status
    when 'paid'       then p_to = 'preparing'
    when 'preparing'  then p_to = case o.fulfillment when 'shipping' then 'shipped'
                                                     when 'delivery_install' then 'installing'
                                                     else 'delivered' end
    when 'shipped'    then p_to = 'delivered'
    when 'installing' then p_to = 'completed'
    when 'delivered'  then p_to = 'completed'
    else false
  end;
  if not coalesce(ok, false) then
    raise exception 'invalid_transition';
  end if;
  if p_to = 'shipped' and (trk is null or length(trk) < 3 or length(trk) > 60) then
    raise exception 'tracking_required';
  end if;
  if p_note is not null and length(p_note) > 300 then
    raise exception 'invalid_note';
  end if;

  perform set_config('ghaith.event_note', coalesce(nullif(btrim(p_note), ''), ''), true);
  update public.orders
     set status = p_to,
         preparing_at = case when p_to = 'preparing' then now() else preparing_at end,
         shipped_at = case when p_to = 'shipped' then now() else shipped_at end,
         tracking_number = case when p_to = 'shipped' then trk else tracking_number end,
         shipping_carrier = case when p_to = 'shipped' then left(nullif(btrim(p_carrier), ''), 40) else shipping_carrier end,
         delivered_at = case when p_to = 'delivered' then now() else delivered_at end,
         completed_at = case when p_to = 'completed' then now() else completed_at end
   where id = o.id
  returning * into o;
  perform set_config('ghaith.event_note', '', true);

  if p_to = 'preparing' then
    perform private.order_issue_stock(o);
  end if;
  if p_to in ('delivered', 'completed') then
    perform private.order_register_devices(o);
  end if;
  return o.status;
end;
$$;

-- Cancel: by the admin at any stage before delivery, with a reason.
create function private.order_cancel(o public.orders, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.order_return_stock(o);
  perform set_config('ghaith.event_note', p_reason, true);
  update public.orders
     set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason,
         refund_status = case when paid_at is not null then 'due' else refund_status end
   where id = o.id;
  perform set_config('ghaith.event_note', '', true);
  update public.payment_requests set status = 'expired' where order_id = o.id and status = 'initiated';
end;
$$;

revoke execute on function private.order_cancel(public.orders, text) from public, anon, authenticated;

create function public.order_cancel_staff(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  why text := nullif(btrim(p_reason), '');
begin
  if not (select public.has_permission('orders', 'approve')) then
    raise exception 'not_allowed';
  end if;
  if why is null or length(why) < 3 or length(why) > 300 then
    raise exception 'reason_required';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if o.status not in ('pending_payment', 'paid', 'preparing', 'shipped', 'installing') then
    raise exception 'cannot_cancel';
  end if;
  perform private.order_cancel(o, why);
end;
$$;

-- The customer cancels their own order before preparing starts.
create function public.order_cancel_mine(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order_id and customer_id = (select auth.uid()) for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if o.status not in ('pending_payment', 'paid') or o.stock_issued_at is not null then
    raise exception 'cannot_cancel';
  end if;
  perform private.order_cancel(o, 'ألغاه العميل');
end;
$$;

-- A payment received outside the site (bank transfer or cash), recorded by the admin.
create function public.order_mark_paid(p_order_id uuid, p_method text, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  ref text := nullif(btrim(p_reference), '');
  req uuid;
begin
  if not (select public.has_permission('payments', 'approve')) then
    raise exception 'not_allowed';
  end if;
  if p_method not in ('bank_transfer', 'cash') then
    raise exception 'invalid_method';
  end if;
  if ref is null or length(ref) < 2 or length(ref) > 60 then
    raise exception 'reference_required';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;
  if o.status <> 'pending_payment' then
    raise exception 'not_pending';
  end if;
  select id into req from public.payment_requests where order_id = o.id order by created_at desc limit 1;
  insert into public.payments (order_id, payment_request_id, provider_payment_id, amount_halalas, status, method, reference, recorded_by)
  values (o.id, req, 'manual-' || gen_random_uuid(), (round(o.total * 100))::integer, 'paid', p_method, ref, (select auth.uid()));
  update public.payment_requests set status = 'paid' where id = req;
  perform set_config('ghaith.event_note',
    case p_method when 'cash' then 'دفع نقدي' else 'تحويل بنكي' end || ' (' || ref || ')', true);
  update public.orders set status = 'paid', paid_at = now() where id = o.id;
  perform set_config('ghaith.event_note', '', true);
end;
$$;

-- The refund of a cancelled, paid order was sent back to the customer.
create function public.order_mark_refunded(p_order_id uuid, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  ref text := nullif(btrim(p_reference), '');
begin
  if not (select public.has_permission('payments', 'approve')) then
    raise exception 'not_allowed';
  end if;
  if ref is null or length(ref) < 2 or length(ref) > 60 then
    raise exception 'reference_required';
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if not found or o.refund_status <> 'due' then
    raise exception 'no_refund_due';
  end if;
  insert into public.payments (order_id, provider_payment_id, amount_halalas, status, method, reference, recorded_by)
  values (o.id, 'manual-refund-' || gen_random_uuid(), (round(o.total * 100))::integer, 'refunded', 'manual', ref, (select auth.uid()));
  update public.orders set refund_status = 'done' where id = o.id;
end;
$$;

revoke execute on function public.order_advance(uuid, text, text, text, text) from public, anon;
revoke execute on function public.order_cancel_staff(uuid, text) from public, anon;
revoke execute on function public.order_cancel_mine(uuid) from public, anon;
revoke execute on function public.order_mark_paid(uuid, text, text) from public, anon;
revoke execute on function public.order_mark_refunded(uuid, text) from public, anon;
grant execute on function public.order_advance(uuid, text, text, text, text) to authenticated;
grant execute on function public.order_cancel_staff(uuid, text) to authenticated;
grant execute on function public.order_cancel_mine(uuid) to authenticated;
grant execute on function public.order_mark_paid(uuid, text, text) to authenticated;
grant execute on function public.order_mark_refunded(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- F. Reviews from customers who received the product (staff approve)
-- ---------------------------------------------------------------------
create unique index reviews_one_per_customer_product on public.reviews (customer_id, product_id)
  where customer_id is not null;

create policy "reviews: own read" on public.reviews
  for select to authenticated using (customer_id = (select auth.uid()));

create function public.review_submit(p_product_id uuid, p_rating integer, p_body text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cust public.customers%rowtype;
  txt text := btrim(regexp_replace(coalesce(p_body, ''), '[ \t]+', ' ', 'g'));
  who text;
begin
  select * into cust from public.customers where id = uid;
  if not found then
    raise exception 'not_a_customer';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'invalid_rating';
  end if;
  if length(txt) > 1000 then
    raise exception 'review_too_long';
  end if;
  if not exists (
    select 1 from public.orders o join public.order_items i on i.order_id = o.id
     where o.customer_id = uid and o.status in ('delivered', 'completed') and i.product_id = p_product_id
  ) then
    raise exception 'not_purchased';
  end if;
  -- First name only on the store.
  who := left(coalesce(nullif(split_part(btrim(cust.full_name), ' ', 1), ''), 'عميل'), 40);
  if length(who) < 2 then
    who := 'عميل';
  end if;
  insert into public.reviews (product_id, customer_id, author_name, rating, body, status)
  values (p_product_id, uid, who, p_rating, txt, 'pending')
  on conflict (customer_id, product_id) where customer_id is not null
  do update set rating = excluded.rating, body = excluded.body, author_name = excluded.author_name,
                status = 'pending', is_featured = false, created_at = now();
  return 'pending';
end;
$$;

revoke execute on function public.review_submit(uuid, integer, text) from public, anon;
grant execute on function public.review_submit(uuid, integer, text) to authenticated;
