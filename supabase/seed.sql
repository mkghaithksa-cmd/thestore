-- Sample data from docs/prototype/customer-site.html (prices before VAT).
-- Safe to run more than once.

insert into public.categories (name_ar, slug, sort_order) values
  ('أجهزة',     'devices', 1),
  ('فلاتر',     'filters', 2),
  ('قطع غيار',  'parts',   3),
  ('باقات',     'bundles', 4)
on conflict (slug) do nothing;

insert into public.products
  (sku, name_ar, description_ar, type, category_id, price_before_vat, specs, status, is_featured)
select p.sku, p.name_ar, p.description_ar, p.type, c.id, p.price, p.specs::jsonb, 'published', p.featured
from (values
  ('DEV-GH500', 'جهاز تنقية منزلي 5 مراحل', 'جهاز تناضح عكسي بخمس مراحل وخزان 12 لتر.',
   'device', 'devices', 1450.00, '["5 مراحل ترشيح", "خزان 12 لتر", "ضمان سنتين"]', true),
  ('DEV-GH300', 'جهاز تنقية مكتبي', 'جهاز مدمج للمكاتب بدون تمديد سباكة.',
   'device', 'devices', 890.00, '["3 مراحل", "سعة 6 لتر", "ضمان سنة"]', false),
  ('FLT-SET5', 'طقم فلاتر 5 مراحل', 'طقم كامل متوافق مع الجهاز المنزلي.',
   'filter', 'filters', 180.00, '["5 فلاتر", "متوافق مع موديل GH-500"]', false),
  ('FLT-CAR', 'فلتر كربون', 'فلتر كربون منشط للمرحلة الأخيرة.',
   'filter', 'filters', 65.00, '["مرحلة 5", "متوافق مع GH-500 وGH-300"]', false),
  ('BND-500', 'باقة جهاز وفلاتر وتركيب', 'جهاز منزلي مع طقم فلاتر إضافي وخدمة التركيب.',
   'bundle', 'bundles', 1690.00, '["جهاز GH-500", "طقم فلاتر إضافي", "تركيب ضمن مكة"]', true),
  ('PRT-HOSE', 'خرطوم وقطع توصيل', 'قطع غيار توصيل للجهاز المنزلي.',
   'part', 'parts', 45.00, '["مقاس 1/4 بوصة", "طول 3 متر"]', false)
) as p(sku, name_ar, description_ar, type, cat_slug, price, specs, featured)
join public.categories c on c.slug = p.cat_slug
on conflict (sku) do nothing;

-- ---------------------------------------------------------------------
-- Day 2 sample data (docs/prototype/admin-console.html). Safe to re-run.
-- ---------------------------------------------------------------------
insert into public.manufacturers (name, country) values
  ('غيث', 'السعودية'), ('أكوا برو', 'إيطاليا'), ('بيور فلو', 'الصين')
on conflict (name) do nothing;

update public.products p set
  name_en = v.name_en,
  manufacturer_id = (select id from public.manufacturers m where m.name = v.maker),
  model = v.model,
  tracks_stock = v.track,
  reorder_level = v.reorder,
  unit = v.unit,
  warranty_months = v.warranty,
  installable_in_mecca = v.installable
from (values
  ('DEV-GH500', 'Home Purifier 5-Stage', 'غيث',     'GH-500', true,  4,  'قطعة', 24, true),
  ('DEV-GH300', 'Office Purifier',       'غيث',     'GH-300', true,  4,  'قطعة', 12, true),
  ('FLT-SET5',  '5-Stage Filter Set',    'غيث',     null,     true,  10, 'طقم',  0,  false),
  ('FLT-CAR',   'Carbon Filter',         'غيث',     null,     true,  10, 'قطعة', 0,  false),
  ('BND-500',   'Device Bundle',         'غيث',     null,     false, 0,  'قطعة', 24, true),
  ('PRT-HOSE',  'Hose Kit',              'بيور فلو', null,     true,  15, 'قطعة', 0,  false)
) as v(sku, name_en, maker, model, track, reorder, unit, warranty, installable)
where p.sku = v.sku and p.name_en is null;

insert into public.product_costs (product_id, cost)
select p.id, v.cost
from (values ('DEV-GH500', 980), ('DEV-GH300', 600), ('FLT-SET5', 110),
             ('FLT-CAR', 38), ('BND-500', 1240), ('PRT-HOSE', 22)) as v(sku, cost)
join public.products p on p.sku = v.sku
on conflict (product_id) do nothing;

insert into public.filter_compatibility (filter_product_id, device_model, stage_number, lifetime_months)
select p.id, v.model, v.stage, v.months
from (values ('FLT-SET5', 'GH-500', null::smallint, 6),
             ('FLT-CAR',  'GH-500', 5::smallint,    6),
             ('FLT-CAR',  'GH-300', 3::smallint,    4)) as v(sku, model, stage, months)
join public.products p on p.sku = v.sku
on conflict do nothing;

insert into public.bundle_items (bundle_product_id, component_product_id, qty)
select b.id, c.id, v.qty
from (values ('BND-500', 'DEV-GH500', 1), ('BND-500', 'FLT-SET5', 1)) as v(bundle, component, qty)
join public.products b on b.sku = v.bundle
join public.products c on c.sku = v.component
on conflict do nothing;

-- Day 8: default filter life (months) for the sample filters.
update public.products set filter_life_months = 6 where type = 'filter' and filter_life_months is null;
