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
  grant all on storage.objects to authenticated;
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

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
