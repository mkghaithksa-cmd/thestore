// Database security test — runs every migration + seed in an in-memory
// Postgres (PGlite) with small stand-ins for Supabase's auth/storage schemas,
// then checks what visitors, customers and staff can and cannot do.
//
//   npm run test:db
//
// No Docker and no connection to the real project are needed.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'supabase', 'migrations')
const db = new PGlite()

// --- Minimal Supabase stand-ins ------------------------------------------
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key, phone text, raw_app_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;

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
const as = async (role, uid = '') => {
  await db.exec(`reset role; set test.uid = '${uid}'; ${role === 'owner' ? '' : `set role ${role};`}`)
}

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

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed')
process.exit(failures ? 1 : 0)
