-- =====================================================================
-- Ghaith platform — Day 4, step 1: managing products and their images.
--
--  * The system admin role always has every permission, including pages
--    added later (no matching role_permissions row needed).
--  * Products are normalised per type (SKU upper-case, services/bundles
--    carry no stock, only devices/bundles can be installed in Mecca).
--  * Up to 5 images per product, ordered; the first one is the main image.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. System admin sees and does everything
-- ---------------------------------------------------------------------
create or replace function public.has_permission(page text, action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select
      r.is_locked
      or coalesce((
        select case action
          when 'view'    then rp.can_view
          when 'add'     then rp.can_add
          when 'edit'    then rp.can_edit
          when 'approve' then rp.can_approve
          else false
        end
        from public.role_permissions rp
        where rp.role_id = s.role_id and rp.page = has_permission.page
      ), false)
    from public.staff_profiles s
    join public.roles r on r.id = s.role_id and r.is_active
    where s.user_id = (select auth.uid())
      and s.is_active
      and coalesce(((select auth.jwt()) ->> 'iat')::bigint, 0)
          >= floor(extract(epoch from s.sessions_valid_after))
  ), false);
$$;

create or replace function public.my_permissions()
returns table (page text, can_view boolean, can_add boolean, can_edit boolean, can_approve boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select rp.page,
         rp.can_view    or r.is_locked,
         rp.can_add     or r.is_locked,
         rp.can_edit    or r.is_locked,
         rp.can_approve or r.is_locked
  from public.staff_profiles s
  join public.roles r on r.id = s.role_id
  join public.role_permissions rp on rp.role_id = s.role_id
  where s.user_id = (select auth.uid()) and (select public.is_staff());
$$;

-- ---------------------------------------------------------------------
-- B. Products: per-type rules
-- ---------------------------------------------------------------------
create function public.products_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.sku := upper(btrim(new.sku));
  new.name_ar := btrim(new.name_ar);
  if new.sku = '' then
    raise exception 'invalid_sku';
  end if;
  if new.name_ar = '' then
    raise exception 'invalid_name';
  end if;
  if new.type in ('service', 'bundle') then
    new.tracks_stock := false;
  end if;
  if not new.tracks_stock then
    new.reorder_level := 0;
  end if;
  if new.type not in ('device', 'bundle') then
    new.installable_in_mecca := false;
  end if;
  if new.type not in ('device', 'filter', 'part', 'bundle') then
    new.warranty_months := 0;
  end if;
  return new;
end;
$$;

revoke execute on function public.products_normalize() from public, anon, authenticated;

create trigger products_normalize before insert or update on public.products
  for each row execute function public.products_normalize();

-- Case-insensitive unique SKU (the trigger upper-cases, this is a safety net).
create unique index products_sku_upper_idx on public.products (upper(sku));

-- ---------------------------------------------------------------------
-- C. Images: at most 5 per product
-- ---------------------------------------------------------------------
create function public.product_images_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.product_images i where i.product_id = new.product_id) >= 5 then
    raise exception 'too_many_images';
  end if;
  return new;
end;
$$;

revoke execute on function public.product_images_limit() from public, anon, authenticated;

create trigger product_images_limit before insert on public.product_images
  for each row execute function public.product_images_limit();

-- Storage paths must live in the product's own folder: <product_id>/<file>.
alter table public.product_images
  add constraint product_images_path_in_folder
  check (storage_path like product_id::text || '/%');
