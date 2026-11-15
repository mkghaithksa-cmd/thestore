-- =====================================================================
-- Ghaith platform — Day 2: core schema
-- Settings, customers, catalog, staff & permissions.
-- RLS policies live in the next migration (..._security.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.product_type as enum ('device', 'filter', 'part', 'service', 'bundle');
create type public.product_status as enum ('draft', 'published');
create type public.customer_profile_type as enum ('short', 'full');

-- ---------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =====================================================================
-- 1. Settings
-- =====================================================================

-- Single-row table with the operational settings (fees, VAT, ...).
create table public.settings (
  id boolean primary key default true check (id),
  vat_rate numeric(5, 4) not null default 0.15 check (vat_rate >= 0 and vat_rate < 1),
  install_fee numeric(10, 2) not null default 150 check (install_fee >= 0),
  inspection_fee numeric(10, 2) not null default 60 check (inspection_fee >= 0),
  shipping_fee numeric(10, 2) not null default 35 check (shipping_fee >= 0),
  charge_inspection_if_absent boolean not null default true,
  maintenance_alert_days integer not null default 30 check (maintenance_alert_days >= 0),
  technician_link_hours integer not null default 24 check (technician_link_hours > 0),
  updated_at timestamptz not null default now()
);
comment on table public.settings is 'Single row of operational settings. Overrides VAT_RATE in @ghaith/shared.';

insert into public.settings (id) values (true);

create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();

-- Mecca neighbourhoods where installation & maintenance are offered.
create table public.service_neighborhoods (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null unique,
  city text not null default 'makkah',
  active boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- Weekly working days (0 = Sunday ... 6 = Saturday).
create table public.work_days (
  day_of_week smallint primary key check (day_of_week between 0 and 6),
  name_ar text not null,
  is_working boolean not null default true,
  start_time time,
  end_time time,
  check (not is_working or (start_time is not null and end_time is not null and end_time > start_time))
);

insert into public.work_days (day_of_week, name_ar, is_working, start_time, end_time) values
  (0, 'الأحد',    true,  '09:00', '21:00'),
  (1, 'الاثنين',  true,  '09:00', '21:00'),
  (2, 'الثلاثاء', true,  '09:00', '21:00'),
  (3, 'الأربعاء', true,  '09:00', '21:00'),
  (4, 'الخميس',   true,  '09:00', '21:00'),
  (5, 'الجمعة',   false, null,    null),
  (6, 'السبت',    true,  '09:00', '21:00');

-- =====================================================================
-- 2. Customers
-- =====================================================================

create table public.customers (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text not null unique,
  full_name text,
  email text,
  profile_type public.customer_profile_type not null default 'short',
  privacy_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  label text,
  city text not null,
  neighborhood_id uuid references public.service_neighborhoods (id) on delete restrict,
  -- Installation/maintenance only inside Mecca and in a listed neighbourhood.
  in_service_area boolean generated always as (city = 'makkah' and neighborhood_id is not null) stored,
  street text,
  location_url text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index addresses_customer_id_idx on public.addresses (customer_id);
create index addresses_neighborhood_id_idx on public.addresses (neighborhood_id);
create unique index addresses_one_default_per_customer
  on public.addresses (customer_id) where is_default;

-- =====================================================================
-- 3. Catalog
-- =====================================================================

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  parent_id uuid references public.categories (id) on delete restrict,
  visible boolean not null default true,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);

create index categories_parent_id_idx on public.categories (parent_id);

-- Categories are at most two levels deep.
create or replace function public.check_category_depth()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from public.categories p where p.id = new.parent_id and p.parent_id is not null) then
      raise exception 'Categories can only be two levels deep';
    end if;
    if exists (select 1 from public.categories c where c.parent_id = new.id) then
      raise exception 'A category with sub-categories cannot become a sub-category';
    end if;
  end if;
  return new;
end;
$$;

create trigger categories_depth before insert or update of parent_id on public.categories
  for each row execute function public.check_category_depth();

create table public.manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  country text,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  type public.product_type not null,
  sku text not null unique,
  name_ar text not null,
  name_en text,
  description text,
  -- Deleting a category that still has products is blocked (restrict).
  category_id uuid references public.categories (id) on delete restrict,
  manufacturer_id uuid references public.manufacturers (id) on delete restrict,
  model text,
  price_before_vat numeric(10, 2) not null check (price_before_vat >= 0),
  tracks_stock boolean not null default true,
  reorder_level integer not null default 0 check (reorder_level >= 0),
  unit text not null default 'قطعة',
  warranty_months integer not null default 0 check (warranty_months >= 0),
  installable_in_mecca boolean not null default false,
  specs jsonb not null default '[]'::jsonb,
  status public.product_status not null default 'draft',
  featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_category_id_idx on public.products (category_id);
create index products_manufacturer_id_idx on public.products (manufacturer_id);
create index products_status_idx on public.products (status);

create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- Cost is kept in its own table so customers and visitors can never read it.
create table public.product_costs (
  product_id uuid primary key references public.products (id) on delete cascade,
  cost numeric(10, 2) not null default 0 check (cost >= 0),
  updated_at timestamptz not null default now()
);

create trigger product_costs_updated_at before update on public.product_costs
  for each row execute function public.set_updated_at();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null,
  alt text,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create index product_images_product_id_idx on public.product_images (product_id);

create table public.filter_compatibility (
  id uuid primary key default gen_random_uuid(),
  filter_product_id uuid not null references public.products (id) on delete cascade,
  device_model text not null,
  stage_number smallint check (stage_number > 0),
  lifetime_months smallint not null check (lifetime_months > 0),
  unique nulls not distinct (filter_product_id, device_model, stage_number)
);

create index filter_compatibility_device_model_idx on public.filter_compatibility (device_model);

create table public.bundle_items (
  bundle_product_id uuid not null references public.products (id) on delete cascade,
  component_product_id uuid not null references public.products (id) on delete restrict,
  qty integer not null default 1 check (qty > 0),
  primary key (bundle_product_id, component_product_id),
  check (bundle_product_id <> component_product_id)
);

create index bundle_items_component_idx on public.bundle_items (component_product_id);

-- =====================================================================
-- 4. Staff, roles & permissions
-- =====================================================================

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_locked boolean not null default false,
  created_at timestamptz not null default now()
);

-- Page keys match the admin console sections.
create table public.role_permissions (
  role_id uuid not null references public.roles (id) on delete cascade,
  page text not null check (page in (
    'dashboard', 'orders', 'appointments', 'work_orders', 'customers', 'payments',
    'inventory', 'catalog', 'reports', 'users_roles', 'settings', 'audit_log'
  )),
  can_view boolean not null default false,
  can_add boolean not null default false,
  can_edit boolean not null default false,
  can_approve boolean not null default false,
  primary key (role_id, page)
);

create table public.staff_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text not null unique,
  role_id uuid not null references public.roles (id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index staff_profiles_role_id_idx on public.staff_profiles (role_id);

create trigger staff_profiles_updated_at before update on public.staff_profiles
  for each row execute function public.set_updated_at();

-- The locked system-admin role and its permissions cannot be changed or deleted.
create or replace function public.protect_locked_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'roles' then
    if old.is_locked then
      raise exception 'The system admin role is locked';
    end if;
  elsif exists (select 1 from public.roles r where r.id = old.role_id and r.is_locked) then
    raise exception 'Permissions of the system admin role are locked';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger roles_protect_locked before update or delete on public.roles
  for each row execute function public.protect_locked_role();
create trigger role_permissions_protect_locked before update or delete on public.role_permissions
  for each row execute function public.protect_locked_role();

-- Default roles (recommended in the plan). The admin role gets every permission.
insert into public.roles (name, is_locked) values
  ('مدير النظام', true),
  ('موظف عمليات', false),
  ('خدمة عملاء', false);

insert into public.role_permissions (role_id, page, can_view, can_add, can_edit, can_approve)
select r.id, p.page, p.v, p.a, p.e, p.ap
from public.roles r
join (values
  -- role,          page,           view,  add,   edit,  approve
  ('مدير النظام', 'dashboard',     true,  true,  true,  true),
  ('مدير النظام', 'orders',        true,  true,  true,  true),
  ('مدير النظام', 'appointments',  true,  true,  true,  true),
  ('مدير النظام', 'work_orders',   true,  true,  true,  true),
  ('مدير النظام', 'customers',     true,  true,  true,  true),
  ('مدير النظام', 'payments',      true,  true,  true,  true),
  ('مدير النظام', 'inventory',     true,  true,  true,  true),
  ('مدير النظام', 'catalog',       true,  true,  true,  true),
  ('مدير النظام', 'reports',       true,  true,  true,  true),
  ('مدير النظام', 'users_roles',   true,  true,  true,  true),
  ('مدير النظام', 'settings',      true,  true,  true,  true),
  ('مدير النظام', 'audit_log',     true,  true,  true,  true),
  ('موظف عمليات', 'dashboard',     true,  false, false, false),
  ('موظف عمليات', 'orders',        true,  true,  true,  false),
  ('موظف عمليات', 'appointments',  true,  true,  true,  false),
  ('موظف عمليات', 'work_orders',   true,  true,  true,  false),
  ('موظف عمليات', 'customers',     true,  true,  true,  false),
  ('موظف عمليات', 'payments',      true,  true,  true,  false),
  ('موظف عمليات', 'inventory',     true,  true,  true,  false),
  ('موظف عمليات', 'catalog',       true,  false, false, false),
  ('موظف عمليات', 'reports',       true,  false, false, false),
  ('موظف عمليات', 'users_roles',   false, false, false, false),
  ('موظف عمليات', 'settings',      false, false, false, false),
  ('موظف عمليات', 'audit_log',     false, false, false, false),
  ('خدمة عملاء',  'dashboard',     true,  false, false, false),
  ('خدمة عملاء',  'orders',        true,  false, false, false),
  ('خدمة عملاء',  'appointments',  true,  true,  true,  false),
  ('خدمة عملاء',  'work_orders',   true,  false, false, false),
  ('خدمة عملاء',  'customers',     true,  true,  true,  false),
  ('خدمة عملاء',  'payments',      false, false, false, false),
  ('خدمة عملاء',  'inventory',     false, false, false, false),
  ('خدمة عملاء',  'catalog',       true,  false, false, false),
  ('خدمة عملاء',  'reports',       false, false, false, false),
  ('خدمة عملاء',  'users_roles',   false, false, false, false),
  ('خدمة عملاء',  'settings',      false, false, false, false),
  ('خدمة عملاء',  'audit_log',     false, false, false, false)
) as p(role_name, page, v, a, e, ap) on p.role_name = r.name;

-- ---------------------------------------------------------------------
-- Permission helpers (used by RLS policies and by the apps via RPC).
-- SECURITY DEFINER so they can read staff tables regardless of RLS;
-- they only ever answer about the calling user.
-- ---------------------------------------------------------------------
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_profiles s
    where s.user_id = (select auth.uid()) and s.active
  );
$$;

create or replace function public.has_permission(page text, action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case action
      when 'view'    then rp.can_view
      when 'add'     then rp.can_add
      when 'edit'    then rp.can_edit
      when 'approve' then rp.can_approve
      else false
    end
    from public.staff_profiles s
    join public.role_permissions rp on rp.role_id = s.role_id and rp.page = has_permission.page
    where s.user_id = (select auth.uid()) and s.active
  ), false);
$$;

revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.has_permission(text, text) from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.has_permission(text, text) to authenticated;
