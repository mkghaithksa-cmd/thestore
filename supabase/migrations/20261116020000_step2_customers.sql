-- =====================================================================
-- Ghaith platform — Step 2: customers (phone login)
--
-- * First phone login creates a short account automatically (trigger on
--   auth.users).
-- * Name / email / privacy consent are completed once later, by the
--   customer at their first order or by the manager from the dashboard.
-- * profile_type is computed: 'full' once name and consent exist.
-- =====================================================================

create table public.customers (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text not null unique,
  full_name text check (full_name is null or length(btrim(full_name)) between 2 and 100),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  privacy_accepted_at timestamptz,
  profile_type text generated always as (
    case when full_name is not null and privacy_accepted_at is not null then 'full' else 'short' end
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.customers is 'One row per customer, created on first phone login. profile_type is computed.';

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Create the customer row when a phone user signs up.
-- auth.users.phone is stored without "+" (e.g. 966500000001).
-- TODO(step: staff login): skip users that are staff once staff_profiles exists.
-- ---------------------------------------------------------------------
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.phone is not null and new.phone <> '' then
    insert into public.customers (id, phone)
    values (new.id, '+' || ltrim(new.phone, '+'))
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.customers enable row level security;

create policy "customers: own read"
  on public.customers for select
  to authenticated
  using (id = (select auth.uid()));

create policy "customers: own update"
  on public.customers for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- TODO(step: admin dashboard): staff policies via has_permission('customers', ...).

-- Customers may only change these columns; id/phone/profile_type are locked.
-- Rows are created by the trigger only, and never deleted through the API.
revoke all on public.customers from anon;
revoke insert, update, delete, truncate on public.customers from authenticated;
grant update (full_name, email, privacy_accepted_at) on public.customers to authenticated;
