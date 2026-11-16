-- =====================================================================
-- Ghaith platform — Day 2 complete
-- Builds on step 1 (categories, products, settings) and step 2 (customers).
--
--   A. Staff roles & permissions (needed by every policy below)
--   B. Settings, work days, neighbourhoods, service area (Mecca polygon)
--   C. Customer addresses with map location
--   D. Catalog: sub-categories, manufacturers, product details & cost,
--      images (+ storage bucket), filter compatibility, bundle items
--   E. Staff policies on existing tables
--   F. Audit log (append-only)
--
-- Rule: records with history are never hard-deleted through the API;
-- they are archived (is_active = false / status = 'draft').
-- =====================================================================

-- =====================================================================
-- A. Roles, permissions, staff
-- =====================================================================

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_locked boolean not null default false,
  is_active boolean not null default true,
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

-- Staff accounts. Login itself (phone + 6-digit code) is built in Day 3.
create table public.staff_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text not null unique,
  role_id uuid not null references public.roles (id) on delete restrict,
  is_active boolean not null default true,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index staff_profiles_role_id_idx on public.staff_profiles (role_id);

create trigger staff_profiles_set_updated_at
  before update on public.staff_profiles
  for each row execute function public.set_updated_at();

-- The locked system-admin role and its permissions cannot be changed or deleted.
create function public.protect_locked_role()
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

-- Default roles (as in the prototype).
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

-- Permission helpers, used by RLS and by the dashboard (RPC).
-- SECURITY DEFINER so they can read staff tables; they only answer about the caller.
create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_profiles s
    join public.roles r on r.id = s.role_id
    where s.user_id = (select auth.uid()) and s.is_active and r.is_active
  );
$$;

create function public.has_permission(page text, action text)
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
    join public.roles r on r.id = s.role_id and r.is_active
    join public.role_permissions rp on rp.role_id = s.role_id and rp.page = has_permission.page
    where s.user_id = (select auth.uid()) and s.is_active
  ), false);
$$;

revoke execute on function public.is_staff() from public, anon;
revoke execute on function public.has_permission(text, text) from public, anon;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.has_permission(text, text) to authenticated;
revoke execute on function public.protect_locked_role() from public, anon, authenticated;

alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.staff_profiles   enable row level security;

revoke all on public.roles, public.role_permissions, public.staff_profiles from anon;
-- Roles are archived (is_active), not deleted.
revoke delete, truncate on public.roles, public.staff_profiles from authenticated;

create policy "roles: staff read" on public.roles
  for select to authenticated using ((select public.is_staff()));
create policy "roles: admin add" on public.roles
  for insert to authenticated with check ((select public.has_permission('users_roles', 'add')));
create policy "roles: admin edit" on public.roles
  for update to authenticated
  using ((select public.has_permission('users_roles', 'edit')))
  with check ((select public.has_permission('users_roles', 'edit')));

create policy "role_permissions: staff read" on public.role_permissions
  for select to authenticated using ((select public.is_staff()));
create policy "role_permissions: admin add" on public.role_permissions
  for insert to authenticated with check ((select public.has_permission('users_roles', 'add')));
create policy "role_permissions: admin edit" on public.role_permissions
  for update to authenticated
  using ((select public.has_permission('users_roles', 'edit')))
  with check ((select public.has_permission('users_roles', 'edit')));
create policy "role_permissions: admin delete" on public.role_permissions
  for delete to authenticated using ((select public.has_permission('users_roles', 'edit')));

create policy "staff_profiles: own read" on public.staff_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy "staff_profiles: admin read" on public.staff_profiles
  for select to authenticated using ((select public.has_permission('users_roles', 'view')));
-- Staff accounts are created/updated by the Day 3 Edge Function (service role).
-- Admins may change name / role / active flag from the dashboard.
create policy "staff_profiles: admin edit" on public.staff_profiles
  for update to authenticated
  using ((select public.has_permission('users_roles', 'edit')))
  with check ((select public.has_permission('users_roles', 'edit')));
revoke insert, update on public.staff_profiles from authenticated;
grant update (full_name, role_id, is_active) on public.staff_profiles to authenticated;

-- =====================================================================
-- B. Settings, work days, neighbourhoods, service area
-- =====================================================================

alter table public.settings
  add column charge_inspection_if_absent boolean not null default true,
  add column maintenance_alert_days integer not null default 30 check (maintenance_alert_days >= 0),
  add column technician_link_hours integer not null default 24 check (technician_link_hours > 0);

-- Weekly schedule (0 = Sunday ... 6 = Saturday). Fixed 7 rows, edited from settings.
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
  (6, 'السبت',    false, null,    null);

-- Mecca neighbourhoods: an optional label on the address (the map pin decides coverage).
create table public.service_neighborhoods (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null unique,
  city text not null default 'makkah',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- TEMPORARY list from the prototype — replace with the client's final list.
insert into public.service_neighborhoods (name_ar, sort_order) values
  ('العزيزية', 1), ('الشوقية', 2), ('الشرائع', 3), ('النسيم', 4),
  ('العوالي', 5), ('الكعكية', 6), ('الزاهر', 7);

-- Installation/maintenance coverage as polygons of (lng, lat) points.
create table public.service_areas (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  boundary polygon not null,
  is_active boolean not null default true,
  is_temporary boolean not null default false,
  created_at timestamptz not null default now()
);

comment on column public.service_areas.boundary is 'Polygon of (longitude, latitude) points.';

-- TEMPORARY approximate outline around Mecca (~18 km radius from the Haram).
-- Replace with the client's real coverage area.
insert into public.service_areas (name_ar, boundary, is_temporary) values (
  'مكة المكرمة (تقريبي)',
  polygon '((39.826,21.585),(39.940,21.537),(39.987,21.422),(39.940,21.307),(39.826,21.260),(39.712,21.307),(39.665,21.422),(39.712,21.537))',
  true
);

create function public.is_in_service_area(lat double precision, lng double precision)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lat is not null and lng is not null and exists (
    select 1 from public.service_areas a
    where a.is_active and a.boundary @> point(lng, lat)
  );
$$;

grant execute on function public.is_in_service_area(double precision, double precision) to anon, authenticated;

alter table public.work_days             enable row level security;
alter table public.service_neighborhoods enable row level security;
alter table public.service_areas         enable row level security;

create policy "work_days: public read" on public.work_days
  for select to anon, authenticated using (true);
create policy "work_days: staff edit" on public.work_days
  for update to authenticated
  using ((select public.has_permission('settings', 'edit')))
  with check ((select public.has_permission('settings', 'edit')));

create policy "neighborhoods: public read active" on public.service_neighborhoods
  for select to anon, authenticated using (is_active);
create policy "neighborhoods: staff read all" on public.service_neighborhoods
  for select to authenticated using ((select public.has_permission('settings', 'view')));
create policy "neighborhoods: staff add" on public.service_neighborhoods
  for insert to authenticated with check ((select public.has_permission('settings', 'add')));
create policy "neighborhoods: staff edit" on public.service_neighborhoods
  for update to authenticated
  using ((select public.has_permission('settings', 'edit')))
  with check ((select public.has_permission('settings', 'edit')));

create policy "service_areas: staff read" on public.service_areas
  for select to authenticated using ((select public.has_permission('settings', 'view')));
create policy "service_areas: staff add" on public.service_areas
  for insert to authenticated with check ((select public.has_permission('settings', 'add')));
create policy "service_areas: staff edit" on public.service_areas
  for update to authenticated
  using ((select public.has_permission('settings', 'edit')))
  with check ((select public.has_permission('settings', 'edit')));

revoke insert, update, delete, truncate on public.work_days, public.service_neighborhoods, public.service_areas from anon;
revoke insert, delete, truncate on public.work_days from authenticated;
revoke delete, truncate on public.service_neighborhoods, public.service_areas from authenticated;
revoke all on public.service_areas from anon;

-- Settings: staff with settings permission may edit (step 1 revoked all writes).
grant update on public.settings to authenticated;
create policy "settings: staff edit" on public.settings
  for update to authenticated
  using ((select public.has_permission('settings', 'edit')))
  with check ((select public.has_permission('settings', 'edit')));

-- =====================================================================
-- C. Customer addresses
-- =====================================================================

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  label text check (label is null or length(label) <= 50),
  city text not null check (length(btrim(city)) > 0),
  neighborhood_id uuid references public.service_neighborhoods (id) on delete restrict,
  street text check (street is null or length(street) <= 300),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  -- Computed by trigger from the map pin; never trusted from the client.
  in_service_area boolean not null default false,
  is_default boolean not null default false,
  last_used_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);

create index addresses_customer_id_idx on public.addresses (customer_id);
create index addresses_neighborhood_id_idx on public.addresses (neighborhood_id);
create unique index addresses_one_default_per_customer
  on public.addresses (customer_id) where is_default and is_active;

create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();

-- Compute coverage; keep a single default per customer.
create function public.addresses_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.in_service_area := public.is_in_service_area(new.lat, new.lng);
  if not new.is_active then
    new.is_default := false;
  end if;
  if new.is_default then
    update public.addresses
       set is_default = false
     where customer_id = new.customer_id and id <> new.id and is_default;
  end if;
  return new;
end;
$$;

revoke execute on function public.addresses_before_write() from public, anon, authenticated;

create trigger addresses_before_write
  before insert or update on public.addresses
  for each row execute function public.addresses_before_write();

alter table public.addresses enable row level security;

create policy "addresses: own read" on public.addresses
  for select to authenticated using (customer_id = (select auth.uid()));
create policy "addresses: own insert" on public.addresses
  for insert to authenticated with check (customer_id = (select auth.uid()));
create policy "addresses: own update" on public.addresses
  for update to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));
create policy "addresses: staff read" on public.addresses
  for select to authenticated using ((select public.has_permission('customers', 'view')));
create policy "addresses: staff add" on public.addresses
  for insert to authenticated with check ((select public.has_permission('customers', 'add')));
create policy "addresses: staff edit" on public.addresses
  for update to authenticated
  using ((select public.has_permission('customers', 'edit')))
  with check ((select public.has_permission('customers', 'edit')));

-- Clients choose content columns only; coverage/last-used are set by the database.
revoke all on public.addresses from anon;
revoke insert, update, delete, truncate on public.addresses from authenticated;
grant insert (customer_id, label, city, neighborhood_id, street, lat, lng, is_default)
  on public.addresses to authenticated;
grant update (label, city, neighborhood_id, street, lat, lng, is_default, is_active)
  on public.addresses to authenticated;

-- Staff with customer permissions can read/edit customers (step 2 left a TODO).
create policy "customers: staff read" on public.customers
  for select to authenticated using ((select public.has_permission('customers', 'view')));
create policy "customers: staff edit" on public.customers
  for update to authenticated
  using ((select public.has_permission('customers', 'edit')))
  with check ((select public.has_permission('customers', 'edit')));

-- =====================================================================
-- D. Catalog
-- =====================================================================

-- Two-level categories.
alter table public.categories
  add column parent_id uuid references public.categories (id) on delete restrict,
  add constraint categories_not_own_parent check (parent_id is null or parent_id <> id);

create index categories_parent_id_idx on public.categories (parent_id);

create function public.check_category_depth()
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

revoke execute on function public.check_category_depth() from public, anon, authenticated;

create trigger categories_depth before insert or update of parent_id on public.categories
  for each row execute function public.check_category_depth();

-- A category is public when it and its parent (if any) are visible.
-- SECURITY DEFINER avoids RLS recursion when used inside category/product policies.
create function public.category_is_public(category uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.categories c
    left join public.categories p on p.id = c.parent_id
    where c.id = category and c.is_visible and coalesce(p.is_visible, true)
  );
$$;

grant execute on function public.category_is_public(uuid) to anon, authenticated;

drop policy "categories: public read visible" on public.categories;
create policy "categories: public read visible" on public.categories
  for select to anon, authenticated using (public.category_is_public(id));

drop policy "products: public read published" on public.products;
create policy "products: public read published" on public.products
  for select to anon, authenticated
  using (status = 'published' and public.category_is_public(category_id));

create table public.manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  country text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products
  add column name_en text,
  add column manufacturer_id uuid references public.manufacturers (id) on delete restrict,
  add column model text,
  add column tracks_stock boolean not null default true,
  add column reorder_level integer not null default 0 check (reorder_level >= 0),
  add column unit text not null default 'قطعة',
  add column warranty_months integer not null default 0 check (warranty_months >= 0),
  add column installable_in_mecca boolean not null default false;

create index products_manufacturer_id_idx on public.products (manufacturer_id);

-- Cost lives in its own table: customers and visitors can never read it.
create table public.product_costs (
  product_id uuid primary key references public.products (id) on delete cascade,
  cost numeric(10, 2) not null default 0 check (cost >= 0),
  updated_at timestamptz not null default now()
);

create trigger product_costs_set_updated_at
  before update on public.product_costs
  for each row execute function public.set_updated_at();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null,
  alt_ar text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index product_images_product_id_idx on public.product_images (product_id, sort_order);

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

alter table public.manufacturers        enable row level security;
alter table public.product_costs        enable row level security;
alter table public.product_images       enable row level security;
alter table public.filter_compatibility enable row level security;
alter table public.bundle_items         enable row level security;

-- Staff write access on categories/products (step 1 revoked all writes).
-- Archive instead of delete: no DELETE on categories/products/manufacturers.
grant insert, update on public.categories, public.products to authenticated;

create policy "categories: staff read all" on public.categories
  for select to authenticated using ((select public.has_permission('catalog', 'view')));
create policy "categories: staff add" on public.categories
  for insert to authenticated with check ((select public.has_permission('catalog', 'add')));
create policy "categories: staff edit" on public.categories
  for update to authenticated
  using ((select public.has_permission('catalog', 'edit')))
  with check ((select public.has_permission('catalog', 'edit')));

create policy "products: staff read all" on public.products
  for select to authenticated using ((select public.has_permission('catalog', 'view')));
create policy "products: staff add" on public.products
  for insert to authenticated with check ((select public.has_permission('catalog', 'add')));
create policy "products: staff edit" on public.products
  for update to authenticated
  using ((select public.has_permission('catalog', 'edit')))
  with check ((select public.has_permission('catalog', 'edit')));

create policy "manufacturers: public read active" on public.manufacturers
  for select to anon, authenticated using (is_active);
create policy "manufacturers: staff read all" on public.manufacturers
  for select to authenticated using ((select public.has_permission('catalog', 'view')));
create policy "manufacturers: staff add" on public.manufacturers
  for insert to authenticated with check ((select public.has_permission('catalog', 'add')));
create policy "manufacturers: staff edit" on public.manufacturers
  for update to authenticated
  using ((select public.has_permission('catalog', 'edit')))
  with check ((select public.has_permission('catalog', 'edit')));

create policy "product_costs: staff read" on public.product_costs
  for select to authenticated using ((select public.has_permission('catalog', 'edit')));
create policy "product_costs: staff add" on public.product_costs
  for insert to authenticated with check ((select public.has_permission('catalog', 'edit')));
create policy "product_costs: staff edit" on public.product_costs
  for update to authenticated
  using ((select public.has_permission('catalog', 'edit')))
  with check ((select public.has_permission('catalog', 'edit')));

-- Images / compatibility / bundle items follow their product's visibility
-- (the sub-query runs under products' RLS).
create policy "product_images: read with product" on public.product_images
  for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = product_images.product_id));
create policy "product_images: staff add" on public.product_images
  for insert to authenticated with check ((select public.has_permission('catalog', 'add')));
create policy "product_images: staff edit" on public.product_images
  for update to authenticated
  using ((select public.has_permission('catalog', 'edit')))
  with check ((select public.has_permission('catalog', 'edit')));
create policy "product_images: staff delete" on public.product_images
  for delete to authenticated using ((select public.has_permission('catalog', 'edit')));

create policy "filter_compatibility: read with product" on public.filter_compatibility
  for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = filter_compatibility.filter_product_id));
create policy "filter_compatibility: staff add" on public.filter_compatibility
  for insert to authenticated with check ((select public.has_permission('catalog', 'add')));
create policy "filter_compatibility: staff edit" on public.filter_compatibility
  for update to authenticated
  using ((select public.has_permission('catalog', 'edit')))
  with check ((select public.has_permission('catalog', 'edit')));
create policy "filter_compatibility: staff delete" on public.filter_compatibility
  for delete to authenticated using ((select public.has_permission('catalog', 'edit')));

create policy "bundle_items: read with product" on public.bundle_items
  for select to anon, authenticated
  using (exists (select 1 from public.products p where p.id = bundle_items.bundle_product_id));
create policy "bundle_items: staff add" on public.bundle_items
  for insert to authenticated with check ((select public.has_permission('catalog', 'add')));
create policy "bundle_items: staff edit" on public.bundle_items
  for update to authenticated
  using ((select public.has_permission('catalog', 'edit')))
  with check ((select public.has_permission('catalog', 'edit')));
create policy "bundle_items: staff delete" on public.bundle_items
  for delete to authenticated using ((select public.has_permission('catalog', 'edit')));

revoke all on public.product_costs from anon;
revoke insert, update, delete, truncate on
  public.manufacturers, public.product_images, public.filter_compatibility, public.bundle_items
from anon;
revoke delete, truncate on public.manufacturers, public.product_costs from authenticated;

-- Product images bucket: public read via URL; staff with catalog rights write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

create policy "product-images: staff upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.has_permission('catalog', 'add')));
create policy "product-images: staff update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and (select public.has_permission('catalog', 'edit')))
  with check (bucket_id = 'product-images' and (select public.has_permission('catalog', 'edit')));
create policy "product-images: staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-images' and (select public.has_permission('catalog', 'edit')));
create policy "product-images: staff list" on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and (select public.has_permission('catalog', 'view')));

-- =====================================================================
-- F. Audit log (append-only)
-- =====================================================================

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_created_at_idx on public.audit_log (created_at desc);

alter table public.audit_log enable row level security;

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create policy "audit_log: staff read" on public.audit_log
  for select to authenticated using ((select public.has_permission('audit_log', 'view')));

-- Nobody (not even the owner or service_role) can change or remove audit rows.
create function public.audit_log_block_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

revoke execute on function public.audit_log_block_changes() from public, anon, authenticated;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_block_changes();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_block_changes();

create function public.record_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_data jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log (actor, action, entity, entity_id, before, after)
  values (
    (select auth.uid()),
    tg_op,
    tg_table_name,
    coalesce(
      row_data ->> 'id', row_data ->> 'user_id', row_data ->> 'product_id',
      row_data ->> 'day_of_week',
      case when row_data ? 'role_id' and row_data ? 'page'
           then (row_data ->> 'role_id') || ':' || (row_data ->> 'page') end,
      case when row_data ? 'bundle_product_id'
           then (row_data ->> 'bundle_product_id') || ':' || (row_data ->> 'component_product_id') end
    ),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end;
$$;

revoke execute on function public.record_audit() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'work_days', 'service_neighborhoods', 'service_areas',
    'customers', 'addresses',
    'categories', 'manufacturers', 'products', 'product_costs',
    'product_images', 'filter_compatibility', 'bundle_items',
    'roles', 'role_permissions', 'staff_profiles'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.record_audit()',
      t || '_audit', t
    );
  end loop;
end;
$$;
