-- =====================================================================
-- Ghaith platform — Day 4, step 3: banners on the store home page.
--
-- Each banner has a wide image for laptops (1920x640, 3:1) and an
-- optional tall one for phones (1080x1350, 4:5); without a phone image
-- the store shows the wide one in full. At most 5 active banners.
-- Managed by staff with catalog permissions.
-- =====================================================================

create table public.home_banners (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  desktop_path text not null,
  mobile_path text,
  link_kind text not null default 'none' check (link_kind in ('none', 'product', 'category', 'url')),
  link_ref text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is null or ends_at is null or ends_at > starts_at),
  check ((link_kind = 'none') = (link_ref is null)),
  check (link_kind <> 'url' or link_ref ~ '^(https://|/)'),
  check (desktop_path like id::text || '/%'),
  check (mobile_path is null or mobile_path like id::text || '/%')
);

create index home_banners_sort_idx on public.home_banners (sort_order);

create trigger home_banners_set_updated_at
  before update on public.home_banners
  for each row execute function public.set_updated_at();

create function public.home_banners_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active and (
    select count(*) from public.home_banners b where b.is_active and b.id <> new.id
  ) >= 5 then
    raise exception 'too_many_banners';
  end if;
  return new;
end;
$$;

revoke execute on function public.home_banners_limit() from public, anon, authenticated;

create trigger home_banners_limit before insert or update of is_active on public.home_banners
  for each row execute function public.home_banners_limit();

create trigger home_banners_audit after insert or update or delete on public.home_banners
  for each row execute function public.record_audit();

alter table public.home_banners enable row level security;

create policy "home_banners: public read live" on public.home_banners
  for select to anon, authenticated
  using (is_active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now()));
create policy "home_banners: staff read all" on public.home_banners
  for select to authenticated using ((select public.has_permission('catalog', 'view')));
create policy "home_banners: staff add" on public.home_banners
  for insert to authenticated with check ((select public.has_permission('catalog', 'add')));
create policy "home_banners: staff edit" on public.home_banners
  for update to authenticated
  using ((select public.has_permission('catalog', 'edit')))
  with check ((select public.has_permission('catalog', 'edit')));
create policy "home_banners: staff delete" on public.home_banners
  for delete to authenticated using ((select public.has_permission('catalog', 'edit')));

revoke all on public.home_banners from anon;
grant select on public.home_banners to anon;
revoke truncate on public.home_banners from authenticated;

-- Banner images bucket: public read via URL; catalog staff write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('banners', 'banners', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

create policy "banners: staff upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'banners' and (select public.has_permission('catalog', 'add')));
create policy "banners: staff update" on storage.objects
  for update to authenticated
  using (bucket_id = 'banners' and (select public.has_permission('catalog', 'edit')))
  with check (bucket_id = 'banners' and (select public.has_permission('catalog', 'edit')));
create policy "banners: staff delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'banners' and (select public.has_permission('catalog', 'edit')));
create policy "banners: staff list" on storage.objects
  for select to authenticated
  using (bucket_id = 'banners' and (select public.has_permission('catalog', 'view')));
