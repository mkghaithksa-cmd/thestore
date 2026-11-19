-- =====================================================================
-- Ghaith platform — Day 9: work orders, the technician's link, custody
-- and approvals.
--
--  * Technicians are a simple list (name, phone, active). They have no
--    account: each work order gets a random link, valid for
--    settings.technician_link_hours. Only its SHA-256 hash is stored, and
--    a new link replaces the old one.
--  * The technician page (anon, by token) shows the visit without prices:
--    «وصلت», the inspection result, parts, photos, or «العميل غير موجود».
--    Sending locks the report. Staff can record it on their behalf.
--  * Work order stages:
--      visit → report → (approval) → quote → payment → paid → closed
--    approval: a discount above settings.discount_approval_limit waits for
--              a manager (payments:approve) who did not ask for it.
--    payment:  approved → the full total; rejected → the inspection fee;
--              absent → the inspection fee if charge_inspection_if_absent.
--              Nothing due → closed straight away.
--  * Cash to the technician opens custody on them. Staff record what they
--    received; a difference needs a manager's approval.
--  * Closing issues the approved parts from stock and finishes the request.
--  * Approvals: discount, custody difference, stock-count difference.
--    Nobody approves their own request.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Technicians
-- ---------------------------------------------------------------------
create table public.technicians (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(btrim(full_name)) between 2 and 60),
  phone text not null unique check (phone ~ '^\+9665[0-9]{8}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger technicians_set_updated_at before update on public.technicians
  for each row execute function public.set_updated_at();
create trigger technicians_audit after insert or update or delete on public.technicians
  for each row execute function public.record_audit();

alter table public.technicians enable row level security;
create policy "technicians: staff read" on public.technicians
  for select to authenticated using (
    (select public.has_permission('appointments', 'view'))
    or (select public.has_permission('work_orders', 'view'))
    or (select public.has_permission('payments', 'view'))
    or (select public.has_permission('settings', 'view'))
  );
revoke all on public.technicians from anon;
revoke insert, update, delete, truncate on public.technicians from authenticated;

-- Add or edit a technician (settings:edit).
create function public.technician_save(p_id uuid, p_name text, p_phone text, p_active boolean default true)
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
  if not public.has_permission('settings', 'edit') then
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

-- Requests now point at the technicians list (the old staff picks were tests).
alter table public.service_requests drop constraint if exists service_requests_technician_id_fkey;
update public.service_requests set technician_id = null where technician_id is not null;
alter table public.service_requests
  add constraint service_requests_technician_id_fkey
  foreign key (technician_id) references public.technicians (id) on delete set null;

drop function public.technicians_list();
create function public.technicians_list()
returns table (id uuid, full_name text, phone text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.full_name, t.phone
    from public.technicians t
   where t.is_active
     and (public.has_permission('appointments', 'view') or public.has_permission('work_orders', 'view'))
   order by t.full_name;
$$;

revoke execute on function public.technicians_list() from public, anon;
grant execute on function public.technicians_list() to authenticated;

create or replace function public.request_schedule(
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
    select 1 from public.technicians t where t.id = p_technician_id and t.is_active
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

-- ---------------------------------------------------------------------
-- B. Settings: the discount staff may give without approval
-- ---------------------------------------------------------------------
alter table public.settings
  add column discount_approval_limit numeric(10, 2) not null default 0 check (discount_approval_limit >= 0);

grant update (discount_approval_limit, technician_link_hours) on public.settings to authenticated;

-- ---------------------------------------------------------------------
-- C. Work orders
-- ---------------------------------------------------------------------
create sequence public.work_order_seq start 7001;

create table public.work_orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('WO-' || nextval('public.work_order_seq')),
  request_id uuid not null references public.service_requests (id) on delete restrict,
  status text not null default 'visit'
    check (status in ('visit', 'report', 'approval', 'quote', 'payment', 'paid', 'closed', 'cancelled')),
  -- The visit (from the technician, or staff on their behalf)
  arrived_at timestamptz,
  report_at timestamptz,
  report_by uuid references auth.users (id) on delete set null,  -- null = the technician
  customer_absent boolean not null default false,
  finding text check (finding is null or length(finding) <= 1000),
  tech_note text check (tech_note is null or length(tech_note) <= 500),
  photos text[] not null default '{}' check (cardinality(photos) <= 4),
  -- The quote (prices before VAT; the VAT rate is the one at quote time)
  inspection_fee numeric(10, 2) not null default 0 check (inspection_fee >= 0),
  labor_fee numeric(10, 2) not null default 0 check (labor_fee >= 0),
  discount numeric(10, 2) not null default 0 check (discount >= 0),
  discount_reason text check (discount_reason is null or length(discount_reason) <= 300),
  vat_rate numeric(5, 4) not null default 0,
  subtotal numeric(10, 2) not null default 0,
  vat numeric(10, 2) not null default 0,
  total numeric(10, 2) not null default 0,
  quote_at timestamptz,
  quote_by uuid references auth.users (id) on delete set null,
  -- The customer's answer
  decision text check (decision in ('approved', 'rejected')),
  decision_at timestamptz,
  decision_via text check (decision_via in ('customer', 'staff')),
  decision_by uuid references auth.users (id) on delete set null,
  -- Payment
  amount_due numeric(10, 2) not null default 0 check (amount_due >= 0),
  paid_at timestamptz,
  payment_method text check (payment_method in ('cash', 'moyasar')),
  -- Closing
  closed_at timestamptz,
  closed_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index work_orders_status_idx on public.work_orders (status);
-- One live work order per request (a cancelled one frees the request).
create unique index work_orders_one_live_per_request on public.work_orders (request_id) where status <> 'cancelled';

create trigger work_orders_set_updated_at before update on public.work_orders
  for each row execute function public.set_updated_at();
create trigger work_orders_audit after insert or update or delete on public.work_orders
  for each row execute function public.record_audit();

-- Parts the technician says are needed; the price is set with the quote.
create table public.work_order_parts (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  name_ar text not null,
  qty integer not null check (qty between 1 and 50),
  unit_price numeric(10, 2) check (unit_price is null or unit_price >= 0),
  unique (work_order_id, product_id)
);

create index work_order_parts_wo_idx on public.work_order_parts (work_order_id);

-- The technician's link: only the hash, never readable through the API.
create table public.work_order_links (
  work_order_id uuid primary key references public.work_orders (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

-- Payments for work orders (cash to the technician, or Moyasar).
create table public.service_payments (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete restrict,
  method text not null check (method in ('cash', 'moyasar')),
  amount numeric(10, 2) not null check (amount > 0),
  provider_payment_id text unique,
  technician_id uuid references public.technicians (id) on delete set null,
  raw jsonb,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((method = 'moyasar') = (provider_payment_id is not null))
);

create index service_payments_wo_idx on public.service_payments (work_order_id);

-- Cash held by a technician until staff receive it.
create table public.custodies (
  id uuid primary key default gen_random_uuid(),
  technician_id uuid not null references public.technicians (id) on delete restrict,
  work_order_id uuid not null unique references public.work_orders (id) on delete restrict,
  amount numeric(10, 2) not null check (amount > 0),
  status text not null default 'open' check (status in ('open', 'pending', 'settled')),
  received_amount numeric(10, 2) check (received_amount is null or received_amount >= 0),
  received_at timestamptz,
  received_by uuid references auth.users (id) on delete set null,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index custodies_open_idx on public.custodies (technician_id) where status <> 'settled';

create trigger custodies_set_updated_at before update on public.custodies
  for each row execute function public.set_updated_at();
create trigger custodies_audit after insert or update or delete on public.custodies
  for each row execute function public.record_audit();

-- Approvals: discount, custody difference, stock-count difference.
create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('discount', 'custody_diff', 'stock_diff')),
  amount numeric(10, 2),
  qty integer,
  work_order_id uuid references public.work_orders (id) on delete cascade,
  custody_id uuid references public.custodies (id) on delete cascade,
  product_id uuid references public.products (id) on delete cascade,
  note text check (note is null or length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid references auth.users (id) on delete set null default auth.uid(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 300),
  created_at timestamptz not null default now(),
  check (kind <> 'discount' or work_order_id is not null),
  check (kind <> 'custody_diff' or custody_id is not null),
  check (kind <> 'stock_diff' or (product_id is not null and qty is not null and qty <> 0)),
  check (decided_by is null or decided_by is distinct from requested_by)
);

create index approvals_pending_idx on public.approvals (kind, created_at) where status = 'pending';

create trigger approvals_audit after insert or update or delete on public.approvals
  for each row execute function public.record_audit();

-- RLS: staff read with permission; the customer reads their own work order
-- and its parts (the quote). Nobody writes directly; only the functions below.
alter table public.work_orders      enable row level security;
alter table public.work_order_parts enable row level security;
alter table public.work_order_links enable row level security;
alter table public.service_payments enable row level security;
alter table public.custodies        enable row level security;
alter table public.approvals        enable row level security;

create policy "work_orders: staff read" on public.work_orders
  for select to authenticated using (
    (select public.has_permission('work_orders', 'view')) or (select public.has_permission('appointments', 'view'))
    or (select public.has_permission('payments', 'view'))
  );
create policy "work_orders: own read" on public.work_orders
  for select to authenticated using (
    exists (select 1 from public.service_requests r
             where r.id = work_orders.request_id and r.customer_id = (select auth.uid()))
  );
create policy "work_order_parts: staff read" on public.work_order_parts
  for select to authenticated using (
    (select public.has_permission('work_orders', 'view')) or (select public.has_permission('appointments', 'view'))
    or (select public.has_permission('payments', 'view'))
  );
create policy "work_order_parts: own read" on public.work_order_parts
  for select to authenticated using (
    exists (select 1 from public.work_orders w join public.service_requests r on r.id = w.request_id
             where w.id = work_order_parts.work_order_id and r.customer_id = (select auth.uid()))
  );
create policy "service_payments: staff read" on public.service_payments
  for select to authenticated using (
    (select public.has_permission('payments', 'view')) or (select public.has_permission('work_orders', 'view'))
  );
create policy "service_payments: own read" on public.service_payments
  for select to authenticated using (
    exists (select 1 from public.work_orders w join public.service_requests r on r.id = w.request_id
             where w.id = service_payments.work_order_id and r.customer_id = (select auth.uid()))
  );
create policy "custodies: staff read" on public.custodies
  for select to authenticated using ((select public.has_permission('payments', 'view')));
create policy "approvals: staff read" on public.approvals
  for select to authenticated using (
    requested_by = (select auth.uid())
    or (select public.has_permission('payments', 'approve'))
    or (select public.has_permission('inventory', 'approve'))
  );

revoke all on public.work_orders, public.work_order_parts, public.work_order_links,
  public.service_payments, public.custodies, public.approvals from anon;
revoke insert, update, delete, truncate on public.work_orders, public.work_order_parts,
  public.service_payments, public.custodies, public.approvals from authenticated;
revoke all on public.work_order_links from authenticated;

-- Photos from the technician: a private bucket. The folder is the link's
-- hash, so only someone holding a live link can upload, and only before
-- the report is sent.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('work-order-photos', 'work-order-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- True only for the hash folder of a live link whose report is not sent.
-- (Knowing a hash needs the token itself, so this reveals nothing.)
create function public.tech_upload_ok(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.work_order_links l
      join public.work_orders w on w.id = l.work_order_id
     where l.token_hash = p_folder and l.expires_at > now() and w.status = 'visit'
  );
$$;

revoke execute on function public.tech_upload_ok(text) from public;
grant execute on function public.tech_upload_ok(text) to anon, authenticated;

create policy "work-order-photos: technician upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'work-order-photos' and public.tech_upload_ok(split_part(name, '/', 1)));
create policy "work-order-photos: staff read" on storage.objects
  for select to authenticated
  using (bucket_id = 'work-order-photos' and (
    (select public.has_permission('work_orders', 'view')) or (select public.has_permission('appointments', 'view'))));

-- ---------------------------------------------------------------------
-- D. The technician's link
-- ---------------------------------------------------------------------
create function private.token_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

revoke execute on function private.token_hash(text) from public, anon, authenticated;

-- Staff make (or replace) the technician's link for a scheduled request.
-- The work order is created the first time. Returns the token once.
create function public.wo_link_create(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.service_requests%rowtype;
  w public.work_orders%rowtype;
  tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  hrs integer := (select s.technician_link_hours from public.settings s where s.id = 1);
  exp timestamptz := now() + make_interval(hours => hrs);
begin
  if not (public.has_permission('appointments', 'edit') or public.has_permission('work_orders', 'edit')) then
    raise exception 'not_allowed';
  end if;
  select * into r from public.service_requests where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found';
  end if;
  if r.status not in ('scheduled', 'in_progress') then
    raise exception 'not_scheduled';
  end if;
  if r.technician_id is null then
    raise exception 'technician_required';
  end if;
  select * into w from public.work_orders where request_id = r.id and status <> 'cancelled' for update;
  if not found then
    insert into public.work_orders (request_id, inspection_fee)
    values (r.id, case when r.kind = 'emergency' then r.inspection_fee else 0 end)
    returning * into w;
  elsif w.status <> 'visit' then
    raise exception 'report_already_sent';
  end if;
  insert into public.work_order_links (work_order_id, token_hash, expires_at)
  values (w.id, private.token_hash(tok), exp)
  on conflict (work_order_id) do update
    set token_hash = excluded.token_hash, expires_at = excluded.expires_at,
        created_by = auth.uid(), created_at = now();
  perform private.request_log(r.id, r.status, r.status, null, 'انرسل رابط الفني (' || w.number || ')');
  return jsonb_build_object('work_order_id', w.id, 'number', w.number, 'token', tok, 'expires_at', exp);
end;
$$;

revoke execute on function public.wo_link_create(uuid) from public, anon;
grant execute on function public.wo_link_create(uuid) to authenticated;


-- The work order behind a live link (raises link_invalid otherwise).
create function private.wo_by_token(p_token text, p_lock boolean default false)
returns public.work_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.work_orders%rowtype;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 100 then
    raise exception 'link_invalid';
  end if;
  if p_lock then
    select w2.* into w from public.work_order_links l join public.work_orders w2 on w2.id = l.work_order_id
     where l.token_hash = private.token_hash(p_token) and l.expires_at > now()
       for update of w2;
  else
    select w2.* into w from public.work_order_links l join public.work_orders w2 on w2.id = l.work_order_id
     where l.token_hash = private.token_hash(p_token) and l.expires_at > now();
  end if;
  if not found then
    raise exception 'link_invalid';
  end if;
  return w;
end;
$$;

revoke execute on function private.wo_by_token(text, boolean) from public, anon, authenticated;

-- What the technician sees: the visit and the report. No prices.
create function public.tech_job(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  w public.work_orders%rowtype := private.wo_by_token(p_token);
  r public.service_requests%rowtype;
  d public.customer_devices%rowtype;
begin
  select * into r from public.service_requests where id = w.request_id;
  select * into d from public.customer_devices where id = r.device_id;
  return jsonb_build_object(
    'number', w.number,
    'status', w.status,
    'folder', private.token_hash(p_token),
    'kind', r.kind,
    'request_number', r.request_number,
    'fault_type', r.fault_type,
    'description', r.description,
    'contact_name', r.contact_name,
    'contact_phone', r.contact_phone,
    'neighborhood', r.neighborhood_name,
    'street', r.street,
    'lat', r.lat,
    'lng', r.lng,
    'scheduled_at', r.scheduled_at,
    'technician', (select t.full_name from public.technicians t where t.id = r.technician_id),
    'device', case when d.id is null then null else jsonb_build_object(
      'name', d.name_ar, 'model', d.model, 'ours', d.product_id is not null,
      'filters', coalesce((select jsonb_agg(jsonb_build_object('name', f.name_ar, 'last_changed_on', f.last_changed_on, 'next_due_on', f.next_due_on) order by f.next_due_on)
                             from public.device_filters f where f.device_id = d.id and f.is_active), '[]'::jsonb)) end,
    'arrived_at', w.arrived_at,
    'report_at', w.report_at,
    'customer_absent', w.customer_absent,
    'finding', w.finding,
    'tech_note', w.tech_note,
    'photos', to_jsonb(w.photos),
    'parts', coalesce((select jsonb_agg(jsonb_build_object('product_id', p.product_id, 'name', p.name_ar, 'qty', p.qty) order by p.name_ar)
                         from public.work_order_parts p where p.work_order_id = w.id), '[]'::jsonb),
    'catalog', case when w.status = 'visit' then coalesce((
      select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name_ar, 'type', pr.type) order by pr.type, pr.name_ar)
        from public.products pr where pr.status = 'published' and pr.type in ('filter', 'part')), '[]'::jsonb) end
  );
end;
$$;

-- «وصلت»
create function public.tech_arrive(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.work_orders%rowtype := private.wo_by_token(p_token, true);
  r public.service_requests%rowtype;
begin
  if w.status <> 'visit' then
    raise exception 'report_already_sent';
  end if;
  if w.arrived_at is not null then
    return;
  end if;
  update public.work_orders set arrived_at = now() where id = w.id;
  select * into r from public.service_requests where id = w.request_id for update;
  if r.status = 'scheduled' then
    update public.service_requests set status = 'in_progress' where id = r.id;
    perform private.request_log(r.id, 'scheduled', 'in_progress', null, 'وصل الفني');
  end if;
end;
$$;

-- The report, shared by the technician and by staff on their behalf.
create function private.wo_report(
  w public.work_orders,
  p_absent boolean,
  p_finding text,
  p_note text,
  p_parts jsonb,
  p_photos text[],
  p_by uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.service_requests%rowtype;
  v_finding text := nullif(btrim(coalesce(p_finding, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_photos text[] := coalesce(p_photos, '{}');
  item jsonb;
  pid uuid;
  q integer;
  nm text;
  v_fee numeric;
  v_rate numeric;
  v_st public.settings%rowtype;
  new_status text;
begin
  if w.status <> 'visit' then
    raise exception 'report_already_sent';
  end if;
  if length(coalesce(v_finding, '')) > 1000 or length(coalesce(v_note, '')) > 500 then
    raise exception 'note_too_long';
  end if;
  if cardinality(v_photos) > 4 then
    raise exception 'too_many_photos';
  end if;
  if exists (select 1 from unnest(v_photos) x where x is null or length(x) > 200 or split_part(x, '/', 1) = '' or x like '%..%') then
    raise exception 'invalid_photo';
  end if;
  if not coalesce(p_absent, false) and v_finding is null then
    raise exception 'finding_required';
  end if;
  if p_parts is not null and jsonb_typeof(p_parts) <> 'array' then
    raise exception 'invalid_parts';
  end if;
  if jsonb_array_length(coalesce(p_parts, '[]'::jsonb)) > 20 then
    raise exception 'too_many_parts';
  end if;

  select * into v_st from public.settings where id = 1;
  select * into r from public.service_requests where id = w.request_id for update;

  delete from public.work_order_parts where work_order_id = w.id;
  if not coalesce(p_absent, false) then
    for item in select * from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) loop
      begin
        pid := (item ->> 'product_id')::uuid;
        q := (item ->> 'qty')::integer;
      exception when others then
        raise exception 'invalid_parts';
      end;
      select pr.name_ar into nm from public.products pr
       where pr.id = pid and pr.status = 'published' and pr.type in ('filter', 'part');
      if nm is null or q is null or q < 1 or q > 50 then
        raise exception 'invalid_parts';
      end if;
      insert into public.work_order_parts (work_order_id, product_id, name_ar, qty)
      values (w.id, pid, nm, q)
      on conflict (work_order_id, product_id) do update set qty = least(public.work_order_parts.qty + excluded.qty, 50);
    end loop;
  end if;

  if coalesce(p_absent, false) then
    v_fee := case when v_st.charge_inspection_if_absent then w.inspection_fee else 0 end;
    v_rate := v_st.vat_rate;
    new_status := case when v_fee > 0 then 'payment' else 'closed' end;
    update public.work_orders
       set status = new_status, arrived_at = coalesce(arrived_at, now()), report_at = now(), report_by = p_by,
           customer_absent = true, finding = null, tech_note = v_note, photos = v_photos,
           vat_rate = v_rate,
           subtotal = v_fee, vat = round(v_fee * v_rate, 2), total = v_fee + round(v_fee * v_rate, 2),
           amount_due = v_fee + round(v_fee * v_rate, 2),
           closed_at = case when new_status = 'closed' then now() end,
           closed_by = case when new_status = 'closed' then p_by end
     where id = w.id;
    if new_status = 'closed' then
      update public.service_requests
         set status = 'cancelled', cancelled_at = now(), cancel_reason = 'العميل غير موجود وقت الزيارة'
       where id = r.id;
      perform private.request_log(r.id, r.status, 'cancelled', null, 'العميل غير موجود وقت الزيارة');
    else
      perform private.request_log(r.id, r.status, r.status, null, 'العميل غير موجود وقت الزيارة، مستحق رسوم الفحص');
    end if;
    return new_status;
  end if;

  update public.work_orders
     set status = 'report', arrived_at = coalesce(arrived_at, now()), report_at = now(), report_by = p_by,
         customer_absent = false, finding = v_finding, tech_note = v_note, photos = v_photos
   where id = w.id;
  if r.status = 'scheduled' then
    update public.service_requests set status = 'in_progress' where id = r.id;
  end if;
  perform private.request_log(r.id, r.status, 'in_progress', null, 'وصل تقرير الفحص');
  return 'report';
end;
$$;

revoke execute on function private.wo_report(public.work_orders, boolean, text, text, jsonb, text[], uuid) from public, anon, authenticated;

create function public.tech_submit(
  p_token text,
  p_absent boolean,
  p_finding text default null,
  p_note text default null,
  p_parts jsonb default '[]'::jsonb,
  p_photos text[] default '{}'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.work_orders%rowtype := private.wo_by_token(p_token, true);
  folder text := private.token_hash(p_token);
begin
  -- Photos must be in this link's folder.
  if exists (select 1 from unnest(coalesce(p_photos, '{}')) x where split_part(x, '/', 1) <> folder) then
    raise exception 'invalid_photo';
  end if;
  return private.wo_report(w, p_absent, p_finding, p_note, p_parts, p_photos, null);
end;
$$;

-- Staff record the report for the technician (no internet, etc.).
create function public.wo_report_staff(
  p_work_order_id uuid,
  p_absent boolean,
  p_finding text default null,
  p_note text default null,
  p_parts jsonb default '[]'::jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.work_orders%rowtype;
begin
  if not public.has_permission('work_orders', 'edit') then
    raise exception 'not_allowed';
  end if;
  select * into w from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'work_order_not_found';
  end if;
  return private.wo_report(w, p_absent, p_finding,
    coalesce(nullif(btrim(coalesce(p_note, '')), '') || ' ', '') || '(سجّله موظف نيابة عن الفني)',
    p_parts, '{}', auth.uid());
end;
$$;

revoke execute on function public.tech_job(text) from public;
revoke execute on function public.tech_arrive(text) from public;
revoke execute on function public.tech_submit(text, boolean, text, text, jsonb, text[]) from public;
grant execute on function public.tech_job(text) to anon, authenticated;
grant execute on function public.tech_arrive(text) to anon, authenticated;
grant execute on function public.tech_submit(text, boolean, text, text, jsonb, text[]) to anon, authenticated;
revoke execute on function public.wo_report_staff(uuid, boolean, text, text, jsonb) from public, anon;
grant execute on function public.wo_report_staff(uuid, boolean, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- E. Quote, discount approval, the customer's answer
-- ---------------------------------------------------------------------
-- Staff price the report: part prices from the catalog, the labour fee,
-- and an optional discount (above the limit it waits for a manager).
create function public.wo_quote(p_work_order_id uuid, p_labor_fee numeric, p_discount numeric default 0, p_discount_reason text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.work_orders%rowtype;
  st public.settings%rowtype;
  parts_total numeric;
  base numeric;
  disc numeric := coalesce(p_discount, 0);
  why text := nullif(btrim(coalesce(p_discount_reason, '')), '');
  needs_ok boolean;
begin
  if not public.has_permission('work_orders', 'edit') then
    raise exception 'not_allowed';
  end if;
  select * into w from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'work_order_not_found';
  end if;
  if w.status not in ('report', 'quote') or w.decision is not null then
    raise exception 'invalid_transition';
  end if;
  if p_labor_fee is null or p_labor_fee < 0 or p_labor_fee > 100000 or disc < 0 then
    raise exception 'invalid_amount';
  end if;
  if disc > 0 and why is null then
    raise exception 'reason_required';
  end if;
  if length(coalesce(why, '')) > 300 then
    raise exception 'note_too_long';
  end if;
  select * into st from public.settings where id = 1;

  update public.work_order_parts p set unit_price = pr.price_before_vat
    from public.products pr where pr.id = p.product_id and p.work_order_id = w.id;
  select coalesce(sum(p.qty * p.unit_price), 0) into parts_total from public.work_order_parts p where p.work_order_id = w.id;
  base := parts_total + round(p_labor_fee, 2) + w.inspection_fee;
  if disc > base then
    raise exception 'discount_too_big';
  end if;
  base := base - round(disc, 2);
  needs_ok := disc > st.discount_approval_limit;

  update public.work_orders
     set labor_fee = round(p_labor_fee, 2), discount = round(disc, 2), discount_reason = why,
         vat_rate = st.vat_rate, subtotal = base, vat = round(base * st.vat_rate, 2),
         total = base + round(base * st.vat_rate, 2),
         status = case when needs_ok then 'approval' else 'quote' end,
         quote_at = case when needs_ok then null else now() end,
         quote_by = auth.uid()
   where id = w.id;
  update public.approvals set status = 'rejected', decided_at = now(), decision_note = 'تغيّر العرض'
   where work_order_id = w.id and kind = 'discount' and status = 'pending' and requested_by is distinct from auth.uid();
  delete from public.approvals where work_order_id = w.id and kind = 'discount' and status = 'pending';
  if needs_ok then
    insert into public.approvals (kind, amount, work_order_id, note) values ('discount', round(disc, 2), w.id, why);
    return 'approval';
  end if;
  return 'quote';
end;
$$;

revoke execute on function public.wo_quote(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.wo_quote(uuid, numeric, numeric, text) to authenticated;

-- The customer's answer to the quote (from the store, or staff by phone).
create function private.wo_decide(p_work_order_id uuid, p_decision text, p_via text, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.work_orders%rowtype;
  r public.service_requests%rowtype;
  due numeric;
  new_status text;
begin
  select * into w from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'work_order_not_found';
  end if;
  if w.status <> 'quote' then
    raise exception 'invalid_transition';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'invalid_decision';
  end if;
  due := case when p_decision = 'approved' then w.total
              else w.inspection_fee + round(w.inspection_fee * w.vat_rate, 2) end;
  new_status := case when due > 0 then 'payment' else 'closed' end;
  update public.work_orders
     set decision = p_decision, decision_at = now(), decision_via = p_via, decision_by = auth.uid(),
         amount_due = due, status = new_status,
         closed_at = case when new_status = 'closed' then now() end,
         closed_by = case when new_status = 'closed' then auth.uid() end
   where id = w.id;
  select * into r from public.service_requests where id = w.request_id for update;
  perform private.request_log(r.id, r.status, case when new_status = 'closed' then 'done' else r.status end, null,
    case when p_decision = 'approved' then 'وافق العميل على العرض' else 'رفض العميل العرض' end
    || case when p_via = 'staff' then ' (بالهاتف)' else '' end
    || coalesce(' · ' || nullif(btrim(coalesce(p_note, '')), ''), ''));
  if new_status = 'closed' then
    update public.service_requests set status = 'done', done_at = now() where id = r.id;
  end if;
  return new_status;
end;
$$;

revoke execute on function private.wo_decide(uuid, text, text, text) from public, anon, authenticated;

create function public.wo_decide_mine(p_work_order_id uuid, p_decision text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.work_orders w join public.service_requests r on r.id = w.request_id
     where w.id = p_work_order_id and r.customer_id = auth.uid()
  ) then
    raise exception 'work_order_not_found';
  end if;
  return private.wo_decide(p_work_order_id, p_decision, 'customer', null);
end;
$$;

create function public.wo_decide_staff(p_work_order_id uuid, p_decision text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_permission('work_orders', 'edit') then
    raise exception 'not_allowed';
  end if;
  if length(coalesce(p_note, '')) > 300 then
    raise exception 'note_too_long';
  end if;
  return private.wo_decide(p_work_order_id, p_decision, 'staff', p_note);
end;
$$;

revoke execute on function public.wo_decide_mine(uuid, text) from public, anon;
revoke execute on function public.wo_decide_staff(uuid, text, text) from public, anon;
grant execute on function public.wo_decide_mine(uuid, text) to authenticated;
grant execute on function public.wo_decide_staff(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- F. Payment: cash to the technician (custody) or Moyasar
-- ---------------------------------------------------------------------
create function public.wo_pay_cash(p_work_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.work_orders%rowtype;
  tech uuid;
begin
  if not (public.has_permission('work_orders', 'edit') or public.has_permission('payments', 'edit')) then
    raise exception 'not_allowed';
  end if;
  select * into w from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'work_order_not_found';
  end if;
  if w.status <> 'payment' or w.amount_due <= 0 then
    raise exception 'invalid_transition';
  end if;
  select r.technician_id into tech from public.service_requests r where r.id = w.request_id;
  if tech is null then
    raise exception 'technician_required';
  end if;
  insert into public.service_payments (work_order_id, method, amount, technician_id, recorded_by)
  values (w.id, 'cash', w.amount_due, tech, auth.uid());
  insert into public.custodies (technician_id, work_order_id, amount) values (tech, w.id, w.amount_due);
  update public.work_orders set status = 'paid', paid_at = now(), payment_method = 'cash' where id = w.id;
  perform private.request_log(w.request_id, null, 'in_progress', null, 'دفع العميل نقداً للفني (عهدة)');
end;
$$;

revoke execute on function public.wo_pay_cash(uuid) from public, anon;
grant execute on function public.wo_pay_cash(uuid) to authenticated;

-- Called only by the Moyasar Edge Functions (service role) after reading
-- the payment from Moyasar's API.
create function public.wo_payment_confirm(
  p_work_order_id uuid,
  p_provider_payment_id text,
  p_amount_halalas integer,
  p_currency text,
  p_raw jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.work_orders%rowtype;
begin
  if exists (select 1 from public.service_payments where provider_payment_id = p_provider_payment_id) then
    return 'already_recorded';
  end if;
  select * into w from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'work_order_not_found';
  end if;
  if p_currency <> 'SAR' or p_amount_halalas <> (round(w.amount_due * 100))::integer then
    raise exception 'amount_mismatch';
  end if;
  if w.status <> 'payment' then
    raise exception 'invalid_transition';
  end if;
  insert into public.service_payments (work_order_id, method, amount, provider_payment_id, raw)
  values (w.id, 'moyasar', w.amount_due, p_provider_payment_id, p_raw);
  update public.work_orders set status = 'paid', paid_at = now(), payment_method = 'moyasar' where id = w.id;
  perform private.request_log(w.request_id, null, 'in_progress', null, 'دفع العميل عن طريق ميسر');
  return 'paid';
end;
$$;

revoke execute on function public.wo_payment_confirm(uuid, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.wo_payment_confirm(uuid, text, integer, text, jsonb) to service_role;

-- ---------------------------------------------------------------------
-- G. Closing: issue the approved parts and finish the request
-- ---------------------------------------------------------------------
alter table public.stock_movements add column work_order_id uuid references public.work_orders (id) on delete restrict;

do $$
declare
  c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.stock_movements'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%order_id IS NOT NULL%';
  if c is not null then
    execute format('alter table public.stock_movements drop constraint %I', c);
  end if;
end;
$$;

alter table public.stock_movements
  add constraint stock_movements_issue_source check (
    (kind in ('issue', 'return')) = (order_id is not null or work_order_id is not null)
    and (order_id is null or work_order_id is null)
  );

create index stock_movements_wo_idx on public.stock_movements (work_order_id);

create function public.wo_close(p_work_order_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.work_orders%rowtype;
  r public.service_requests%rowtype;
  today date := (now() at time zone 'Asia/Riyadh')::date;
  alert integer := (select s.maintenance_alert_days from public.settings s where s.id = 1);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.has_permission('work_orders', 'edit') then
    raise exception 'not_allowed';
  end if;
  if length(coalesce(v_note, '')) > 300 then
    raise exception 'note_too_long';
  end if;
  select * into w from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'work_order_not_found';
  end if;
  if w.status <> 'paid' then
    raise exception 'invalid_transition';
  end if;
  select * into r from public.service_requests where id = w.request_id for update;

  if w.decision = 'approved' then
    insert into public.stock_movements (product_id, qty, kind, work_order_id, note)
    select p.product_id, -p.qty, 'issue', w.id, 'صرف لأمر العمل ' || w.number
      from public.work_order_parts p join public.products pr on pr.id = p.product_id
     where p.work_order_id = w.id and pr.tracks_stock;
  end if;

  update public.work_orders set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = w.id;

  if w.customer_absent then
    update public.service_requests
       set status = 'cancelled', cancelled_at = now(), cancel_reason = 'العميل غير موجود وقت الزيارة'
     where id = r.id and status <> 'cancelled';
    perform private.request_log(r.id, r.status, 'cancelled', null, coalesce(v_note, 'العميل غير موجود وقت الزيارة'));
  else
    update public.service_requests set status = 'done', done_at = now() where id = r.id;
    perform private.request_log(r.id, r.status, 'done', null, coalesce(v_note, 'تم إغلاق أمر العمل ' || w.number));
    if w.decision = 'approved' and r.device_id is not null then
      if r.kind = 'maintenance' then
        update public.device_filters set last_changed_on = today
         where device_id = r.device_id and is_active and next_due_on <= today + alert;
      end if;
      update public.customer_devices set next_contact_on = null where id = r.device_id and next_contact_on is not null;
    end if;
  end if;
end;
$$;

revoke execute on function public.wo_close(uuid, text) from public, anon;
grant execute on function public.wo_close(uuid, text) to authenticated;

-- Staff cancel a work order that has not been paid (the request goes back to scheduling).
create function public.wo_cancel(p_work_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w public.work_orders%rowtype;
  why text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.has_permission('work_orders', 'edit') then
    raise exception 'not_allowed';
  end if;
  if why is null or length(why) > 300 then
    raise exception 'reason_required';
  end if;
  select * into w from public.work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'work_order_not_found';
  end if;
  if w.status in ('paid', 'closed', 'cancelled') then
    raise exception 'invalid_transition';
  end if;
  update public.work_orders set status = 'cancelled' where id = w.id;
  delete from public.work_order_links where work_order_id = w.id;
  update public.approvals set status = 'rejected', decided_at = now(), decision_note = 'انلغى أمر العمل'
   where work_order_id = w.id and status = 'pending' and requested_by is distinct from auth.uid();
  delete from public.approvals where work_order_id = w.id and status = 'pending';
  update public.service_requests set status = 'scheduled' where id = w.request_id and status = 'in_progress';
  perform private.request_log(w.request_id, null, 'scheduled', null, 'انلغى أمر العمل ' || w.number || ': ' || why);
end;
$$;

revoke execute on function public.wo_cancel(uuid, text) from public, anon;
grant execute on function public.wo_cancel(uuid, text) to authenticated;


-- A request with a live work order cannot be cancelled or finished by hand.
create or replace function private.request_has_live_wo(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.work_orders w
                  where w.request_id = p_request_id and w.status not in ('closed', 'cancelled'));
$$;

revoke execute on function private.request_has_live_wo(uuid) from public, anon, authenticated;

create function private.service_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('cancelled', 'done') and old.status not in ('cancelled', 'done')
     and private.request_has_live_wo(new.id) then
    raise exception 'work_order_open';
  end if;
  return new;
end;
$$;

revoke execute on function private.service_requests_guard() from public, anon, authenticated;

create trigger service_requests_guard before update of status on public.service_requests
  for each row execute function private.service_requests_guard();

-- ---------------------------------------------------------------------
-- H. Custody: staff receive the technician's cash
-- ---------------------------------------------------------------------
create function public.custody_receive(p_custody_id uuid, p_amount numeric, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.custodies%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  amt numeric := round(p_amount, 2);
begin
  if not public.has_permission('payments', 'edit') then
    raise exception 'not_allowed';
  end if;
  select * into c from public.custodies where id = p_custody_id for update;
  if not found then
    raise exception 'custody_not_found';
  end if;
  if c.status <> 'open' then
    raise exception 'invalid_transition';
  end if;
  if amt is null or amt < 0 or amt > c.amount * 10 then
    raise exception 'invalid_amount';
  end if;
  if length(coalesce(v_note, '')) > 300 then
    raise exception 'note_too_long';
  end if;
  if amt <> c.amount and v_note is null then
    raise exception 'reason_required';
  end if;
  update public.custodies
     set received_amount = amt, received_at = now(), received_by = auth.uid(), note = v_note,
         status = case when amt = c.amount then 'settled' else 'pending' end
   where id = c.id;
  if amt <> c.amount then
    insert into public.approvals (kind, amount, custody_id, note) values ('custody_diff', amt - c.amount, c.id, v_note);
    return 'pending';
  end if;
  return 'settled';
end;
$$;

revoke execute on function public.custody_receive(uuid, numeric, text) from public, anon;
grant execute on function public.custody_receive(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- I. Approvals (nobody approves their own request)
-- ---------------------------------------------------------------------
create function public.approval_decide(p_approval_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.approvals%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into a from public.approvals where id = p_approval_id for update;
  if not found then
    raise exception 'approval_not_found';
  end if;
  if not public.has_permission(case when a.kind = 'stock_diff' then 'inventory' else 'payments' end, 'approve') then
    raise exception 'not_allowed';
  end if;
  if a.status <> 'pending' then
    raise exception 'already_decided';
  end if;
  if a.requested_by = auth.uid() then
    raise exception 'own_request';
  end if;
  if length(coalesce(v_note, '')) > 300 then
    raise exception 'note_too_long';
  end if;
  if not coalesce(p_approve, false) and v_note is null then
    raise exception 'reason_required';
  end if;

  update public.approvals
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = v_note
   where id = a.id;

  if a.kind = 'discount' then
    if p_approve then
      update public.work_orders set status = 'quote', quote_at = now() where id = a.work_order_id and status = 'approval';
    else
      -- Back to pricing without the discount.
      update public.work_orders
         set status = 'report', subtotal = subtotal + discount,
             vat = round((subtotal + discount) * vat_rate, 2),
             total = (subtotal + discount) + round((subtotal + discount) * vat_rate, 2),
             discount = 0, discount_reason = null
       where id = a.work_order_id and status = 'approval';
    end if;
  elsif a.kind = 'custody_diff' then
    if p_approve then
      update public.custodies set status = 'settled' where id = a.custody_id and status = 'pending';
    else
      update public.custodies
         set status = 'open', received_amount = null, received_at = null, received_by = null, note = null
       where id = a.custody_id and status = 'pending';
    end if;
  elsif a.kind = 'stock_diff' and p_approve then
    insert into public.stock_movements (product_id, qty, kind, note)
    values (a.product_id, a.qty, 'adjust', coalesce(a.note, 'فرق جرد') || ' (معتمد)');
  end if;
end;
$$;

revoke execute on function public.approval_decide(uuid, boolean, text) from public, anon;
grant execute on function public.approval_decide(uuid, boolean, text) to authenticated;

-- Stock count: the first count of a product sets it directly; later
-- differences wait for a manager's approval.
create or replace function public.stock_count(p_product_id uuid, p_on_hand integer, p_note text)
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
  if p_on_hand = cur then
    return cur;
  end if;
  if not exists (select 1 from public.stock_movements m where m.product_id = p_product_id) then
    insert into public.stock_movements (product_id, qty, kind, note)
    values (p_product_id, p_on_hand - cur, 'adjust', why);
    return p_on_hand;
  end if;
  delete from public.approvals where kind = 'stock_diff' and product_id = p_product_id and status = 'pending'
     and requested_by = auth.uid();
  insert into public.approvals (kind, qty, product_id, note) values ('stock_diff', p_on_hand - cur, p_product_id, why);
  return cur;
end;
$$;
