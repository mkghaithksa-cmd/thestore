-- =====================================================================
-- Ghaith platform — Day 5, step 6: home page builder + reviews foundation.
--
-- A. home_sections: the home page is a list of sections the client orders,
--    shows/hides and edits (text, images, links, who sees it by location).
-- B. home_banners gets a placement (main slider or the two mid-page spots).
-- C. categories get an optional picture for the home category tiles.
-- D. reviews: approved reviews show on products and the home page; staff
--    approve, reject and feature. Customers write them from Day 7 (buyers
--    only, through a checked function). Sample reviews are flagged.
-- All images live in the existing public 'banners' bucket.
-- =====================================================================

-- A. Home sections -----------------------------------------------------

create table public.home_sections (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key in (
    'announcement', 'hero', 'benefits', 'categories', 'featured',
    'promos', 'bundles', 'service', 'reviews', 'about'
  )),
  title_ar text not null default '' check (length(title_ar) <= 120),
  subtitle_ar text not null default '' check (length(subtitle_ar) <= 400),
  is_visible boolean not null default true,
  sort_order integer not null default 0,
  audience text not null default 'all' check (audience in ('all', 'mecca', 'outside')),
  -- Section-specific settings (texts, image path, link, dates, chosen products).
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and length(config::text) <= 20000),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

comment on column public.home_sections.audience is 'all | mecca (inside the service area) | outside (shipping cities)';

insert into public.home_sections (key, title_ar, subtitle_ar, is_visible, sort_order, audience, config) values
  ('announcement', '', '', false, 1, 'all',
    '{"text": "التركيب والصيانة داخل مكة المكرمة، والشحن لكل مدن المملكة", "link": "/products"}'),
  ('hero', 'ماء نقي لبيتك ومطعمك',
    'أجهزة تحلية وفلاتر أصلية للبيوت والمطاعم، مع التركيب والصيانة داخل مكة والشحن لباقي المدن.',
    true, 2, 'all', '{"button": "تصفح المنتجات", "link": "/products"}'),
  ('benefits', '', '', true, 3, 'all',
    '{"items": [
      {"icon": "tools", "title": "تركيب داخل مكة", "text": "فني يركّب الجهاز في بيتك"},
      {"icon": "shield", "title": "ضمان على الأجهزة", "text": "حسب الجهاز، مكتوب في صفحته"},
      {"icon": "lock", "title": "دفع آمن", "text": "مدى والبطاقات الائتمانية"},
      {"icon": "truck", "title": "شحن لكل المدن", "text": "نوصّل لباقي مدن المملكة"}
    ]}'),
  ('categories', 'تسوّق حسب القسم', '', true, 4, 'all', '{}'),
  ('featured', 'منتجات مميزة', '', true, 5, 'all', '{"product_ids": []}'),
  ('promos', '', '', true, 6, 'all', '{}'),
  ('bundles', 'باقات توفّر عليك', 'جهاز وفلاتر بسعر أقل من شرائها منفصلة', true, 7, 'all', '{}'),
  ('service', 'حان وقت تغيير الفلتر؟', 'نذكّرك بموعد تغيير الفلاتر، وفنّينا يجيك لين البيت داخل مكة.',
    true, 8, 'mecca', '{"button": "تصفح الفلاتر", "link": "/products?cat=filters"}'),
  ('reviews', 'آراء عملائنا', '', true, 9, 'all', '{}'),
  ('about', 'عن تنقية غيث', 'مؤسسة من مكة المكرمة متخصصة في أجهزة تحلية المياه للبيوت والمطاعم: بيع، وتركيب، وصيانة، وقطع غيار.',
    true, 10, 'all', '{"button": "اعرف أكثر", "link": "/pages/about"}');

create function public.home_sections_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title_ar := btrim(new.title_ar);
  new.subtitle_ar := btrim(new.subtitle_ar);
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke execute on function public.home_sections_stamp() from public, anon, authenticated;

create trigger home_sections_stamp before update on public.home_sections
  for each row execute function public.home_sections_stamp();

create trigger home_sections_audit after insert or update or delete on public.home_sections
  for each row execute function public.record_audit();

alter table public.home_sections enable row level security;

create policy "home_sections: public read" on public.home_sections
  for select to anon, authenticated using (true);
create policy "home_sections: staff edit" on public.home_sections
  for update to authenticated
  using ((select public.has_permission('catalog', 'edit')))
  with check ((select public.has_permission('catalog', 'edit')));

revoke all on public.home_sections from anon, authenticated;
grant select on public.home_sections to anon, authenticated;
grant update (title_ar, subtitle_ar, is_visible, sort_order, audience, config) on public.home_sections to authenticated;

-- B. Banner placement --------------------------------------------------

alter table public.home_banners
  add column placement text not null default 'hero' check (placement in ('hero', 'mid'));

-- At most 5 live slider banners and 2 mid-page banners.
create or replace function public.home_banners_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active and (
    select count(*) from public.home_banners b
    where b.is_active and b.id <> new.id and b.placement = new.placement
  ) >= (case new.placement when 'mid' then 2 else 5 end) then
    raise exception 'too_many_banners';
  end if;
  return new;
end;
$$;

drop trigger home_banners_limit on public.home_banners;
create trigger home_banners_limit before insert or update of is_active, placement on public.home_banners
  for each row execute function public.home_banners_limit();

-- C. Category pictures -------------------------------------------------

alter table public.categories add column image_path text
  check (image_path is null or image_path like 'categories/%');

-- D. Reviews -----------------------------------------------------------

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  author_name text not null check (length(btrim(author_name)) between 2 and 40),
  city text check (city is null or length(city) <= 40),
  rating smallint not null check (rating between 1 and 5),
  body text not null default '' check (length(body) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  is_featured boolean not null default false,
  -- Placeholder reviews for the design; shown with a "sample" label and removable in one click.
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  check (not is_featured or status = 'approved')
);

create index reviews_product_idx on public.reviews (product_id) where status = 'approved';
create index reviews_status_idx on public.reviews (status, created_at desc);

-- Stamp who approved/rejected; un-feature anything that is no longer approved.
create function public.reviews_moderate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.reviewed_at := now();
    new.reviewed_by := auth.uid();
  end if;
  if new.status <> 'approved' then
    new.is_featured := false;
  end if;
  return new;
end;
$$;

revoke execute on function public.reviews_moderate() from public, anon, authenticated;

create trigger reviews_moderate before update on public.reviews
  for each row execute function public.reviews_moderate();

create trigger reviews_audit after insert or update or delete on public.reviews
  for each row execute function public.record_audit();

alter table public.reviews enable row level security;

-- The public sees approved reviews only, without who wrote them internally.
create policy "reviews: public read approved" on public.reviews
  for select to anon, authenticated using (status = 'approved');
create policy "reviews: staff read all" on public.reviews
  for select to authenticated using ((select public.has_permission('catalog', 'view')));
create policy "reviews: staff moderate" on public.reviews
  for update to authenticated
  using ((select public.has_permission('catalog', 'approve')))
  with check ((select public.has_permission('catalog', 'approve')));
create policy "reviews: staff delete" on public.reviews
  for delete to authenticated using ((select public.has_permission('catalog', 'approve')));

revoke all on public.reviews from anon, authenticated;
grant select (id, product_id, author_name, city, rating, body, status, is_featured, is_sample, created_at)
  on public.reviews to anon;
grant select on public.reviews to authenticated;
grant update (status, is_featured) on public.reviews to authenticated;
grant delete on public.reviews to authenticated;

-- Sample reviews (the owner asked for placeholders; delete them from the dashboard).
insert into public.reviews (product_id, author_name, city, rating, body, status, is_featured, is_sample)
select p.id, v.author_name, v.city, v.rating, v.body, 'approved', v.featured, true
from (values
  ('GH-D03', 'أبو عبدالله', 'مكة المكرمة', 5, 'الجهاز ممتاز والماء صار طعمه أحسن بكثير، والفني ركّبه بسرعة ونظافة.', true),
  ('GH-D03', 'أم فيصل', 'مكة المكرمة', 5, 'تعامل راقي ومواعيد دقيقة، وشرحوا لنا طريقة تغيير الفلاتر.', true),
  ('GH-D04', 'سعد', 'جدة', 4, 'البرادة شكلها حلو ومبردة الماء زين، وصلت مغلفة بشكل ممتاز.', true),
  ('GH-F06', 'محمد', 'الطائف', 5, 'طقم الفلاتر أصلي وركب على جهازي بدون مشاكل.', false),
  ('GH-B01', 'أبو خالد', 'مكة المكرمة', 5, 'الباقة وفّرت علي، جهاز وبرادة وتركيب في زيارة وحدة.', true),
  ('GH-F09', 'ريم', 'الرياض', 4, 'فلتر الدش فرق في الشعر والبشرة، والشحن وصل خلال أيام.', false)
) as v(sku, author_name, city, rating, body, featured)
join public.products p on p.sku = v.sku;
