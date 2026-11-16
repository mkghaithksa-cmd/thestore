// POST { full_name, phone, code } -> { ok: true }
// Creates the FIRST system admin. Works only while no system admin exists;
// after that it refuses forever (checked again inside staff_bootstrap()).
import {
  adminClient,
  dbErrorCode,
  isSixDigits,
  json,
  normalizeSaudiPhone,
  preflight,
  staffEmail,
} from '../_shared/common.ts'

Deno.serve(async (req) => {
  const early = preflight(req)
  if (early) return early

  const admin = adminClient()
  const { data: open, error: openErr } = await admin.rpc('staff_bootstrap_open')
  if (openErr) return json({ error: 'server_error' }, 500)
  if (open !== true) return json({ error: 'already_bootstrapped' }, 409)

  let body: { full_name?: unknown; phone?: unknown; code?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const phone = normalizeSaudiPhone(body.phone)
  const name = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  if (!phone) return json({ error: 'invalid_phone' }, 400)
  if (name.length < 2) return json({ error: 'invalid_name' }, 400)
  if (!isSixDigits(body.code)) return json({ error: 'invalid_code' }, 400)

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: staffEmail(),
    email_confirm: true,
    app_metadata: { kind: 'staff' },
    user_metadata: { full_name: name },
  })
  if (createErr || !created.user) {
    console.error('createUser failed', createErr?.message)
    return json({ error: 'server_error' }, 500)
  }

  const { error } = await admin.rpc('staff_bootstrap', {
    p_user: created.user.id,
    p_name: name,
    p_phone: phone,
    p_code: body.code,
  })
  if (error) {
    await admin.auth.admin.deleteUser(created.user.id)
    const code = dbErrorCode(error.message)
    return json({ error: code }, code === 'already_bootstrapped' ? 409 : 400)
  }

  return json({ ok: true })
})
