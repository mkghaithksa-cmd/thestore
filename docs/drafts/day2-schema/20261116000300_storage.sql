-- =====================================================================
-- Ghaith platform — Day 2: Storage bucket for product images
-- Public read (via public URL); upload/replace/delete only for staff
-- with catalog permissions.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
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

-- Staff need to list the bucket in the dashboard; visitors use public URLs.
create policy "product-images: staff list" on storage.objects
  for select to authenticated
  using (bucket_id = 'product-images' and (select public.has_permission('catalog', 'view')));
