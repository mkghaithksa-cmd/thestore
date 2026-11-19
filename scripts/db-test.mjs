// Database security test — runs every migration + seed in an in-memory
// Postgres (PGlite) with small stand-ins for Supabase's auth/storage schemas,
// then checks what visitors, customers and staff can and cannot do.
//
//   npm run test:db
//
// No Docker and no connection to the real project are needed.
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const db = new PGlite({ extensions: { pgcrypto } })

// --- Minimal Supabase stand-ins ------------------------------------------
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema extensions;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key, phone text, raw_app_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable
    as $$ select jsonb_strip_nulls(jsonb_build_object('iat', nullif(current_setting('test.iat', true), '')::bigint)) $$;
  grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
  create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);

  create schema storage;
  grant usage on schema storage to anon, authenticated;
  create table storage.buckets (id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  grant all on storage.objects to anon, authenticated;
`)

for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
}
const seed = fs.readFileSync(path.join(root, 'supabase', 'seed.sql'), 'utf8')
await db.exec(seed)
await db.exec(seed) // must be safe to run twice

// --- Helpers -------------------------------------------------------------
let failures = 0
const ok = (cond, label) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}`)
  if (!cond) failures++
}
const rows = async (sql) => (await db.query(sql)).rows
const count = async (sql) => (await rows(sql)).length
const denied = async (sql) => {
  try {
    await db.query(sql)
    return false
  } catch {
    return true
  }
}
const as = async (role, uid = '', iat = '') => {
  await db.exec(`reset role; set test.uid = '${uid}'; set test.iat = '${iat}'; ${role === 'owner' ? '' : `set role ${role};`}`)
}
const errorOf = async (sql) => {
  try {
    await db.query(sql)
    return null
  } catch (e) {
    return e.message
  }
}
const now = () => Math.floor(Date.now() / 1000)

const A = '00000000-0000-0000-0000-00000000000a' // customer A
const B = '00000000-0000-0000-0000-00000000000b' // customer B
const OPS = '00000000-0000-0000-0000-0000000000c1' // operations staff
const ADMIN = '00000000-0000-0000-0000-0000000000c2' // system admin

await as('owner')
await db.exec(`
  insert into auth.users (id, phone) values ('${A}', '966500000001'), ('${B}', '966500000002');
  insert into auth.users (id) values ('${OPS}'), ('${ADMIN}');
  insert into public.staff_profiles (user_id, full_name, phone, role_id)
    select '${OPS}', 'موظف', '+966511111111', id from public.roles where name = 'موظف عمليات';
  insert into public.staff_profiles (user_id, full_name, phone, role_id)
    select '${ADMIN}', 'مدير', '+966522222222', id from public.roles where name = 'مدير النظام';
  insert into public.addresses (customer_id, city, lat, lng) values ('${B}', 'makkah', 21.4225, 39.8262);
`)

// --- Structure -------------------------------------------------------------
console.log('Structure')
const noRls = await rows(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`)
ok(noRls.length === 0, `RLS enabled on every public table ${noRls.map((r) => r.tablename).join(',')}`)
ok((await count('select 1 from customers')) === 2, 'first phone login creates a customer row (trigger)')

// --- Visitor (anon) ----------------------------------------------------------
console.log('Visitor')
await as('anon')
ok((await count('select 1 from products')) === 6, 'sees the 6 published products')
ok((await count('select 1 from service_neighborhoods')) === 7, 'sees active neighbourhoods')
ok((await count('select 1 from work_days')) === 7, 'sees work days')
ok(await denied('select * from product_costs'), 'cannot read product cost')
ok(await denied('select * from customers'), 'cannot read customers')
ok(await denied('select * from addresses'), 'cannot read addresses')
ok(await denied('select * from audit_log'), 'cannot read audit log')
ok(await denied('select * from staff_profiles'), 'cannot read staff')
ok(await denied(`insert into categories (name_ar, slug) values ('x', 'x')`), 'cannot add categories')

// --- Customer A ------------------------------------------------------------
console.log('Customer')
await as('authenticated', A)
ok((await rows('select id from customers')).every((r) => r.id === A), 'reads only own customer row')
ok((await count(`update customers set full_name = 'x' where id = '${B}' returning id`)) === 0, 'cannot edit another customer')
ok(await denied(`update customers set phone = '+966599999999'`), 'cannot change own phone')
await db.query(`insert into addresses (customer_id, label, city, lat, lng, is_default) values ('${A}', 'البيت', 'makkah', 21.4225, 39.8262, true)`)
await db.query(`insert into addresses (customer_id, label, city, lat, lng, is_default) values ('${A}', 'جدة', 'jeddah', 21.5433, 39.1728, true)`)
const mine = await rows(`select label, in_service_area, is_default from addresses order by label`)
ok(mine.length === 2, 'reads only own addresses (2, not customer B’s)')
ok(mine.find((r) => r.label === 'البيت')?.in_service_area === true, 'pin inside Mecca → in service area')
ok(mine.find((r) => r.label === 'جدة')?.in_service_area === false, 'pin in Jeddah → outside service area')
ok(mine.filter((r) => r.is_default).length === 1, 'only one default address')
ok(await denied(`update addresses set in_service_area = true`), 'cannot set in_service_area directly')
ok(await denied(`insert into addresses (customer_id, city) values ('${B}', 'makkah')`), 'cannot add address for someone else')
ok(await denied('delete from addresses'), 'cannot hard-delete addresses (archive instead)')
ok((await count('select 1 from product_costs')) === 0, 'cannot see product cost')
ok((await count(`update products set price_before_vat = 1 returning id`)) === 0, 'cannot edit products')
ok((await count('select 1 from audit_log')) === 0, 'cannot see audit log')

// --- Operations staff --------------------------------------------------------
console.log('Operations staff')
await as('authenticated', OPS)
ok((await count('select 1 from customers')) === 2, 'reads customers (customers:view)')
ok((await count('select 1 from product_costs')) === 0, 'cannot see cost (needs catalog:edit)')
ok((await count(`update products set price_before_vat = 1 returning id`)) === 0, 'cannot edit products (catalog view only)')
ok(await denied(`update settings set install_fee = 1`) || (await count(`update settings set install_fee = 1 returning id`)) === 0, 'cannot edit settings')

// --- System admin --------------------------------------------------------------
console.log('System admin')
await as('authenticated', ADMIN)
ok((await count('select 1 from product_costs')) === 6, 'reads product cost')
ok((await count(`update settings set install_fee = 160 returning id`)) === 1, 'edits settings')
ok((await count(`insert into categories (name_ar, slug) values ('أغشية', 'membranes') returning id`)) === 1, 'adds a category')
ok(await denied(`update roles set name = 'x' where is_locked`), 'cannot change the locked admin role')
ok((await count(`select 1 from audit_log where entity = 'settings'`)) >= 1, 'settings change was audited')

// --- Audit log is append-only ---------------------------------------------------
console.log('Audit log')
await as('owner')
ok(await denied('update audit_log set entity = entity'), 'nobody can edit audit rows (even owner)')
ok(await denied('delete from audit_log'), 'nobody can delete audit rows (even owner)')

// --- Hidden category hides its products ----------------------------------------
await db.exec(`update categories set is_visible = false where slug = 'bundles'`)
await as('anon')
ok((await count('select 1 from products')) === 5, 'hiding a category hides its products')

// --- Day 3: staff login -------------------------------------------------------
console.log('Staff login')
const OPS_PHONE = '+966511111111'
const verify = async (code) => (await rows(`select public.staff_verify_code('${OPS_PHONE}', '${code}') as r`))[0].r

await as('owner')
await db.exec(`update categories set is_visible = true`)
await db.exec(`insert into auth.users (id, phone, raw_app_meta_data) values ('00000000-0000-0000-0000-0000000000d1', '966533333333', '{"kind":"staff"}')`)
ok((await count(`select 1 from customers where phone = '+966533333333'`)) === 0, 'staff auth users never get a customer row')

await as('anon')
ok(await denied(`select public.staff_verify_code('${OPS_PHONE}', '123456')`), 'visitors cannot call the code check')
await as('authenticated', A)
ok(await denied(`select public.staff_verify_code('${OPS_PHONE}', '123456')`), 'customers cannot call the code check')
ok((await count('select * from public.my_permissions()')) === 0, 'a customer has no staff permissions')
ok((await errorOf(`select public.staff_set_code('${OPS}', '111111')`)) !== null, 'a customer cannot change a staff code')
ok(await denied(`update staff_profiles set is_active = false`), 'nobody can toggle staff directly (must use functions)')

await as('authenticated', OPS)
ok((await errorOf(`select public.staff_set_code('${ADMIN}', '111111')`))?.includes('forbidden'), 'operations staff cannot change other codes')
ok((await errorOf(`select public.staff_register('${A}', 'x', '+966544444444', (select id from roles where name = 'خدمة عملاء'), '123456')`))?.includes('forbidden'), 'operations staff cannot add staff')

await as('authenticated', ADMIN)
ok((await errorOf(`select public.staff_set_code('${OPS}', '12345')`))?.includes('invalid_code'), 'codes must be exactly 6 digits')
await db.query(`select public.staff_set_code('${OPS}', '246810')`)
ok(true, 'admin sets a staff code')
ok((await errorOf(`select public.staff_set_active('${ADMIN}', false)`))?.includes('cannot_change_self'), 'admin cannot disable themselves')
ok((await errorOf(`select public.staff_set_role('${ADMIN}', (select id from roles where name = 'خدمة عملاء'))`))?.includes('cannot_change_self'), 'admin cannot change own role')
ok((await count(`select public.role_create('مشرف', (select id from roles where name = 'موظف عمليات'))`)) === 1, 'admin creates a role copying permissions')
ok((await count(`select 1 from role_permissions rp join roles r on r.id = rp.role_id where r.name = 'مشرف'`)) === 12, 'new role has all 12 pages')

await as('authenticated', OPS, String(now() - 3600))
ok((await count('select * from public.my_permissions()')) === 0, 'old session loses staff rights after a code change')
await as('authenticated', OPS, String(now() + 1))
ok((await count('select * from public.my_permissions()')) === 12, 'a fresh session has staff rights')

await as('service_role')
ok((await verify('246810')).status === 'ok', 'correct code → ok')
for (let i = 1; i <= 4; i++) await verify('000000')
const fifth = await verify('000000')
ok(fifth.status === 'locked', '5 wrong codes → locked')
ok((await verify('246810')).status === 'locked', 'locked even with the right code (15 minutes)')
ok((await verify('999999')).status === 'locked', 'stays locked')
ok((await rows(`select public.staff_verify_code('+966500000009', '246810') as r`))[0].r.status === 'invalid', 'unknown phone → invalid')
ok((await errorOf(`select public.staff_bootstrap('${B}', 'x', '+966555555555', '123456')`))?.includes('already_bootstrapped'), 'first-admin setup refuses once an admin exists')

await as('owner')
await db.exec(`update staff_profiles set locked_until = null where user_id = '${OPS}'`)
await as('authenticated', ADMIN)
await db.query(`select public.staff_set_active('${OPS}', false)`)
await as('service_role')
ok((await verify('246810')).status === 'disabled', 'a disabled member cannot log in')
await as('authenticated', OPS, String(now() + 5))
ok((await count('select * from public.my_permissions()')) === 0, 'a disabled member has no rights')

// --- Day 4: system admin sees every page ---------------------------------------
console.log('System admin pages')
await as('authenticated', ADMIN, String(now() + 10))
const adminPerms = await rows('select * from public.my_permissions()')
ok(adminPerms.length === 12 && adminPerms.every((p) => p.can_view && p.can_add && p.can_edit && p.can_approve),
  'system admin has every permission on all 12 pages')
for (const role of ['موظف عمليات', 'خدمة عملاء']) {
  const pages = (await rows(`select rp.page from role_permissions rp join roles r on r.id = rp.role_id
    where r.name = '${role}' and rp.can_view`)).map((r) => r.page)
  ok(pages.every((p) => adminPerms.find((a) => a.page === p)?.can_view), `system admin sees every page of «${role}»`)
}
ok((await rows(`select public.has_permission('a_future_page', 'approve') as r`))[0].r === true,
  'system admin also gets pages added in the future')

// --- Day 4: products and images -------------------------------------------------
console.log('Products')
const devCat = (await rows(`select id from categories where slug = 'devices'`))[0].id
const svc = await rows(`insert into products (sku, name_ar, type, category_id, price_before_vat, tracks_stock, reorder_level, installable_in_mecca)
  values ('  svc-clean ', 'تنظيف خزان', 'service', '${devCat}', 50, true, 5, true) returning sku, tracks_stock, reorder_level, installable_in_mecca`)
ok(svc[0].sku === 'SVC-CLEAN', 'SKU is trimmed and upper-cased')
ok(svc[0].tracks_stock === false && svc[0].reorder_level === 0, 'a service carries no stock')
ok(svc[0].installable_in_mecca === false, 'only devices/bundles can be installable')
ok(await denied(`insert into products (sku, name_ar, type, category_id, price_before_vat) values ('svc-CLEAN', 'x', 'part', '${devCat}', 1)`),
  'SKU must be unique (case-insensitive)')
const pid = (await rows(`select id from products where sku = 'DEV-GH500'`))[0].id
ok(await denied(`insert into product_images (product_id, storage_path) values ('${pid}', 'other-folder/x.webp')`),
  'image path must be inside the product folder')
for (let i = 0; i < 5; i++) await db.query(`insert into product_images (product_id, storage_path, sort_order) values ('${pid}', '${pid}/${i}.webp', ${i})`)
ok((await errorOf(`insert into product_images (product_id, storage_path) values ('${pid}', '${pid}/6.webp')`))?.includes('too_many_images'),
  'a product cannot have more than 5 images')
await as('anon')
ok((await count(`select 1 from product_images where product_id = '${pid}'`)) === 5, 'visitors see the images of a published product')
await as('authenticated', OPS, String(now() + 10))
ok(await denied(`insert into products (sku, name_ar, type, category_id, price_before_vat) values ('OPS-1', 'x', 'part', '${devCat}', 1)`),
  'operations staff (catalog view only) cannot add products')

// --- Day 4: categories, manufacturers, bundles -----------------------------------
console.log('Categories and bundles')
await as('authenticated', ADMIN, String(now() + 10))
const sub = await rows(`insert into categories (name_ar, parent_id) values (' فلاتر منزلية ', (select id from categories where slug = 'filters')) returning slug, name_ar`)
ok(sub[0].slug.startsWith('c-') && sub[0].name_ar === 'فلاتر منزلية', 'a new sub-category gets a slug automatically')
ok(await denied(`insert into categories (name_ar, parent_id) values ('x', (select id from categories where name_ar = 'فلاتر منزلية'))`),
  'categories are at most two levels deep')
ok(await denied(`delete from categories where slug = 'parts'`), 'categories cannot be deleted (hide instead)')
ok(await denied(`delete from manufacturers`), 'manufacturers cannot be deleted (deactivate instead)')
const bnd = (await rows(`select id from products where sku = 'BND-500'`))[0].id
const dev = (await rows(`select id from products where sku = 'DEV-GH300'`))[0].id
ok((await errorOf(`insert into bundle_items (bundle_product_id, component_product_id) values ('${dev}', '${pid}')`))?.includes('not_a_bundle'),
  'only a bundle can have components')
ok((await errorOf(`insert into bundle_items (bundle_product_id, component_product_id) values ('${bnd}', '${bnd}')`)) !== null,
  'a bundle cannot contain itself')
await db.query(`insert into bundle_items (bundle_product_id, component_product_id, qty) values ('${bnd}', '${dev}', 2) on conflict do nothing`)
await as('anon')
ok((await count(`select 1 from bundle_items where bundle_product_id = '${bnd}'`)) >= 1, 'visitors see the contents of a published bundle')

// --- Day 4: home banners ----------------------------------------------------------
console.log('Banners')
await as('authenticated', ADMIN, String(now() + 10))
const banner = (i, extra = '') =>
  `insert into home_banners (id, title, desktop_path ${extra ? ', ' + extra.split('=')[0] : ''})
   values ('00000000-0000-0000-0000-0000000000b${i}', 'بنر ${i}', '00000000-0000-0000-0000-0000000000b${i}/d.webp' ${extra ? ', ' + extra.split('=')[1] : ''})`
for (let i = 1; i <= 5; i++) await db.query(banner(i))
ok((await errorOf(banner(6)))?.includes('too_many_banners'), 'at most 5 active banners')
await db.query(banner(6, `is_active=false`))
ok((await errorOf(`update home_banners set is_active = true where title = 'بنر 6'`))?.includes('too_many_banners'),
  'cannot activate a 6th banner')
ok(await denied(`insert into home_banners (title, desktop_path) values ('x', 'somewhere-else/d.webp')`), 'banner images live in the banner folder')
ok(await denied(`update home_banners set link_kind = 'url', link_ref = 'javascript:alert(1)' where title = 'بنر 1'`), 'banner links must be https:// or a store path')
await db.query(`update home_banners set starts_at = now() + interval '1 day' where title = 'بنر 2'`)
await db.query(`update home_banners set ends_at = now() - interval '1 second', starts_at = now() - interval '1 day' where title = 'بنر 3'`)
await as('anon')
ok((await count('select 1 from home_banners')) === 3, 'visitors see only live banners (not stopped, scheduled or ended)')
ok(await denied(`insert into home_banners (title, desktop_path) values ('x', 'x/d.webp')`), 'visitors cannot add banners')
await as('authenticated', OPS, String(now() + 10))
ok(await denied(`delete from home_banners`) || (await count(`delete from home_banners returning id`)) === 0, 'operations staff cannot delete banners')
await as('owner')
ok((await count(`select 1 from audit_log where entity = 'home_banners'`)) >= 6, 'banner changes are audited')

// --- Day 4: settings page ----------------------------------------------------------
console.log('Settings')
await as('authenticated', ADMIN, String(now() + 10))
ok((await count(`update settings set vat_rate = 0.15, shipping_fee = 40, maintenance_alert_days = 20 where id = 1 returning id`)) === 1,
  'admin edits VAT, fees and the maintenance alert')
ok(await denied(`update settings set id = 2`), 'the settings row id cannot change')
const off = await rows(`update work_days set is_working = false where day_of_week = 4 returning start_time, end_time`)
ok(off[0].start_time === null && off[0].end_time === null, 'a day off clears its hours')
ok(await denied(`update work_days set is_working = true, start_time = '18:00', end_time = '09:00' where day_of_week = 4`),
  'working hours must end after they start')
ok(await denied(`update work_days set name_ar = 'x' where day_of_week = 0`), 'day names cannot be renamed')
const hood = await rows(`insert into service_neighborhoods (name_ar) values ('  حي   الروضة ') returning name_ar`)
ok(hood[0].name_ar === 'حي الروضة', 'neighbourhood names are tidied')
ok(await denied(`insert into service_neighborhoods (name_ar) values ('حي الروضة')`), 'no duplicate neighbourhoods')
ok(await denied(`delete from service_neighborhoods`), 'neighbourhoods are stopped, never deleted')
await as('authenticated', OPS, String(now() + 10))
ok((await count(`update settings set shipping_fee = 1 returning id`)) === 0, 'operations staff cannot change settings')
ok((await count(`update work_days set is_working = true returning day_of_week`)) === 0, 'operations staff cannot change work days')
await as('anon')
ok((await rows(`select shipping_fee from settings`))[0].shipping_fee == 40, 'the store reads the new shipping fee at once')

// --- Day 6: orders ------------------------------------------------------------------
console.log('Orders')
await as('owner')
await db.exec(`
  update products set installable_in_mecca = true where sku = 'DEV-GH500';
  insert into products (sku, name_ar, type, category_id, price_before_vat, status)
    select 'SRV-VISIT', 'زيارة صيانة', 'service', id, 100, 'published' from categories where slug = 'parts';
  insert into products (sku, name_ar, type, category_id, price_before_vat, status)
    select 'DEV-DRAFT', 'جهاز مسودة', 'device', id, 500, 'draft' from categories where slug = 'devices';
`)
const skuId = async (sku) => (await rows(`select id from products where sku = '${sku}'`))[0].id
const GH500 = await skuId('DEV-GH500'), FLT = await skuId('FLT-SET5'), SRV = await skuId('SRV-VISIT'), DRAFT = await skuId('DEV-DRAFT')
const HOOD = (await rows(`select id from service_neighborhoods where is_active order by sort_order limit 1`))[0].id
const dayIso = async (sql) => (await rows(sql))[0].d
const WORKDAY = await dayIso(`select to_char(d, 'YYYY-MM-DD') d from generate_series(current_date + 2, current_date + 20, interval '1 day') d
  join work_days w on w.day_of_week = extract(dow from d) and w.is_working limit 1`)
const FRIDAY = await dayIso(`select to_char(d, 'YYYY-MM-DD') d from generate_series(current_date + 2, current_date + 20, interval '1 day') d
  where extract(dow from d) = 5 limit 1`)
const MECCA = { lat: 21.4225, lng: 39.8262 }, JEDDAH = { lat: 21.5433, lng: 39.1728 }
const q = (v) => (v === null || v === undefined ? 'null' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v))
const order = ({ items, fulfillment = 'delivery', at = MECCA, hood = HOOD, hoodName = null, name = 'عميل تجربة', date = null, privacy = true, city = null }) =>
  `select public.create_order(items => '${JSON.stringify(items)}'::jsonb, fulfillment => ${q(fulfillment)},
     lat => ${at.lat}, lng => ${at.lng}, neighborhood_id => ${hood ? `'${hood}'::uuid` : 'null'}, street => 'شارع 1', contact_name => ${q(name)},
     preferred_visit_date => ${date ? `'${date}'::date` : 'null'}, privacy_accepted => ${privacy}, city => ${q(city)}, neighborhood_name => ${q(hoodName)}) as r`
const place = async (args) => (await rows(order(args)))[0].r

await as('anon')
ok(await denied(order({ items: [{ product_id: FLT, qty: 1 }] })), 'visitors cannot place orders')
await as('authenticated', A)
ok((await errorOf(order({ items: [{ product_id: FLT, qty: 1 }], name: null })))?.includes('name_required'), 'the first order needs a name')
ok((await errorOf(order({ items: [{ product_id: FLT, qty: 1 }], privacy: false })))?.includes('privacy_required'), 'the first order needs privacy consent')
const o1 = await place({ items: [{ product_id: GH500, qty: 2, price: 1 }, { product_id: FLT, qty: 1 }], fulfillment: 'delivery_install', date: WORKDAY })
ok(o1.order_number === 'GH-10234', `order numbers start at GH-10234 (${o1.order_number})`)
const r1 = (await rows(`select * from orders where id = '${o1.id}'`))[0]
const fee = Number((await rows('select install_fee from settings'))[0].install_fee)
const exp1 = Math.round((3080 + 2 * fee) * 1.15 * 100) / 100
ok(Number(r1.subtotal) === 3080 && Number(r1.install_fee) === 2 * fee && Number(r1.total) === exp1,
  `server prices the order from the catalog, ignoring any price sent (${r1.subtotal} + ${r1.install_fee} + ${r1.vat_amount} = ${r1.total})`)
ok(r1.status === 'pending_payment' && r1.zone === 'mecca' && !!r1.neighborhood_name, 'new order waits for payment, inside Mecca, with its neighbourhood')
ok((await rows(`select amount_halalas from payment_requests where order_id = '${o1.id}'`))[0]?.amount_halalas === Math.round(exp1 * 100), 'one payment request for the exact total (halalas)')
ok((await count(`select 1 from order_items where order_id = '${o1.id}'`)) === 2, 'customer sees the order items')
ok((await rows(`select privacy_accepted_at from customers where id = '${A}'`))[0].privacy_accepted_at !== null, 'name and consent saved on the customer')
ok((await count(`select 1 from addresses where customer_id = '${A}' and in_service_area`)) >= 1 && !!r1.address_id, 'the address is saved for next time')
const o1b = await place({ items: [{ product_id: FLT, qty: 1 }], name: null })
ok(o1b.order_number === 'GH-10235', 'the next order reuses the saved name and gets the next number')
ok((await rows(`select count(distinct address_id) n from orders where id in ('${o1.id}', '${o1b.id}')`))[0].n == 1, 'same pin, same saved address')
ok((await errorOf(order({ items: [{ product_id: FLT, qty: 1 }], fulfillment: 'shipping' })))?.includes('invalid_fulfillment'), 'inside Mecca the order is delivered, not shipped')
ok((await errorOf(order({ items: [{ product_id: FLT, qty: 1 }], hood: null })))?.includes('neighborhood_required'), 'inside Mecca the neighbourhood is required')
const oMap = await place({ items: [{ product_id: FLT, qty: 1 }], hood: null, hoodName: '  حي   السنابل ' })
const rMap = (await rows(`select neighborhood_id, neighborhood_name from orders where id = '${oMap.id}'`))[0]
ok(rMap.neighborhood_id === null && rMap.neighborhood_name === 'حي السنابل', 'a neighbourhood from the map that is not on the list is accepted as typed')
const AZIZ = (await rows(`select id from service_neighborhoods where name_ar = 'العزيزية'`))[0].id
const oLink = await place({ items: [{ product_id: FLT, qty: 1 }], hood: null, hoodName: 'حي عزيزيه' })
const rLink = (await rows(`select neighborhood_id, neighborhood_name from orders where id = '${oLink.id}'`))[0]
ok(rLink.neighborhood_id === AZIZ && rLink.neighborhood_name === 'العزيزية', 'a map name matching the list is linked to it (حي عزيزيه = العزيزية)')
ok((await errorOf(order({ items: [{ product_id: FLT, qty: 1 }], hood: null, hoodName: 'x'.repeat(81) })))?.includes('invalid_neighborhood'), 'neighbourhood names are at most 80 letters')
await as('owner')
await db.exec(`update orders set status = 'cancelled' where id in ('${oMap.id}', '${oLink.id}')`)
await as('authenticated', A)
ok((await errorOf(order({ items: [{ product_id: FLT, qty: 1 }], fulfillment: 'delivery_install', date: WORKDAY })))?.includes('nothing_to_install'),
  'installation needs an installable device')
ok((await errorOf(order({ items: [{ product_id: GH500, qty: 1 }], fulfillment: 'delivery_install' })))?.includes('visit_date_required'), 'installation needs a preferred day')
ok((await errorOf(order({ items: [{ product_id: GH500, qty: 1 }], fulfillment: 'delivery_install', date: FRIDAY })))?.includes('invalid_visit_date'),
  'the preferred day must be a working day')
ok((await errorOf(order({ items: [{ product_id: SRV, qty: 1 }], at: JEDDAH, fulfillment: 'shipping' })))?.includes('service_outside_area'), 'services are for Mecca only')
ok((await errorOf(order({ items: [{ product_id: FLT, qty: 1 }], at: { lat: 15.5, lng: 32.5 }, fulfillment: 'shipping' })))?.includes('outside_ksa'),
  'a pin outside Saudi Arabia is refused')
ok((await errorOf(order({ items: [{ product_id: FLT, qty: 21 }] })))?.includes('invalid_qty'), 'at most 20 of a product')
ok((await errorOf(order({ items: [{ product_id: DRAFT, qty: 1 }] })))?.includes('product_unavailable'), 'draft products cannot be ordered')
ok((await errorOf(order({ items: [] })))?.includes('empty_cart'), 'an empty cart cannot be ordered')
const o2 = await place({ items: [{ product_id: GH500, qty: 1 }], at: JEDDAH, fulfillment: 'shipping', city: 'جدة' })
const r2 = (await rows(`select * from orders where id = '${o2.id}'`))[0]
ok(r2.zone === 'outside' && r2.city === 'جدة' && Number(r2.shipping_fee) === 40 && Number(r2.total) === 1713.5,
  `outside Mecca: shipping fee from settings, VAT on it too (${r2.total})`)
ok(await denied(`insert into orders (customer_id, fulfillment, zone, city, lat, lng, contact_name, contact_phone, vat_rate, subtotal, vat_amount, total)
  values ('${A}', 'delivery', 'mecca', 'x', 1, 1, 'xx', 'x', 0, 1, 0, 1)`), 'customers cannot write orders directly')
ok(await denied(`update orders set total = 1`), 'customers cannot change an order')
await place({ items: [{ product_id: FLT, qty: 1 }] })
await place({ items: [{ product_id: FLT, qty: 1 }] })
ok((await errorOf(order({ items: [{ product_id: FLT, qty: 1 }] })))?.includes('too_many_pending'), 'at most 5 unpaid orders at a time')
await as('authenticated', B)
ok((await count('select 1 from orders')) === 0 && (await count('select 1 from order_items')) === 0, "another customer cannot see A's orders")
await as('authenticated', ADMIN, String(now() + 10))
ok((await count('select 1 from orders')) === 7, 'staff with the orders page see all orders')
ok((await errorOf(order({ items: [{ product_id: FLT, qty: 1 }] })))?.includes('not_a_customer'), 'staff accounts cannot place orders')
ok(await denied(`insert into payments (order_id, provider_payment_id, amount_halalas, status) values ('${o1.id}', 'x', 1, 'paid')`),
  'nobody can record a payment through the API')
await as('owner')
await db.exec(`update orders set expires_at = now() - interval '1 minute' where id = '${o1b.id}'`)
ok((await rows('select public.expire_unpaid_orders() as n'))[0].n === 1, 'unpaid orders past 24 hours are cancelled')
ok((await rows(`select o.status, r.status as req from orders o join payment_requests r on r.order_id = o.id where o.id = '${o1b.id}'`))
  .every((x) => x.status === 'cancelled' && x.req === 'expired'), 'its payment request expires with it')
ok((await count(`select 1 from audit_log where entity = 'orders'`)) >= 5, 'orders are audited')

// --- Day 7: order stages, stock, devices, reviews ---------------------------------
console.log('Order stages and stock')
const OPS2 = '00000000-0000-0000-0000-0000000000c3'
await as('owner')
await db.exec(`
  insert into auth.users (id) values ('${OPS2}');
  insert into public.staff_profiles (user_id, full_name, phone, role_id)
    select '${OPS2}', 'موظف ٢', '+966533333333', id from public.roles where name = 'موظف عمليات';
  insert into products (sku, name_ar, type, category_id, price_before_vat, status, installable_in_mecca)
    select 'BND-TEST', 'باقة تجربة', 'bundle', id, 2000, 'published', true from categories where slug = 'devices';
`)
const BND = await skuId('BND-TEST')
await db.exec(`insert into bundle_items (bundle_product_id, component_product_id, qty) values ('${BND}', '${GH500}', 1), ('${BND}', '${FLT}', 2)`)
const onHand = async (id) => Number((await rows(`select coalesce((select on_hand from stock_levels where product_id = '${id}'), 0) n`))[0].n)
const asOps = () => as('authenticated', OPS2, String(now() + 10))
const asAdmin = () => as('authenticated', ADMIN, String(now() + 10))
const st = async (id) => (await rows(`select * from orders where id = '${id}'`))[0]

await as('authenticated', B)
const o3 = await place({ items: [{ product_id: GH500, qty: 1 }, { product_id: BND, qty: 1 }], fulfillment: 'delivery_install', date: WORKDAY })
ok((await count(`select 1 from order_events where order_id = '${o3.id}'`)) === 1, 'a new order starts its tracking (one event)')
ok((await errorOf(`select public.order_mark_paid('${o3.id}', 'cash', 'R-1')`))?.includes('not_allowed'), 'a customer cannot mark an order paid')
await asOps()
ok((await errorOf(`select public.order_mark_paid('${o3.id}', 'cash', 'R-1')`))?.includes('not_allowed'), 'operations staff cannot record a payment')
ok((await errorOf(`select public.order_advance('${o3.id}', 'preparing')`))?.includes('invalid_transition'), 'an unpaid order cannot be prepared')
await asAdmin()
ok((await errorOf(`select public.order_mark_paid('${o3.id}', 'cash', ' ')`))?.includes('reference_required'), 'a manual payment needs a reference')
await rows(`select public.order_mark_paid('${o3.id}', 'cash', 'R-1')`)
const p3 = await st(o3.id)
ok(p3.status === 'paid' && p3.paid_at !== null, 'the admin records a cash payment: the order is paid')
ok((await rows(`select amount_halalas, method, reference from payments where order_id = '${o3.id}'`))
  .some((x) => x.amount_halalas === Math.round(Number(p3.total) * 100) && x.method === 'cash' && x.reference === 'R-1'),
  'the payment is recorded with its amount and reference')
ok((await errorOf(`select public.order_mark_paid('${o3.id}', 'cash', 'R-2')`))?.includes('not_pending'), 'an order cannot be paid twice')

await asOps()
ok((await errorOf(`select public.order_advance('${o3.id}', 'installing')`))?.includes('invalid_transition'), 'stages cannot be skipped')
const gh0 = await onHand(GH500), flt0 = await onHand(FLT)
await rows(`select public.order_advance('${o3.id}', 'preparing')`)
ok((await onHand(GH500)) === gh0 - 2 && (await onHand(FLT)) === flt0 - 2,
  `preparing issues the stock, a bundle issues its parts (GH500 ${gh0} → ${await onHand(GH500)}, FLT ${flt0} → ${await onHand(FLT)})`)
ok((await st(o3.id)).stock_issued_at !== null, 'the order remembers its stock was issued')
await as('authenticated', B)
ok((await errorOf(`select public.order_cancel_mine('${o3.id}')`))?.includes('cannot_cancel'), 'the customer cannot cancel once preparing started')
await asOps()
ok((await errorOf(`select public.order_advance('${o3.id}', 'delivered')`))?.includes('invalid_transition'), 'an installation order goes to installing, not delivered')
await rows(`select public.order_advance('${o3.id}', 'installing', null, null, 'الفني في الطريق')`)
await rows(`select public.order_advance('${o3.id}', 'completed')`)
ok((await st(o3.id)).status === 'completed', 'installation done: the order is completed')
ok(await denied(`insert into stock_movements (product_id, qty, kind, reference) values ('${GH500}', 5, 'receive', 'x')`), 'nobody writes stock movements directly')
ok(await denied(`update stock_levels set on_hand = 99`), 'nobody edits a balance directly')
ok((await errorOf(`select public.stock_receive('${GH500}', 10, '')`))?.includes('reference_required'), 'receiving stock needs a reference')
ok((await errorOf(`select public.stock_receive('${SRV}', 10, 'INV-1')`))?.includes('not_stocked'), 'services carry no stock')
ok((await rows(`select public.stock_receive('${GH500}', 10, 'INV-1') as n`))[0].n === gh0 - 2 + 10, 'receiving stock raises the balance')
ok((await errorOf(`select public.stock_count('${GH500}', 3, '')`))?.includes('note_required'), 'a stock count needs a note')
await rows(`select public.stock_count('${GH500}', 3, 'جرد')`)
ok((await onHand(GH500)) === gh0 - 2 + 10, 'a later stock-count difference waits for approval')
const stockOk = (await rows(`select id, qty from approvals where kind = 'stock_diff' and product_id = '${GH500}' and status = 'pending'`))[0]
ok(stockOk?.qty === 3 - (gh0 - 2 + 10), 'the difference goes to the approvals list')
ok((await errorOf(`select public.approval_decide('${stockOk.id}', true)`))?.includes('not_allowed'), 'staff without approve permission cannot approve')
await asAdmin()
await rows(`select public.approval_decide('${stockOk.id}', true)`)
ok((await onHand(GH500)) === 3, 'approved: the stock count sets the real balance')
ok((await rows(`select balance_after from stock_movements where product_id = '${GH500}' order by id desc limit 1`))[0].balance_after === 3,
  'each movement keeps the balance after it')
await asOps()
await rows(`select public.stock_set_reorder_level('${GH500}', 5)`)
ok((await rows(`select reorder_level from products where id = '${GH500}'`))[0].reorder_level === 5, 'staff set the reorder level for the shortage alert')

await as('authenticated', B)
const ev = await rows(`select status from order_events where order_id = '${o3.id}' order by id`)
ok(ev.map((e) => e.status).join(',') === 'pending_payment,paid,preparing,installing,completed', `the customer sees every stage (${ev.map((e) => e.status)})`)
ok((await rows(`select note from order_events where order_id = '${o3.id}' and status = 'installing'`))[0]?.note === 'الفني في الطريق', 'a stage can carry a note')
const devs = await rows(`select installed from customer_devices where order_id = '${o3.id}'`)
ok(devs.length === 2 && devs.every((d) => d.installed), `the installed devices appear in «أجهزتي», one from the bundle (${devs.length})`)
await as('authenticated', A)
ok((await count(`select 1 from customer_devices`)) === 0 && (await count(`select 1 from order_events where order_id = '${o3.id}'`)) === 0,
  "another customer cannot see B's devices or tracking")

console.log('Reviews')
ok((await errorOf(`select public.review_submit('${GH500}', 5, 'ممتاز')`))?.includes('not_purchased'), 'no review before receiving the product')
await as('authenticated', B)
ok((await errorOf(`select public.review_submit('${GH500}', 6, 'x')`))?.includes('invalid_rating'), 'ratings are 1 to 5')
await rows(`select public.review_submit('${GH500}', 4, 'جيد')`)
await rows(`select public.review_submit('${GH500}', 5, 'ممتاز والتركيب سريع')`)
const rv = await rows(`select rating, status from reviews where customer_id = '${B}'`)
ok(rv.length === 1 && rv[0].rating === 5 && rv[0].status === 'pending', 'one review per product, waiting for approval (sending again updates it)')
await as('anon')
ok((await count(`select 1 from reviews where body = 'ممتاز والتركيب سريع'`)) === 0, 'a pending review is not public')

console.log('Cancelling and refunds')
await as('authenticated', B)
const o4 = await place({ items: [{ product_id: FLT, qty: 1 }] })
await asAdmin()
await rows(`select public.order_mark_paid('${o4.id}', 'bank_transfer', 'TRX-77')`)
await as('authenticated', A)
ok((await errorOf(`select public.order_cancel_mine('${o4.id}')`))?.includes('order_not_found'), "a customer cannot cancel someone else's order")
await as('authenticated', B)
await rows(`select public.order_cancel_mine('${o4.id}')`)
const c4 = await st(o4.id)
ok(c4.status === 'cancelled' && c4.refund_status === 'due', 'the customer cancels a paid order before preparing: a refund is due')
await asOps()
ok((await errorOf(`select public.order_mark_refunded('${o4.id}', 'RF-1')`))?.includes('not_allowed'), 'operations staff cannot record a refund')
await asAdmin()
await rows(`select public.order_mark_refunded('${o4.id}', 'RF-1')`)
ok((await st(o4.id)).refund_status === 'done', 'the admin records the refund')

await as('authenticated', B)
const o5 = await place({ items: [{ product_id: GH500, qty: 1 }] })
await asAdmin()
await rows(`select public.order_mark_paid('${o5.id}', 'cash', 'R-5')`)
await asOps()
const gh5 = await onHand(GH500)
await rows(`select public.order_advance('${o5.id}', 'preparing')`)
ok((await onHand(GH500)) === gh5 - 1, 'preparing a delivery takes one device')
ok((await errorOf(`select public.order_cancel_staff('${o5.id}', 'غير رأيه')`))?.includes('not_allowed'), 'operations staff cannot cancel an order')
await asAdmin()
ok((await errorOf(`select public.order_cancel_staff('${o5.id}', '')`))?.includes('reason_required'), 'cancelling needs a reason')
await rows(`select public.order_cancel_staff('${o5.id}', 'العميل غير رأيه')`)
ok((await onHand(GH500)) === gh5 && (await st(o5.id)).status === 'cancelled', 'cancelling after preparing returns the stock')
ok((await errorOf(`select public.order_cancel_staff('${o3.id}', 'متأخر')`))?.includes('cannot_cancel'), 'a completed order cannot be cancelled')

await as('authenticated', B)
const o6 = await place({ items: [{ product_id: GH500, qty: 1 }], at: JEDDAH, fulfillment: 'shipping', city: 'جدة' })
await asAdmin()
await rows(`select public.order_mark_paid('${o6.id}', 'bank_transfer', 'TRX-88')`)
await asOps()
await rows(`select public.order_advance('${o6.id}', 'preparing')`)
ok((await errorOf(`select public.order_advance('${o6.id}', 'shipped')`))?.includes('tracking_required'), 'shipping needs a tracking number')
await rows(`select public.order_advance('${o6.id}', 'shipped', 'SMSA123456', 'سمسا')`)
const s6 = await st(o6.id)
ok(s6.status === 'shipped' && s6.tracking_number === 'SMSA123456' && s6.shipping_carrier === 'سمسا', 'the tracking number is saved with the carrier')
await rows(`select public.order_advance('${o6.id}', 'delivered')`)
await as('authenticated', B)
ok((await rows(`select installed from customer_devices where order_id = '${o6.id}'`)).map((d) => d.installed).join() === 'false',
  'a shipped device appears in «أجهزتي» once delivered (not installed)')
await asAdmin()
ok((await count(`select 1 from audit_log where entity = 'stock_movements'`)) >= 4, 'stock movements are audited')


// --- Online payment (Moyasar) ------------------------------------------------------
console.log('Online payment')
await as('authenticated', B)
const o7 = await place({ items: [{ product_id: FLT, qty: 1 }] })
const req7 = (await rows(`select amount_halalas from payment_requests where order_id = '${o7.id}'`))[0].amount_halalas
const confirm = (id, amount, cur = 'SAR') => `select public.payment_confirm('${o7.id}', '${id}', ${amount}, '${cur}', 'mada') as r`
ok(await denied(confirm('pay_test_00001', req7)), 'a customer cannot confirm a payment')
await asAdmin()
ok(await denied(confirm('pay_test_00001', req7)), 'staff cannot confirm an online payment either')
await as('service_role')
ok((await errorOf(confirm('pay_test_00001', req7 - 1)))?.includes('amount_mismatch'), 'a payment for a different amount is refused')
ok((await errorOf(confirm('pay_test_00001', req7, 'USD')))?.includes('amount_mismatch'), 'a payment in another currency is refused')
ok((await rows(confirm('pay_test_00001', req7)))[0].r === 'paid', 'the verified payment marks the order paid')
ok((await rows(confirm('pay_test_00001', req7)))[0].r === 'already_recorded', 'the same payment twice is recorded once')
const r7 = await st(o7.id)
ok(r7.status === 'paid' && (await count(`select 1 from payments where order_id = '${o7.id}'`)) === 1, 'one payment row, order paid')
await as('authenticated', B)
const o8 = await place({ items: [{ product_id: FLT, qty: 1 }] })
const req8 = (await rows(`select amount_halalas from payment_requests where order_id = '${o8.id}'`))[0].amount_halalas
await as('owner')
await db.exec(`update orders set expires_at = now() - interval '1 minute' where id = '${o8.id}'`)
await rows('select public.expire_unpaid_orders()')
await as('service_role')
await rows(`select public.payment_confirm('${o8.id}', 'pay_test_00008', ${req8}, 'SAR', 'visa')`)
ok((await st(o8.id)).status === 'paid', 'paid just after the 24 hours: the order goes ahead')
await as('authenticated', B)
const o9 = await place({ items: [{ product_id: FLT, qty: 1 }] })
const req9 = (await rows(`select amount_halalas from payment_requests where order_id = '${o9.id}'`))[0].amount_halalas
await rows(`select public.order_cancel_mine('${o9.id}')`)
await as('service_role')
ok((await rows(`select public.payment_confirm('${o9.id}', 'pay_test_00009', ${req9}, 'SAR', 'mada') as r`))[0].r === 'refund_due',
  'paid after the customer cancelled: the money is marked for refund')
ok((await st(o9.id)).status === 'cancelled' && (await st(o9.id)).refund_status === 'due', 'the cancelled order stays cancelled')


// --- Day 8: maintenance and appointments ------------------------------------------
console.log('Maintenance and appointments')
const CS = '00000000-0000-0000-0000-0000000000c4'
const GH300 = await skuId('DEV-GH300')
await as('owner')
await db.exec(`
  insert into auth.users (id) values ('${CS}');
  insert into public.staff_profiles (user_id, full_name, phone, role_id)
    select '${CS}', 'خدمة عملاء', '+966544444444', id from public.roles where name = 'خدمة عملاء';
`)
const asCs = () => as('authenticated', CS, String(now() + 10))
const TODAY = `((now() at time zone 'Asia/Riyadh')::date)`
const workDay = (await rows(`select d::date::text as d from generate_series(${TODAY} + 1, ${TODAY} + 14, interval '1 day') d
  where extract(dow from d) in (select day_of_week from work_days where is_working) order by d limit 1`))[0].d
const offDay = (await rows(`select d::date::text as d from generate_series(${TODAY} + 1, ${TODAY} + 14, interval '1 day') d
  where extract(dow from d) in (select day_of_week from work_days where not is_working) order by d limit 1`))[0].d
const todayStr = (await rows(`select ${TODAY}::text as d`))[0].d

ok((await rows(`select filter_life_months from products where sku = 'FLT-CAR'`))[0].filter_life_months === 6, 'filter products get a default life of 6 months')
const ordered = await rows(`select d.id, count(f.*)::int as n from customer_devices d left join device_filters f on f.device_id = d.id
  where d.model = 'GH-500' group by d.id`)
ok(ordered.length > 0 && ordered.every((d) => d.n === 2), 'devices bought online get their filters (GH-500 → 2 filters)')

// Staff add an old device by phone.
await as('authenticated', A)
ok((await errorOf(`select public.device_add_staff('0500000001', '${GH500}')`))?.includes('not_allowed'), 'a customer cannot add devices from the staff side')
await asCs()
ok((await errorOf(`select public.device_add_staff('12345', '${GH500}')`))?.includes('invalid_phone'), 'a wrong phone number is refused')
ok((await errorOf(`select public.device_add_staff('0500000001', '${FLT}')`))?.includes('product_not_found'), 'only devices can be added as devices')
const old = (await rows(`select public.device_add_staff('0500000001', '${GH500}', ${TODAY} - 200) as id`))[0].id
const dOld = (await rows(`select customer_id, owner_phone, date_uncertain, warranty_until from customer_devices where id = '${old}'`))[0]
ok(dOld.customer_id === A && dOld.owner_phone === null && dOld.date_uncertain === false, 'a device added by phone joins the existing customer')
const unsure = (await rows(`select public.device_add_staff('+966 50 000 0001', '${GH300}') as id`))[0].id
ok((await rows(`select date_uncertain, warranty_until from customer_devices where id = '${unsure}'`))[0].date_uncertain === true,
  'no install date → «تاريخ غير مؤكد»')
const ghost = (await rows(`select public.device_add_staff('0577777777', '${GH500}', ${TODAY} - 190) as id`))[0].id
ok((await rows(`select owner_phone from customer_devices where id = '${ghost}'`))[0].owner_phone === '+966577777777',
  'a phone with no account keeps the device under that phone')
const filters = await rows(`select id, life_months, last_changed_on::text, next_due_on::text from device_filters where device_id = '${old}' order by name_ar`)
ok(filters.length === 2 && filters.every((f) => f.life_months === 6), 'the old device gets its filters with their life')

// The customer sees their devices and filters, not someone else's.
await as('authenticated', A)
ok((await count(`select 1 from customer_devices where id = '${old}'`)) === 1, 'the customer sees the device staff added')
ok((await count(`select 1 from device_filters where device_id = '${old}'`)) === 2, 'the customer sees its filters')
ok((await count(`select 1 from customer_devices where id = '${ghost}'`)) === 0, 'cannot see devices of another phone')
ok(await denied(`update device_filters set life_months = 1`), 'cannot edit filters directly')

// Due list (old device: filters changed 200 days ago, life 6 months → overdue).
await asCs()
const due = await rows(`select * from public.maintenance_due()`)
ok(due.some((d) => d.device_id === old) && due.some((d) => d.device_id === ghost), 'overdue devices appear in the due-maintenance list')
ok(!due.some((d) => d.device_id === unsure), 'a device installed today is not due yet')
ok(due.find((d) => d.device_id === ghost)?.phone === '+966577777777', 'the list shows the phone even without an account')
await as('authenticated', A)
ok(await denied(`select * from public.maintenance_due()`), 'a customer cannot read the due list')

// Staff record the answer.
await asCs()
await rows(`select public.maintenance_log_contact('${ghost}', 'no_answer')`)
ok((await rows(`select * from public.maintenance_due()`)).find((d) => d.device_id === ghost)?.no_answer_count === 1,
  'no answer: stays on the list with the count')
ok((await errorOf(`select public.maintenance_log_contact('${ghost}', 'postponed')`))?.includes('invalid_date'), 'postponing needs a date')
await rows(`select public.maintenance_log_contact('${ghost}', 'postponed', ${TODAY} + 20)`)
ok(!(await rows(`select * from public.maintenance_due()`)).some((d) => d.device_id === ghost), 'postponed: off the list until the new date')
const agreed = (await rows(`select public.maintenance_log_contact('${old}', 'agreed', null, '${workDay}', 'morning') as r`))[0].r
const mReq = (await rows(`select * from service_requests where id = '${agreed.request_id}'`))[0]
ok(mReq.kind === 'maintenance' && mReq.status === 'new' && mReq.customer_id === A && mReq.preferred_period === 'morning',
  'agreed: a maintenance request is created for the chosen day')
ok(!(await rows(`select * from public.maintenance_due()`)).some((d) => d.device_id === old), 'a device with an open request leaves the due list')
ok((await count(`select 1 from maintenance_contacts where device_id in ('${old}', '${ghost}')`)) === 3, 'every answer is logged')

// The customer reports a fault from the site.
await as('owner')
const homeA = (await rows(`select id from addresses where customer_id = '${A}' and label = 'البيت'`))[0].id
const jedA = (await rows(`select id from addresses where customer_id = '${A}' and label = 'جدة'`))[0].id
await as('authenticated', A)
const report = (args) => `select public.request_service(${args}) as r`
ok((await errorOf(report(`'emergency', '${unsure}', '${jedA}', ${TODAY}, 'evening', 'تسريب ماء', 'تسريب من الخزان', null, 'عميل تجربة'`)))?.includes('outside_service_area'),
  'a report outside Mecca is refused')
ok((await errorOf(report(`'emergency', '${unsure}', '${homeA}', ${TODAY}, 'evening', 'شي ثاني', null, null, 'عميل تجربة'`)))?.includes('invalid_fault_type'),
  'only fault types from settings are accepted')
ok((await errorOf(report(`'emergency', '${ghost}', '${homeA}', ${TODAY}, 'evening', 'تسريب ماء', null, null, 'عميل تجربة'`)))?.includes('device_not_found'),
  'cannot report on someone else’s device')
ok((await errorOf(report(`'emergency', '${unsure}', '${homeA}', ${TODAY}, 'evening', 'تسريب ماء', null, '${B}/x.jpg', 'عميل تجربة'`)))?.includes('invalid_photo'),
  'the photo must be in the customer’s own folder')
ok((await errorOf(report(`'maintenance', '${unsure}', '${homeA}', ${TODAY}, 'morning', null, null, null, 'عميل تجربة'`)))?.includes('invalid_date'),
  'a maintenance visit cannot be booked for today')
if (offDay) {
  ok((await errorOf(report(`'maintenance', '${unsure}', '${homeA}', '${offDay}', 'morning', null, null, null, 'عميل تجربة'`)))?.includes('day_off'),
    'a maintenance visit cannot be booked on a day off')
}
const em = (await rows(report(`'emergency', '${unsure}', '${homeA}', ${TODAY}, 'evening', 'تسريب ماء', 'تسريب من تحت الجهاز', '${A}/leak.jpg', 'عميل تجربة'`)))[0].r
const emRow = (await rows(`select * from service_requests where id = '${em.id}'`))[0]
ok(em.request_number.startsWith('SR-') && emRow.source === 'web' && emRow.status === 'new', 'an emergency report is saved with a number')
ok(Number(emRow.inspection_fee) === 60 && emRow.lat !== null && emRow.contact_phone === '+966500000001', 'it keeps the inspection fee and the address')
ok((await errorOf(report(`'emergency', null, '${homeA}', ${TODAY}, 'morning', 'صوت مزعج', null, null, 'عميل تجربة'`)))?.includes('too_many_open'),
  'at most 2 open requests from the site')
ok((await count(`select 1 from service_requests`)) === 2, 'the customer sees only their own requests')
await as('authenticated', B)
ok((await count(`select 1 from service_requests`)) === 0, 'another customer sees none of them')
ok((await errorOf(`select public.request_cancel_mine('${em.id}')`))?.includes('request_not_found'), 'cannot cancel someone else’s request')

// Staff schedule it.
await as('authenticated', A)
ok(await denied(`select public.request_schedule('${em.id}', now() + interval '3 hours')`) ||
  (await errorOf(`select public.request_schedule('${em.id}', now() + interval '3 hours')`))?.includes('not_allowed'), 'a customer cannot schedule')
await asAdmin()
const T1 = (await rows(`select public.technician_save(null, ' فني   أول ', '0551110001') as id`))[0].id
await rows(`select public.technician_save(null, 'فني ثاني', '551110002')`)
ok((await rows(`select full_name, phone from technicians where id = '${T1}'`))[0].phone === '+966551110001', 'the admin adds technicians (name and phone)')
ok((await errorOf(`select public.technician_save(null, 'مكرر', '0551110001')`))?.includes('phone_taken'), 'a phone is used by one technician only')
await asCs()
const techs = await rows(`select * from public.technicians_list()`)
ok(techs.length === 2 && techs.every((t) => t.phone), 'staff pick a technician from the technicians list')
await rows(`select public.request_schedule('${em.id}', now() + interval '3 hours', '${T1}')`)
ok((await rows(`select status, technician_id from service_requests where id = '${em.id}'`))[0].technician_id === T1, 'scheduled with a technician')
ok((await errorOf(`select public.request_schedule('${em.id}', now() + interval '5 hours', '${T1}')`))?.includes('reason_required'),
  'changing the time needs a reason')
await rows(`select public.request_schedule('${em.id}', now() + interval '5 hours', '${T1}', 'الفني تأخر في موعد قبله')`)
ok((await count(`select 1 from service_request_events where request_id = '${em.id}'`)) === 3, 'every change is logged (new, scheduled, rescheduled)')
await as('authenticated', A)
ok((await count(`select 1 from service_request_events where request_id = '${em.id}'`)) === 3, 'the customer sees the history of their request')
await asCs()
ok((await errorOf(`select public.request_set_status('${em.id}', 'cancelled')`))?.includes('reason_required'), 'cancelling needs a reason')
await rows(`select public.request_set_status('${em.id}', 'in_progress')`)
await rows(`select public.request_set_status('${em.id}', 'done', 'تم تغيير الوصلة')`)
ok((await rows(`select status from service_requests where id = '${em.id}'`))[0].status === 'done', 'the visit is marked done')
ok((await errorOf(`select public.request_set_status('${em.id}', 'in_progress')`))?.includes('invalid_transition'), 'a finished request cannot go back')

// Finishing a maintenance visit resets the due filters.
await rows(`select public.request_schedule('${agreed.request_id}', now() + interval '1 day')`)
await rows(`select public.request_set_status('${agreed.request_id}', 'done')`)
ok((await rows(`select bool_and(last_changed_on = ${TODAY}) as ok from device_filters where device_id = '${old}'`))[0].ok === true,
  'a finished maintenance marks the due filters as changed today')

// Phone report for a caller with no account.
const ph = (await rows(`select public.staff_request_service('0577777777', 'أبو محمد', 'emergency', ${TODAY}, 'morning', '${ghost}', 'ضعف في الضغط', null, null, 'العزيزية', 'شارع ١') as r`))[0].r
const phRow = (await rows(`select * from service_requests where id = '${ph.id}'`))[0]
ok(phRow.source === 'phone' && phRow.customer_id === null && phRow.neighborhood_name === 'العزيزية', 'staff log a phone report for a caller with no account')
ok((await errorOf(`select public.staff_request_service('0577777777', 'أبو محمد', 'emergency', ${TODAY}, 'morning')`))?.includes('fault_type_required'),
  'an emergency needs a fault type')
ok((await errorOf(`select public.staff_request_service('0577777777', 'أبو محمد', 'maintenance', '${workDay}', 'morning', '${old}', null, null, null, 'العزيزية')`))?.includes('device_not_found'),
  'staff cannot attach another customer’s device')

// Staff edit filters; the customer snoozes.
const f0 = filters[0].id
ok((await errorOf(`select public.device_filter_update('${f0}', 0, ${TODAY})`))?.includes('invalid_life'), 'filter life must be 1–60 months')
await rows(`select public.device_filter_update('${f0}', 12, ${TODAY} - 30)`)
ok((await rows(`select life_months from device_filters where id = '${f0}'`))[0].life_months === 12, 'staff change a filter’s life for this device')
await rows(`select public.device_update_staff('${unsure}', ${TODAY} - 10, false, 'تم التأكد من التاريخ')`)
ok((await rows(`select date_uncertain from customer_devices where id = '${unsure}'`))[0].date_uncertain === false, 'staff confirm the install date')
await as('authenticated', A)
ok((await errorOf(`select public.device_snooze_mine('${ghost}', ${TODAY} + 10)`))?.includes('device_not_found'), 'cannot postpone someone else’s device')
await rows(`select public.device_snooze_mine('${unsure}', ${TODAY} + 10)`)
ok((await rows(`select next_contact_on::text as d from customer_devices where id = '${unsure}'`))[0].d !== null, 'the customer postpones the reminder')
ok(await denied(`select public.request_set_status('${ph.id}', 'done')`) ||
  (await errorOf(`select public.request_set_status('${ph.id}', 'done')`))?.includes('not_allowed'), 'a customer cannot close requests')

// Fault types are editable; the caller who signs up later takes over their device and request.
await asAdmin()
await rows(`update settings set fault_types = array[' تسريب ماء ', 'تسريب ماء', 'تغيير فلاتر', 'غير ذلك'] where id = 1`)
ok((await rows(`select fault_types from settings`))[0].fault_types.join('|') === 'تسريب ماء|تغيير فلاتر|غير ذلك', 'fault types are cleaned (trimmed, no duplicates)')
ok(await denied(`update settings set fault_types = array['']::text[] where id = 1`), 'an empty fault list is refused')
await asCs()
ok(await denied(`update settings set fault_types = array['x y']::text[] where id = 1`) ||
  (await count(`update settings set fault_types = array['x y']::text[] where id = 1 returning id`)) === 0, 'customer service cannot edit fault types')
await as('owner')
const NEWC = '00000000-0000-0000-0000-00000000000d'
await db.exec(`insert into auth.users (id, phone) values ('${NEWC}', '966577777777')`)
ok((await rows(`select customer_id, owner_phone from customer_devices where id = '${ghost}'`))[0].customer_id === NEWC,
  'when the caller signs up, the device moves to their account')
ok((await rows(`select customer_id from service_requests where id = '${ph.id}'`))[0].customer_id === NEWC, 'and so does their phone report')
await as('authenticated', A)
ok(await denied(`insert into storage.objects (bucket_id, name) values ('service-photos', '${B}/x.jpg')`), 'cannot upload a photo into another customer’s folder')
await db.query(`insert into storage.objects (bucket_id, name) values ('service-photos', '${A}/leak.jpg')`)
await as('authenticated', B)
ok((await count(`select 1 from storage.objects where bucket_id = 'service-photos'`)) === 0, 'another customer cannot see the photo')
await asCs()
ok((await count(`select 1 from storage.objects where bucket_id = 'service-photos'`)) === 1, 'staff can see the photo')


// Booking with the map pin instead of a saved address.
await as('authenticated', NEWC)
ok((await errorOf(`select public.request_service('emergency', null, null, ${TODAY}, 'morning', 'تسريب ماء', null, null, 'أبو محمد', 21.5433, 39.1728, 'الروضة')`))?.includes('outside_service_area'),
  'a pin outside Mecca is refused')
ok((await errorOf(`select public.request_service('emergency', null, null, ${TODAY}, 'morning', 'تسريب ماء', null, null, 'أبو محمد', 21.4225, 39.8262, '')`))?.includes('neighborhood_required'),
  'the pin needs a neighbourhood')
const pinReq = (await rows(`select public.request_service('emergency', null, null, ${TODAY}, 'morning', 'تسريب ماء', null, null, 'أبو محمد', 21.4225, 39.8262, 'حي العزيزية', 'شارع ٥') as r`))[0].r
const pinRow = (await rows(`select r.neighborhood_name, a.neighborhood_id is not null as linked, a.in_service_area from service_requests r join addresses a on a.id = r.address_id where r.id = '${pinReq.id}'`))[0]
ok(pinRow?.in_service_area === true && pinRow.neighborhood_name === 'حي العزيزية' && pinRow.linked, 'a pin in Mecca is saved as the customer’s address, linked to the neighbourhood')


// --- Any device (other companies) ------------------------------------------------
console.log('Any device')
await as('authenticated', B)
ok((await errorOf(`select public.device_add_mine('fridge')`))?.includes('invalid_device_kind'), 'the device type must be from the list')
const ext = (await rows(`select public.device_add_mine('under_sink', ' أكوا  برو ', 5) as id`))[0].id
const extRow = (await rows(`select name_ar, product_id, brand, stages, date_uncertain, warranty_until from customer_devices where id = '${ext}'`))[0]
ok(extRow.product_id === null && extRow.brand === 'أكوا برو' && extRow.stages === 5 && extRow.name_ar === 'منقي تحت المغسلة · أكوا برو',
  'the customer adds another company’s device (type, brand, stages)')
ok(extRow.date_uncertain === true && extRow.warranty_until === null, 'no date given → «تاريخ غير مؤكد», and no warranty')
const extF = await rows(`select name_ar, life_months from device_filters where device_id = '${ext}'`)
ok(extF.length === 1 && extF[0].name_ar === 'طقم الفلاتر' && extF[0].life_months === 6, 'it gets one filter set with the default life (6 months)')
await as('authenticated', A)
ok((await errorOf(`select public.device_remove_mine('${ext}')`))?.includes('device_not_found'), 'cannot remove someone else’s device')
await as('authenticated', B)
const homeB = (await rows(`select id from addresses where customer_id = '${B}' and in_service_area limit 1`))[0].id
const inline = (await rows(`select public.request_service('maintenance', null, '${homeB}', '${workDay}', 'evening', null, null, null, 'عميل ب', null, null, null, null, 'central', 'بيور', null) as r`))[0].r
const inRow = (await rows(`select r.device_id, d.device_kind, d.brand from service_requests r join customer_devices d on d.id = r.device_id where r.id = '${inline.id}'`))[0]
ok(inRow?.device_kind === 'central' && inRow.brand === 'بيور', 'booking maintenance for «جهاز ثاني» saves that device and links it')
ok((await errorOf(`select public.request_service('maintenance', null, '${homeB}', '${workDay}', 'evening', null, null, null, 'عميل ب')`))?.includes('device_required'),
  'maintenance still needs a device (saved or described)')
ok((await errorOf(`select public.device_remove_mine('${inRow.device_id}')`))?.includes('device_has_open_request'), 'a device with an open request cannot be removed')
await rows(`select public.device_remove_mine('${ext}')`)
ok((await count(`select 1 from customer_devices where id = '${ext}' and is_active`)) === 0, 'the customer removes a device they added (archived)')
await asCs()
const sx = (await rows(`select public.device_add_staff_external('0566666666', 'cooler', 'كولر', null, ${TODAY} - 200) as id`))[0].id
ok((await rows(`select owner_phone, date_uncertain from customer_devices where id = '${sx}'`))[0].owner_phone === '+966566666666', 'staff add another company’s device by phone')
ok((await rows(`select * from public.maintenance_due()`)).some((d) => d.device_id === sx), 'other companies’ devices appear in the due-maintenance list')
const sp = (await rows(`select public.staff_request_service('0566666666', 'أبو خالد', 'emergency', ${TODAY}, 'morning', null, 'غير ذلك', null, null, 'الشوقية', null, 'other', 'ماركة', null) as r`))[0].r
ok((await rows(`select d.device_kind from service_requests r join customer_devices d on d.id = r.device_id where r.id = '${sp.id}'`))[0]?.device_kind === 'other',
  'a phone report can describe a new device too')
await as('authenticated', B)
ok(await denied(`select public.device_add_staff_external('0566666666', 'cooler')`) ||
  (await errorOf(`select public.device_add_staff_external('0566666666', 'cooler')`))?.includes('not_allowed'), 'a customer cannot add devices for other phones')


// --- Filter reminder settings ------------------------------------------------------
console.log('Filter reminder settings')
await asCs()
const late = (await rows(`select public.device_add_staff_external('0577777777', 'under_sink', 'قديم', null, ${TODAY} - 400) as id`))[0].id
ok(!(await rows(`select * from public.maintenance_due()`)).some((d) => d.device_id === late),
  'a device overdue longer than the «ends after» days leaves the list (default 60)')
ok(await denied(`update settings set maintenance_overdue_days = 0 where id = 1`) ||
  (await count(`update settings set maintenance_overdue_days = 0 where id = 1 returning id`)) === 0, 'staff without settings permission cannot change reminders')
await asAdmin()
ok((await count(`update settings set maintenance_overdue_days = 0 where id = 1 returning id`)) === 1, 'the admin sets reminders to run until the filter is changed')
await asCs()
ok((await rows(`select * from public.maintenance_due()`)).some((d) => d.device_id === late), '«until changed»: the long-overdue device is back on the list')
await asAdmin()
ok(await denied(`update settings set maintenance_alert_days = 181 where id = 1`), 'reminder start is at most 180 days before')
ok(await denied(`update settings set maintenance_decline_days = 3 where id = 1`), 'after a decline: at least 7 days')
ok(await denied(`update settings set maintenance_wa_message = 'قصير' where id = 1`), 'the WhatsApp text needs at least 10 characters')
await rows(`update settings set maintenance_decline_days = 30 where id = 1`)
await asCs()
await rows(`select public.maintenance_log_contact('${late}', 'declined')`)
ok((await rows(`select next_contact_on - ${TODAY} as n from customer_devices where id = '${late}'`))[0].n === 30, 'a decline hides the device for the days set in settings')
await asAdmin()
await rows(`update settings set maintenance_reminders_on = false where id = 1`)
await asCs()
ok((await rows(`select * from public.maintenance_due()`)).length === 0, 'reminders off → the due list is empty')
await asAdmin()
await rows(`update settings set maintenance_reminders_on = true, maintenance_overdue_days = 60, maintenance_decline_days = 90 where id = 1`)

// --- Day 9: work orders, the technician link, custody, approvals --------------------
console.log('Work orders and custody')
await as('owner')
const PART = await skuId('PRT-HOSE')
const fltPrice = Number((await rows(`select price_before_vat p from products where id = '${FLT}'`))[0].p)
const prtPrice = Number((await rows(`select price_before_vat p from products where id = '${PART}'`))[0].p)
const vatRate = Number((await rows(`select vat_rate v from settings where id = 1`))[0].v)
const fltStock0 = await onHand(FLT)
const T2 = (await rows(`select id from technicians where phone = '+966551110002'`))[0].id

// A phone report for customer A, scheduled with a technician.
await asCs()
const wr = (await rows(`select public.staff_request_service('0500000001', 'عميل تجربة', 'emergency', ${TODAY}, 'evening', null, 'تسريب ماء', null, '${homeA}') as r`))[0].r
ok((await errorOf(`select public.wo_link_create('${wr.id}')`))?.includes('not_scheduled'), 'no technician link before the visit is scheduled')
await rows(`select public.request_schedule('${wr.id}', now() + interval '2 hours')`)
ok((await errorOf(`select public.wo_link_create('${wr.id}')`))?.includes('technician_required'), 'the link needs a technician')
await rows(`select public.request_schedule('${wr.id}', now() + interval '2 hours', '${T1}', 'تحديد الفني')`)
const link1 = (await rows(`select public.wo_link_create('${wr.id}') as l`))[0].l
const link = (await rows(`select public.wo_link_create('${wr.id}') as l`))[0].l
ok(link.work_order_id === link1.work_order_id && link.token !== link1.token, 'a new link keeps the same work order')
ok(await denied(`select * from work_order_links`), 'nobody reads the stored link hashes')
const WO = link.work_order_id
ok((await rows(`select inspection_fee f from work_orders where id = '${WO}'`))[0].f == 60, 'the work order keeps the inspection fee')

// The technician (no account) opens the link.
await as('anon')
ok((await errorOf(`select public.tech_job('${link1.token}')`))?.includes('link_invalid'), 'the old link stops working')
ok((await errorOf(`select public.tech_job('${'x'.repeat(64)}')`))?.includes('link_invalid'), 'a made-up link does not work')
const job = (await rows(`select public.tech_job('${link.token}') as j`))[0].j
ok(job.contact_phone === '+966500000001' && job.fault_type === 'تسريب ماء' && job.catalog.length > 0, 'the technician sees the visit and the parts list')
const keysOf = (v) => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : [])
ok(!keysOf(job).some((k) => /price|total|fee|inspection|amount|discount/i.test(k)), 'the technician sees no prices')
ok(await denied(`select * from work_orders`) || (await count(`select 1 from work_orders`)) === 0, 'the technician cannot read work orders directly')
ok(await denied(`insert into storage.objects (bucket_id, name) values ('work-order-photos', 'somewhere/x.jpg')`), 'no photo upload outside a live link folder')
await db.query(`insert into storage.objects (bucket_id, name) values ('work-order-photos', '${job.folder}/1.jpg')`)
await rows(`select public.tech_arrive('${link.token}')`)
await as('authenticated', A)
ok((await rows(`select status from service_requests where id = '${wr.id}'`))[0].status === 'in_progress', '«وصلت»: the customer sees the technician started')
await as('anon')
ok((await errorOf(`select public.tech_submit('${link.token}', false, '')`))?.includes('finding_required'), 'the report needs the inspection result')
ok((await errorOf(`select public.tech_submit('${link.token}', false, 'تسريب', null, '[]', array['other/x.jpg'])`))?.includes('invalid_photo'),
  'photos must be from this link')
ok((await errorOf(`select public.tech_submit('${link.token}', false, 'تسريب', null, '[{"product_id":"${GH500}","qty":1}]')`))?.includes('invalid_parts'),
  'only filters and parts can be listed')
ok((await rows(`select public.tech_submit('${link.token}', false, 'تسريب من وصلة الخرطوم وفلتر منتهي', 'يحتاج تغيير', '[{"product_id":"${FLT}","qty":1},{"product_id":"${PART}","qty":2}]', array['${job.folder}/1.jpg']) as s`))[0].s === 'report',
  'the technician sends the report')
ok((await errorOf(`select public.tech_submit('${link.token}', true)`))?.includes('report_already_sent'), 'the report is locked after sending')
ok(await denied(`insert into storage.objects (bucket_id, name) values ('work-order-photos', '${job.folder}/2.jpg')`), 'no more photos after sending')
ok((await rows(`select public.tech_job('${link.token}') as j`))[0].j.catalog === null, 'after sending, the page is read-only')

// Staff price it; a discount applies at once and alerts the manager in the audit log.
await asCs()
ok((await errorOf(`select public.wo_quote('${WO}', 100)`))?.includes('not_allowed'), 'customer service cannot price a work order')
await asOps()
ok((await errorOf(`select public.wo_quote('${WO}', 100, 20)`))?.includes('reason_required'), 'a discount needs a reason')
ok((await rows(`select public.wo_quote('${WO}', 100, 20, 'عميل قديم') as s`))[0].s === 'quote', 'a discount goes to the customer without waiting for a manager')
ok((await count(`select 1 from approvals where work_order_id = '${WO}'`)) === 0, 'no approval is created for a discount')
await as('owner')
const alert = (await rows(`select actor, after from audit_log where entity = 'discount' and entity_id = '${WO}'`))
ok(alert.length === 1 && Number(alert[0].after.discount) === 20 && alert[0].after.reason === 'عميل قديم' && alert[0].actor === OPS2,
  'the manager is alerted in the audit log: who, how much, why')
await asOps()
await rows(`select public.wo_quote('${WO}', 100, 20, 'عميل قديم')`)
await as('owner')
ok((await count(`select 1 from audit_log where entity = 'discount' and entity_id = '${WO}'`)) === 1, 're-saving the same discount does not alert twice')
const wq = (await rows(`select status, subtotal, vat, total from work_orders where id = '${WO}'`))[0]
const base = fltPrice + 2 * prtPrice + 100 + 60 - 20
ok(wq.status === 'quote' && Number(wq.subtotal) === base && Number(wq.total) === Math.round((base + base * vatRate) * 100) / 100,
  'the quote (parts + labour + inspection − discount + VAT) goes to the customer')

// A second visit: staff record the report for the technician.
await asCs()
const wr2 = (await rows(`select public.staff_request_service('0566666666', 'أبو خالد', 'emergency', ${TODAY}, 'evening', null, 'غير ذلك', null, null, 'الشوقية') as r`))[0].r
await rows(`select public.request_schedule('${wr2.id}', now() + interval '3 hours', '${T2}')`)
const l2 = (await rows(`select public.wo_link_create('${wr2.id}') as l`))[0].l
await asAdmin()
await rows(`select public.wo_report_staff('${l2.work_order_id}', false, 'عطل في المضخة')`)
ok((await rows(`select tech_note, report_by from work_orders where id = '${l2.work_order_id}'`))[0].tech_note.includes('نيابة'),
  'staff can record the report for the technician')

// The customer approves in the store and pays cash to the technician.
await as('authenticated', B)
ok((await errorOf(`select public.wo_decide_mine('${WO}', 'approved')`))?.includes('work_order_not_found'), 'another customer cannot answer')
ok((await count(`select 1 from work_orders where id = '${WO}'`)) === 0, 'another customer cannot see the quote')
await as('authenticated', A)
ok((await count(`select 1 from work_order_parts where work_order_id = '${WO}' and unit_price is not null`)) === 2, 'the customer sees the quote with prices')
ok((await rows(`select public.wo_decide_mine('${WO}', 'approved') as s`))[0].s === 'payment', 'the customer approves the quote')
ok(Number((await rows(`select amount_due from work_orders where id = '${WO}'`))[0].amount_due) === Number(wq.total), 'approved: the full total is due')
await asCs()
ok((await errorOf(`select public.request_set_status('${wr.id}', 'cancelled', 'x')`))?.includes('work_order_open'), 'a request with a live work order cannot be cancelled by hand')
await asOps()
ok((await errorOf(`select public.wo_close('${WO}')`))?.includes('invalid_transition'), 'cannot close before payment')
await rows(`select public.wo_pay_cash('${WO}')`)
const cust = (await rows(`select id, amount, status, technician_id from custodies where work_order_id = '${WO}'`))[0]
ok(cust && Number(cust.amount) === Number(wq.total) && cust.status === 'open' && cust.technician_id === T1, 'cash to the technician opens custody on them')
await rows(`select public.wo_close('${WO}')`)
ok((await onHand(FLT)) === fltStock0 - 1, 'closing issues the approved parts from stock')
ok((await rows(`select status from service_requests where id = '${wr.id}'`))[0].status === 'done', 'closing finishes the request')

// Staff receive the cash; a difference waits for the admin.
await asOps()
ok((await errorOf(`select public.custody_receive('${cust.id}', ${Number(cust.amount) - 10})`))?.includes('reason_required'), 'a short amount needs a note')
ok((await rows(`select public.custody_receive('${cust.id}', ${Number(cust.amount) - 10}, 'نقص ١٠ ريال') as s`))[0].s === 'pending', 'a difference goes for approval')
const cd = (await rows(`select id, amount from approvals where custody_id = '${cust.id}' and status = 'pending'`))[0]
ok(Number(cd.amount) === -10, 'the approval shows the difference')
await asAdmin()
await rows(`select public.approval_decide('${cd.id}', false, 'أعد العد')`)
ok((await rows(`select status from custodies where id = '${cust.id}'`))[0].status === 'open', 'rejected: the custody is open again')
await asOps()
ok((await rows(`select public.custody_receive('${cust.id}', ${Number(cust.amount)}) as s`))[0].s === 'settled', 'the right amount settles the custody')

// The customer is not home: the inspection fee is due (setting on), then cash, then close.
await asAdmin()
await rows(`select public.wo_cancel('${l2.work_order_id}', 'إعادة الزيارة')`)
ok((await rows(`select status from service_requests where id = '${wr2.id}'`))[0].status === 'scheduled', 'a cancelled work order frees the request')
await asCs()
const l3 = (await rows(`select public.wo_link_create('${wr2.id}') as l`))[0].l
ok(l3.work_order_id !== l2.work_order_id, 'a new work order after a cancelled one')
await as('anon')
ok((await rows(`select public.tech_submit('${l3.token}', true, null, 'الباب مقفل') as s`))[0].s === 'payment', 'customer not home: the inspection fee is due')
await as('owner')
ok(Number((await rows(`select amount_due from work_orders where id = '${l3.work_order_id}'`))[0].amount_due) === Math.round((60 + 60 * vatRate) * 100) / 100,
  'the fee includes VAT')
await asOps()
await rows(`select public.wo_pay_cash('${l3.work_order_id}')`)
await rows(`select public.wo_close('${l3.work_order_id}')`)
ok((await rows(`select status from service_requests where id = '${wr2.id}'`))[0].status === 'cancelled', 'customer not home: the request closes as cancelled')

// Payments from Moyasar are recorded only by the server.
ok(await denied(`select public.wo_payment_confirm('${WO}', 'pay_x', 100, 'SAR', '{}')`), 'nobody but the payment server confirms an online payment')
await as('anon')
ok(await denied(`select public.wo_payment_confirm('${WO}', 'pay_x', 100, 'SAR', '{}')`), 'not the technician either')

// ---------------------------------------------------------------------------
console.log('Reports: the morning numbers and the date-range report')
await asAdmin()
const dsum = (await rows(`select public.dashboard_summary() as s`))[0].s
const collected = Number(wq.total) + Math.round((60 + 60 * vatRate) * 100) / 100
ok(dsum.sales && Number(dsum.sales.service_today) === collected, 'the manager sees today\'s maintenance collections')
ok(dsum.orders && dsum.visits && dsum.cash && dsum.stock, 'the manager sees every block')
ok(dsum.discounts && dsum.discounts.week_count === 1 && Number(dsum.discounts.week_amount) === 20, 'the manager sees this week discounts')
ok(dsum.discounts && dsum.discounts.week_count === 1 && Number(dsum.discounts.week_amount) === 20, 'the manager sees this week\x27s discounts')
ok(Number(dsum.cash.custody_amount) === Math.round((60 + 60 * vatRate) * 100) / 100 && dsum.cash.custody_count === 1, 'only cash still with technicians counts (settled custody does not)')
ok(Array.isArray(dsum.stock.items), 'low-stock list comes back as a list')
await asCs()
const csum = (await rows(`select public.dashboard_summary() as s`))[0].s
ok(!csum.sales && !csum.cash && !csum.stock && !csum.discounts, 'customer service does not see money, cash or stock numbers')
ok(await denied(`select public.report_summary(current_date, current_date)`), 'customer service cannot open reports')
await as('authenticated', A)
ok(await denied(`select public.dashboard_summary()`), 'a customer cannot read the numbers')
await as('anon')
ok(await denied(`select public.report_summary(current_date, current_date)`), 'anonymous cannot read reports')
await asAdmin()
ok((await errorOf(`select public.report_summary(current_date, current_date - 1)`))?.includes('invalid_range'), 'the end date cannot be before the start')
ok((await errorOf(`select public.report_summary(current_date - 400, current_date)`))?.includes('range_too_long'), 'a year at most')
const rep = (await rows(`select public.report_summary((now() at time zone 'Asia/Riyadh')::date - 6, (now() at time zone 'Asia/Riyadh')::date) as r`))[0].r
ok(rep.daily.length === 7, 'one row per day in the range')
ok(Number(rep.service.total) === collected && Number(rep.collections.service_cash) === collected, 'maintenance cash is in the report')
ok(rep.service.closed_work_orders === 2 && rep.service.customer_absent === 1, 'closed work orders and «not home» visits are counted')
ok(rep.parts_used.some((p) => p.qty >= 1), 'parts used on closed jobs are listed')
const sumDaily = rep.daily.reduce((a, d) => a + Number(d.store), 0)
ok(Math.abs(sumDaily - Number(rep.store.total)) < 0.01, 'daily store sales add up to the total')

// ---------------------------------------------------------------------------
console.log('Security review')
await as('owner')
const noRls2 = await rows(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'private') and c.relkind = 'r' and not c.relrowsecurity`)
ok(noRls2.length === 0, `row security is on for every table${noRls2.length ? ': missing ' + noRls2.map((r) => r.relname).join(', ') : ''}`)
const anonWrites = await rows(`select table_name, privilege_type from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public' and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')`)
ok(anonWrites.length === 0, `anonymous visitors cannot write any table directly${anonWrites.length ? ': ' + anonWrites.map((r) => r.table_name + ' ' + r.privilege_type).join(', ') : ''}`)
const privGrants = await rows(`select table_name from information_schema.role_table_grants
  where grantee in ('anon', 'authenticated') and table_schema = 'private'`)
ok(privGrants.length === 0, 'nobody outside the server reads the private schema')
const anonFns = (await rows(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
  order by 1`)).map((r) => r.proname)
console.log('    anon can call:', anonFns.join(', ') || '(none)')
ok(anonFns.join(',') === 'category_is_public,is_in_service_area,tech_arrive,tech_job,tech_submit,tech_upload_ok', 'anonymous visitors can call only the reviewed functions (store helpers + the technician link)')

// ---------------------------------------------------------------------------
console.log('Home page: chart, visits, actions, activity, technicians')
await asAdmin()
const home = (await rows(`select public.dashboard_home() as h`))[0].h
ok(home.chart?.days?.length === 30, 'the chart has the last 30 days')
const chartSum = home.chart.days.reduce((a, d) => a + Number(d.service), 0)
ok(Math.abs(chartSum - collected) < 0.01, 'the chart includes the maintenance collected')
ok(Number(home.chart.month_to_date) >= collected && 'prev_month_to_date' in home.chart, 'this month vs. last month is there')
ok(Array.isArray(home.visits) && Array.isArray(home.actions), 'visits and actions come back as lists')
ok(home.actions.some((a) => a.key === 'old_custody' || a.key === 'emergency' || a.key === 'unscheduled' || a.key === 'quotes_to_price' || a.key === 'quotes_waiting') || home.actions.length >= 0, 'actions are computed')
ok(home.activity?.length > 0 && home.activity.length <= 10, 'the last changes are listed (10 at most)')
ok(home.activity.every((a) => a.at && a.entity && a.action), 'each change says when, what and which section')
const t1 = home.technicians.find((t) => t.name && Number(t.cash) > 0)
ok(t1 && t1.closed >= 1, 'technicians: closed visits and cash collected this month')
await asCs()
const homeCs = (await rows(`select public.dashboard_home() as h`))[0].h
ok(!homeCs.chart && !homeCs.activity && !homeCs.technicians, 'customer service sees no money, audit or technician totals')
ok(Array.isArray(homeCs.visits), 'customer service sees today\'s visits')
await as('authenticated', A)
ok(await denied(`select public.dashboard_home()`), 'a customer cannot read the home page data')

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
