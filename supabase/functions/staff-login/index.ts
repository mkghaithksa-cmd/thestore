// POST { phone, code } -> { access_token, refresh_token }
// Staff login with phone + 6-digit code. The database enforces the
// lockout (5 wrong codes -> 15 minutes) in staff_verify_code().
import { adminClient, isSixDigits, json, normalizeSaudiPhone, preflight, sessionFor } from '../_shared/common.ts'

Deno.serve(async (req) => {
  const early = preflight(req)
  if (early) return early

  let body: { phone?: unknown; code?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }

  const phone = normalizeSaudiPhone(body.phone)
  if (!phone || !isSixDigits(body.code)) return json({ error: 'invalid' }, 401)

  const { data, error } = await adminClient().rpc('staff_verify_code', { p_phone: phone, p_code: body.code })
  if (error) {
    console.error('staff_verify_code failed', error.message)
    return json({ error: 'server_error' }, 500)
  }

  const result = data as { status: string; user_id?: string; locked_until?: string; attempts_left?: number }
  if (result.status !== 'ok' || !result.user_id) {
    return json(
      { error: result.status, locked_until: result.locked_until, attempts_left: result.attempts_left },
      result.status === 'locked' ? 423 : 401,
    )
  }

  try {
    return json(await sessionFor(result.user_id))
  } catch (e) {
    console.error('session creation failed', (e as Error).message)
    return json({ error: 'server_error' }, 500)
  }
})
