-- =====================================================================
-- Ghaith platform — Day 2: Row Level Security and audit log
--
-- Rules:
--   * RLS is enabled on every table.
--   * Visitors (anon) and customers read only the public catalog and
--     public settings. Product cost lives in product_costs (staff only).
--   * Customers read/update only their own row and addresses.
--   * Staff access goes through has_permission(page, action).
--     Staff policies are scoped "to authenticated" so anon never
--     evaluates them.
--   * audit_log is append-only; nobody can update or delete it.
-- =====================================================================

alter table public.settings              enable row level security;
alter table public.service_neighborhoods enable row level security;
alter table public.work_days             enable row level security;
alter table public.customers             enable row level security;
alter table public.addresses             enable row level security;
alter table public.categories            enable row level security;
alter table public.manufacturers         enable row level security;
alter table public.products              enable row level security;
alter table public.product_costs         enable row level security;
alter table public.product_images        enable row level security;
alter table public.filter_compatibility  enable row level security;
alter table public.bundle_items          enable row level security;
alter table public.roles                 enable row level security;
alter table public.role_permissions      enable row level security;
alter table public.staff_profiles        enable row level security;

-- =====================================================================
-- Settings, neighbourhoods, work days: public read, staff "settings" write
-- =====================================================================

create policy "settings: public read" on public.settings
  for select to anon, authenticated using (true);
create policy "settings: staff edit" on public.settings
  for update to authenticated
  using ((select public.has_permission('settings', 'edit')))
  with check ((select public.has_permission('settings', 'edit')));

create policy "neighborhoods: public read active" on public.service_neighborhoods
  for select to anon, authenticated using (active);
create policy "neighborhoods: staff read all" on public.service_neighborhoods
  for select to authenticated using ((select public.has_permission('settings', 'view')));
create policy "neighborhoods: staff add" on public.service_neighborhoods
  for insert to authenticated with check ((select public.has_permission('settings', 'add')));
create policy "neighborhoods: staff edit" on public.service_neighborhoods
  for update to authenticated
  using ((select public.has_permission('settings', 'edit')))
  with check ((select public.has_permission('settings', 'edit')));
create policy "neighborhoods: staff delete" on public.service_neighborhoods
  for delete to authenticated using ((select public.has_permission('settings', 'edit')));

create policy "work_days: public read" on public.work_days
  for select to anon, authenticated using (true);
create policy "work_days: staff edit" on public.work_days
  for update to authenticated
  using ((select public.has_permission('settings', 'edit')))
  with check ((select public.has_permission('settings', 'edit')));

-- The settings row and the 7 work days are fixed: no insert/delete by anyone.
revoke insert, delete, truncate on public.settings  from anon, authenticated;
revoke insert, delete, truncate on public.work_days from anon, authenticated;

-- =====================================================================
-- Customers & addresses
-- =====================================================================

create policy "customers: own read" on public.customers
  for select to authenticated using (id = (select auth.uid()));
create policy "customers: own insert" on public.customers
  for insert to authenticated with check (id = (select auth.uid()));
create policy "customers: own update" on public.customers
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
create policy "customers: staff read" on public.customers
  for select to authenticated using ((select public.has_permission('customers', 'view')));
create policy "customers: staff edit" on public.customers
  for update to authenticated
  using ((select public.has_permission('customers', 'edit')))
  with check ((select public.has_permission('customers', 'edit')));

-- Customers cannot change their own id/phone/timestamps through the API.
revoke update on public.customers from anon, authenticated;
grant update (full_name, email, profile_type, privacy_accepted_at) on public.customers to authenticated;
revoke all on public.customers from anon;
revoke delete, truncate on public.customers from authenticated;

create policy "addresses: own read" on public.addresses
  for select to authenticated using (customer_id = (select auth.uid()));
create policy "addresses: own insert" on public.addresses
  for insert to authenticated with check (customer_id = (select auth.uid()));
create policy "addresses: own update" on public.addresses
  for update to authenticated
  using (customer_id = (select auth.uid()))
  with check (customer_id = (select auth.uid()));
create policy "addresses: own delete" on public.addresses
  for delete to authenticated using (customer_id = (select auth.uid()));
create policy "addresses: staff read" on public.addresses
  for select to authenticated using ((select public.has_permission('customers', 'view')));
create policy "addresses: staff add" on public.addresses
  for insert to authenticated with check ((select public.has_permission('customers', 'add')));
create policy "addresses: staff edit" on public.addresses
  for update to authenticated
  using ((select public.has_permission('customers', 'edit')))
  with check ((select public.has_permission('customers', 'edit')));

revoke all on public.addresses from anon;

-- =====================================================================
-- Catalog
-- =====================================================================

-- Categories: visible ones are public; staff with catalog view see all.
create policy "categories: public read visible" on public.categories
  for select to anon, authenticated using (visible);
create policy "categories: staff read all" on public.categories
  for select to authenticated using ((select public.has_permission('catalog', 'view')));
create policy "categories: staff add" on public.categories
  for insert to authenticated with check ((select public.has_permission('catalog', 'add')));
create policy "categories: staff edit" on public.categories
  for update to authenticated
  using ((select public.has_permission('catalog', 'edit')))
  with check ((select public.has_permission('catalog', 'edit')));
create policy "categories: staff delete" on public.categories
  for delete to authenticated using ((select public.has_permission('catalog', 'edit')));

create policy "manufacturers: public read" on public.manufacturers
  for select to anon, authenticated using (true);
create policy "manufacturers: staff add" on public.manufacturers
  for insert to authenticated with check ((select public.has_permission('catalog', 'add')));
create policy "manufacturers: staff edit" on public.manufacturers
  for update to authenticated
  using ((select public.has_permission('catalog', 'edit')))
  with check ((select public.has_permission('catalog', 'edit')));
create policy "manufacturers: staff delete" on public.manufacturers
  for delete to authenticated using ((select public.has_permission('catalog', 'edit')));

-- Products: published products in a visible category (or no category) are public.
-- The category check goes through categories' own RLS, so a hidden category hides its products.
create policy "products: public read published" on public.products
  for select to anon, authenticated
  using (
    status = 'published'
    and (
      category_id is null
      or exists (select 1 from public.categories c where c.id = products.category_id)
    )
  );
create policy "products: staff read all" on public.products
  for select to authenticated using ((select public.has_permission('catalog', 'view')));
create policy "products: staff add" on public.products
  for insert to authenticated with check ((select public.has_permission('catalog', 'add')));
create policy "products: staff edit" on public.products
  for update to authenticated
  using ((select public.has_permission('catalog', 'edit')))
  with check ((select public.has_permission('catalog', 'edit')));
create policy "products: staff delete" on public.products
  for delete to authenticated using ((select public.has_permission('catalog', 'edit')));

-- Product cost: staff with catalog edit only. Never visible to anon/customers.
revoke all on public.product_costs from anon;
create policy "product_costs: staff read" on public.product_costs
  for select to authenticated using ((select public.has_permission('catalog', 'edit')));
create policy "product_costs: staff add" on public.product_costs
  for insert to authenticated with check ((select public.has_permission('catalog', 'edit')));
create policy "product_costs: staff edit" on public.product_costs
  for update to authenticated
  using ((select public.has_permission('catalog', 'edit')))
  with check ((select public.has_permission('catalog', 'edit')));
create policy "product_costs: staff delete" on public.product_costs
  for delete to authenticated using ((select public.has_permission('catalog', 'edit')));

-- Images / compatibility / bundle items: readable when the parent product is readable
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

-- Visitors only ever read the catalog.
revoke insert, update, delete, truncate on
  public.categories, public.manufacturers, public.products,
  public.product_images, public.filter_compatibility, public.bundle_items,
  public.service_neighborhoods
from anon;

-- =====================================================================
-- Roles, permissions, staff
-- =====================================================================

revoke all on public.roles, public.role_permissions, public.staff_profiles from anon;

create policy "roles: staff read" on public.roles
  for select to authenticated
  using ((select public.has_permission('users_roles', 'view')) or (select public.is_staff()));
create policy "roles: admin add" on public.roles
  for insert to authenticated with check ((select public.has_permission('users_roles', 'add')));
create policy "roles: admin edit" on public.roles
  for update to authenticated
  using ((select public.has_permission('users_roles', 'edit')))
  with check ((select public.has_permission('users_roles', 'edit')));
create policy "roles: admin delete" on public.roles
  for delete to authenticated using ((select public.has_permission('users_roles', 'edit')));

-- Every active staff member may read the permission matrix (the dashboard uses it to show/hide pages).
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
create policy "staff_profiles: admin add" on public.staff_profiles
  for insert to authenticated with check ((select public.has_permission('users_roles', 'add')));
create policy "staff_profiles: admin edit" on public.staff_profiles
  for update to authenticated
  using ((select public.has_permission('users_roles', 'edit')))
  with check ((select public.has_permission('users_roles', 'edit')));
create policy "staff_profiles: admin delete" on public.staff_profiles
  for delete to authenticated using ((select public.has_permission('users_roles', 'edit')));

-- =====================================================================
-- Audit log (append-only)
-- =====================================================================

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid default auth.uid(),
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

-- Only staff with audit_log view can read. Nobody can write directly:
-- rows are added by the trigger below (SECURITY DEFINER).
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

create policy "audit_log: staff read" on public.audit_log
  for select to authenticated using ((select public.has_permission('audit_log', 'view')));

-- Block UPDATE/DELETE for everyone, including the table owner and service_role.
create or replace function public.audit_log_block_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_block_changes();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public.audit_log_block_changes();

-- Generic row-change recorder.
create or replace function public.record_audit()
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
      nullif(concat_ws(':', row_data ->> 'role_id', row_data ->> 'page'), ''),
      nullif(concat_ws(':', row_data ->> 'bundle_product_id', row_data ->> 'component_product_id'), '')
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
    'settings', 'service_neighborhoods', 'work_days',
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

-- Trigger-only helpers should not be callable through the API.
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.check_category_depth() from public, anon, authenticated;
revoke execute on function public.protect_locked_role() from public, anon, authenticated;
revoke execute on function public.audit_log_block_changes() from public, anon, authenticated;
