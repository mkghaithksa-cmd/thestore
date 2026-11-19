// Puts the SEO worker into the store's build output (Cloudflare Pages
// "advanced mode"): dist/_worker.js plus dist/_routes.json, which limits the
// worker to the public pages, the sitemap and robots.txt. Assets and the admin
// dashboard never reach it.
//
// Only the public Supabase URL and publishable key go in (the same values the
// store's JavaScript already ships). Runs at the end of the store build.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const storeDir = path.join(root, 'apps', 'store')
const dist = path.join(storeDir, 'dist')

function fromEnvFiles(name) {
  for (const f of ['.env.production.local', '.env.local', '.env.production', '.env']) {
    const p = path.join(storeDir, f)
    if (!fs.existsSync(p)) continue
    const line = fs
      .readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${name}=`))
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '')
  }
  return ''
}

const url = (process.env.VITE_SUPABASE_URL || fromEnvFiles('VITE_SUPABASE_URL')).replace(/\/$/, '')
const key = process.env.VITE_SUPABASE_ANON_KEY || fromEnvFiles('VITE_SUPABASE_ANON_KEY')

if (!url || !key) {
  console.warn('› SEO worker skipped: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set.')
  process.exit(0)
}
if (/^sb_secret_|service_role/.test(key)) {
  console.error('› Refusing to build: VITE_SUPABASE_ANON_KEY must be the publishable key, never a secret key.')
  process.exit(1)
}

const src = fs.readFileSync(path.join(storeDir, 'seo', 'worker.js'), 'utf8')
fs.writeFileSync(path.join(dist, '_worker.js'), src.replace('__SUPABASE_URL__', url).replace('__SUPABASE_KEY__', key))
fs.writeFileSync(
  path.join(dist, '_routes.json'),
  JSON.stringify(
    {
      version: 1,
      include: ['/', '/products', '/products/*', '/pages/*', '/maintenance', '/cart', '/login', '/account', '/orders', '/sitemap.xml', '/robots.txt'],
      exclude: [],
    },
    null,
    2,
  ),
)
console.log('› SEO worker written (dist/_worker.js, dist/_routes.json).')
