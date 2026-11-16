// Moyasar webhook (payment_paid). A backup for customers who close the
// page before returning to the store. The payload is not trusted: the
// shared secret token must match, and the payment is read again from
// Moyasar's API before anything is recorded.
import { json, preflight } from '../_shared/common.ts'
import { confirmPaid, fetchPayment } from '../_shared/moyasar.ts'

function sameSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

Deno.serve(async (req) => {
  const early = preflight(req)
  if (early) return early

  const secret = Deno.env.get('MOYASAR_WEBHOOK_SECRET') ?? ''
  let body: { type?: string; secret_token?: string; data?: { id?: string } }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  if (!secret || !sameSecret(String(body.secret_token ?? ''), secret)) return json({ error: 'forbidden' }, 403)
  if (body.type !== 'payment_paid' || !body.data?.id) return json({ ok: true, ignored: true })

  const p = await fetchPayment(body.data.id)
  if (!p || p.status !== 'paid') return json({ ok: true, ignored: true })
  try {
    return json({ ok: true, result: await confirmPaid(p) })
  } catch (e) {
    console.error('webhook confirm failed', (e as Error).message)
    return json({ error: 'confirm_failed' }, 500)
  }
})
