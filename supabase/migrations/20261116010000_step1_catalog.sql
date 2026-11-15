-- =====================================================================
-- Ghaith platform — Step 1: the store shows real products.
-- Three tables only: categories, products, settings.
-- Read-only for visitors and customers; editing comes later with the
-- admin dashboard.
-- =====================================================================

-- ---------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null,
  slug text not null unique,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name_ar text not null,
  description_ar text,
  type text not null check (type in ('device', 'filter', 'part', 'service', 'bundle')),
  category_id uuid not null references public.categories (id) on delete restrict,
  price_before_vat numeric(10, 2) not null check (price_before_vat >= 0),
  image_url text,
  specs jsonb not null default '[]'::jsonb check (jsonb_typeof(specs) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'published')),
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index products_category_id_idx on public.products (category_id);
create index products_status_idx on public.products (status);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- settings (single row)
-- ---------------------------------------------------------------------
create table public.settings (
  id smallint primary key default 1 check (id = 1),
  vat_rate numeric(5, 4) not null default 0.15 check (vat_rate >= 0 and vat_rate < 1),
  install_fee numeric(10, 2) not null default 150 check (install_fee >= 0),
  inspection_fee numeric(10, 2) not null default 60 check (inspection_fee >= 0),
  shipping_fee numeric(10, 2) not null default 35 check (shipping_fee >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.settings is 'Single row of store settings. Overrides VAT_RATE in @ghaith/shared.';

insert into public.settings (id) values (1);

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Row Level Security: public read-only
-- ---------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.products   enable row level security;
alter table public.settings   enable row level security;

create policy "categories: public read visible"
  on public.categories for select
  to anon, authenticated
  using (is_visible);

-- The sub-query runs under categories' RLS, so a hidden category hides its products.
create policy "products: public read published"
  on public.products for select
  to anon, authenticated
  using (
    status = 'published'
    and exists (select 1 from public.categories c where c.id = products.category_id)
  );

create policy "settings: public read"
  on public.settings for select
  to anon, authenticated
  using (true);

-- No write policies yet. Remove write privileges as a second layer.
revoke insert, update, delete, truncate on public.categories from anon, authenticated;
revoke insert, update, delete, truncate on public.products   from anon, authenticated;
revoke insert, update, delete, truncate on public.settings   from anon, authenticated;
