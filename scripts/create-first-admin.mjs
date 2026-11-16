// Creates the FIRST system admin (works only once, while none exists).
//
//   npm run create-admin
//
// Asks for name, phone and a 6-digit code in this terminal, then calls the
// bootstrap-admin Edge Function. The code is never stored or printed.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readEnv() {
  const file = path.join(root, 'apps', 'dashboard', '.env.local')
  if (!fs.existsSync(file)) throw new Error('apps/dashboard/.env.local is missing (copy .env.example and fill it in).')
  const env = Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  )
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new Error('Supabase URL/key missing in .env.local')
  return { url: env.VITE_SUPABASE_URL.replace(/\/$/, ''), key: env.VITE_SUPABASE_ANON_KEY }
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (hidden) {
      // Print the question, then hide what is typed.
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s)
        else if (s.includes('\n') || s.includes('\r')) rl.output.write('\n')
        else rl.output.write('*'.repeat(s.length))
      }
    }
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

const toAscii = (s) => s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))

const MESSAGES = {
  already_bootstrapped: 'يوجد مدير نظام مسبقاً. أضف الموظفين من لوحة الإدارة.',
  invalid_phone: 'رقم الجوال غير صحيح (05XXXXXXXX).',
  invalid_name: 'الاسم قصير جداً.',
  invalid_code: 'الرمز يجب أن يكون 6 أرقام.',
  server_error: 'خطأ في الخادم. تأكد أن الدوال مرفوعة (npx supabase functions deploy).',
}

async function main() {
  const { url, key } = readEnv()
  console.log('\nإنشاء أول مدير نظام لمنصة غيث\n')
  const name = await ask('الاسم الكامل: ')
  const phone = toAscii(await ask('رقم الجوال (05XXXXXXXX): '))
  const code = toAscii(await ask('اختر رمز دخول من 6 أرقام: ', { hidden: true }))
  const again = toAscii(await ask('أعد كتابة الرمز: ', { hidden: true }))

  if (!/^\d{6}$/.test(code)) return fail(MESSAGES.invalid_code)
  if (code !== again) return fail('الرمزان غير متطابقين.')

  const res = await fetch(`${url}/functions/v1/bootstrap-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify({ full_name: name, phone, code }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return fail(MESSAGES[body.error] ?? `${MESSAGES.server_error} (HTTP ${res.status})`)
  console.log('\n✅ تم إنشاء مدير النظام. ادخل لوحة الإدارة بجوالك والرمز الذي اخترته.\n')
}

function fail(message) {
  console.error(`\n❌ ${message}\n`)
  process.exitCode = 1
}

main().catch((e) => fail(e.message))
