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
