// POST { full_name, phone, role_id, code } -> { user_id }
// Adds a staff member. The caller must be signed-in staff with
// users_roles:add; the permission (and system-admin rules) are checked
// again inside staff_register(), which runs as the caller so the audit log
// records who did it. Other staff actions (code, role, enable/disable)
// are plain database functions called directly from the dashboard.
import {
  adminClient,
  callerClient,
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

  const caller = callerClient(req)
  const { data: who } = await caller.auth.getUser()
  if (!who?.user) return json({ error: 'unauthorized' }, 401)

  const { data: allowed } = await caller.rpc('has_permission', { page: 'users_roles', action: 'add' })
  if (allowed !== true) return json({ error: 'forbidden' }, 403)

  let body: { full_name?: unknown; phone?: unknown; role_id?: unknown; code?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const phone = normalizeSaudiPhone(body.phone)
  const name = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  if (!phone) return json({ error: 'invalid_phone' }, 400)
  if (name.length < 2) return json({ error: 'invalid_name' }, 400)
  if (typeof body.role_id !== 'string') return json({ error: 'invalid_role' }, 400)
  if (!isSixDigits(body.code)) return json({ error: 'invalid_code' }, 400)

  const admin = adminClient()
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

  const { error } = await caller.rpc('staff_register', {
    p_user: created.user.id,
    p_name: name,
    p_phone: phone,
    p_role: body.role_id,
    p_code: body.code,
  })
  if (error) {
    await admin.auth.admin.deleteUser(created.user.id)
    const code = dbErrorCode(error.message)
    return json({ error: code }, code === 'forbidden' ? 403 : 400)
  }

  return json({ user_id: created.user.id })
})
