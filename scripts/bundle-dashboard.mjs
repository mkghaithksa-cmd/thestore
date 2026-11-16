// Builds the admin dashboard and puts it inside the store's build output,
// so one Cloudflare Pages site serves both:
//
//   /                 → store
//   /gh-ops-7k2/...   → admin dashboard (hard-to-guess path, not indexed)
//
// Runs automatically at the end of `npm run build -w @ghaith/store`, so the
// existing Cloudflare build command and output folder stay the same.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'gh-ops-7k2'
const storeDist = path.join(root, 'apps', 'store', 'dist')
const dashDist = path.join(root, 'apps', 'dashboard', 'dist')
const target = path.join(storeDist, BASE)

// Keep in sync with DASHBOARD_BASE_PATH (@ghaith/shared) and apps/dashboard/vite.config.ts.
const shared = fs.readFileSync(path.join(root, 'packages', 'shared', 'src', 'staff.ts'), 'utf8')
const viteCfg = fs.readFileSync(path.join(root, 'apps', 'dashboard', 'vite.config.ts'), 'utf8')
if (!shared.includes(`'/${BASE}/'`) || !viteCfg.includes(`'/${BASE}/'`)) {
  console.error(`Dashboard base path mismatch: expected /${BASE}/ in shared/staff.ts and dashboard/vite.config.ts`)
  process.exit(1)
}

console.log('\n› Building the admin dashboard…')
execSync('npm run build -w @ghaith/dashboard', { cwd: root, stdio: 'inherit' })

fs.rmSync(target, { recursive: true, force: true })
fs.cpSync(dashDist, target, { recursive: true })

// Cloudflare Pages: deep links inside the dashboard load its own index.html.
// - Rewrite to the folder, not to ".../index.html" (Pages ignores that).
// - A splat rule would also catch real files, so the dashboard's files are
//   passed through first (top-level files, then each sub-folder).
// - Without a top-level 404.html, every other path falls back to the store.
const entries = fs.readdirSync(target, { withFileTypes: true })
const topFiles = entries
  .filter((e) => e.isFile() && e.name !== 'index.html')
  .map((e) => `/${BASE}/${e.name} /${BASE}/${e.name} 200`)
const folders = entries
  .filter((e) => e.isDirectory())
  .map((e) => `/${BASE}/${e.name}/* /${BASE}/${e.name}/:splat 200`)
fs.writeFileSync(
  path.join(storeDist, '_redirects'),
  [...topFiles, ...folders, `/${BASE}/* /${BASE}/ 200`, ''].join('\n'),
)

// Not indexed, never framed, no referrer leaking the path. These files are
// read by Cloudflare and are not served to visitors.
fs.writeFileSync(
  path.join(storeDist, '_headers'),
  [
    `/${BASE}/*`,
    '  X-Robots-Tag: noindex, nofollow',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: no-referrer',
    '  Cache-Control: no-cache',
    `/${BASE}/assets/*`,
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n'),
)

console.log(`✓ Dashboard copied to apps/store/dist/${BASE}/`)
