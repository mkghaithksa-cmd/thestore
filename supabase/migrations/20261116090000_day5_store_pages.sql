-- =====================================================================
-- Ghaith platform — Day 5, step 5: store pages written by the client.
--
-- A fixed set of pages (about, shipping, returns, warranty, privacy, terms).
-- Staff with settings permission edit the text and publish or hide each one;
-- the public sees published pages only (a draft is never readable). Every
-- change lands in the audit log with who made it.
-- =====================================================================

create table public.store_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in ('about', 'shipping', 'returns', 'warranty', 'privacy', 'terms')),
  title_ar text not null,
  body text not null default '' check (length(body) <= 50000),
  is_published boolean not null default false,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on column public.store_pages.body is 'Plain text: blank line = new paragraph, "## " = heading, "- " = list item.';

insert into public.store_pages (slug, title_ar, sort_order) values
  ('about',    'من نحن',              1),
  ('shipping', 'الشحن والتوصيل',       2),
  ('returns',  'الإلغاء والاسترداد',   3),
  ('warranty', 'الضمان',              4),
  ('privacy',  'سياسة الخصوصية',       5),
  ('terms',    'الشروط والأحكام',      6);

-- Tidy the title, stamp who changed it, and refuse publishing an empty page.
create function public.store_pages_normalize()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title_ar := btrim(regexp_replace(new.title_ar, '\s+', ' ', 'g'));
  if length(new.title_ar) < 2 or length(new.title_ar) > 80 then
    raise exception 'invalid_title';
  end if;
  new.body := btrim(new.body);
  if new.is_published and length(new.body) < 20 then
    raise exception 'empty_page';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke execute on function public.store_pages_normalize() from public, anon, authenticated;

create trigger store_pages_normalize before update on public.store_pages
  for each row execute function public.store_pages_normalize();

alter table public.store_pages enable row level security;

create policy "store_pages: public read published" on public.store_pages
  for select to anon, authenticated using (is_published);
create policy "store_pages: staff read all" on public.store_pages
  for select to authenticated using ((select public.has_permission('settings', 'view')));
create policy "store_pages: staff edit" on public.store_pages
  for update to authenticated
  using ((select public.has_permission('settings', 'edit')))
  with check ((select public.has_permission('settings', 'edit')));

revoke all on public.store_pages from anon, authenticated;
grant select on public.store_pages to anon, authenticated;
grant update (title_ar, body, is_published) on public.store_pages to authenticated;

create trigger store_pages_audit after insert or update or delete on public.store_pages
  for each row execute function public.record_audit();
