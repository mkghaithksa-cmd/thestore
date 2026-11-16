-- =====================================================================
-- Ghaith platform — Day 4, step 2: categories, manufacturers, bundles.
--
--  * Categories and manufacturers are never deleted (no DELETE grant):
--    hide a category / deactivate a manufacturer instead.
--  * A category gets a slug automatically when none is given.
--  * Bundle rows must point from a bundle to a non-bundle component.
-- =====================================================================

create function public.categories_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name_ar := btrim(new.name_ar);
  if new.name_ar = '' then
    raise exception 'invalid_name';
  end if;
  new.slug := lower(btrim(coalesce(new.slug, '')));
  if new.slug = '' then
    new.slug := 'c-' || substr(md5(gen_random_uuid()::text), 1, 8);
  end if;
  return new;
end;
$$;

revoke execute on function public.categories_normalize() from public, anon, authenticated;

create trigger categories_normalize before insert or update on public.categories
  for each row execute function public.categories_normalize();

create function public.manufacturers_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if new.name = '' then
    raise exception 'invalid_name';
  end if;
  return new;
end;
$$;

revoke execute on function public.manufacturers_normalize() from public, anon, authenticated;

create trigger manufacturers_normalize before insert or update on public.manufacturers
  for each row execute function public.manufacturers_normalize();

-- Bundles: a bundle contains products, never another bundle.
create function public.bundle_items_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select type from public.products where id = new.bundle_product_id) is distinct from 'bundle' then
    raise exception 'not_a_bundle';
  end if;
  if (select type from public.products where id = new.component_product_id) = 'bundle' then
    raise exception 'bundle_in_bundle';
  end if;
  return new;
end;
$$;

revoke execute on function public.bundle_items_check() from public, anon, authenticated;

create trigger bundle_items_check before insert or update on public.bundle_items
  for each row execute function public.bundle_items_check();
