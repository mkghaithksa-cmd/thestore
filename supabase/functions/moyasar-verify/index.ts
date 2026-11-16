// POST { order_id, payment_id } -> { status }
// Called by the store when Moyasar sends the customer back. Checks the
// caller owns the order, reads the payment from Moyasar with the secret
// key, and marks the order paid only if Moyasar says it is paid for the
// right order and amount.
import { callerClient, json, preflight } from '../_shared/common.ts'
import { confirmPaid, fetchPayment, secretKey } from '../_shared/moyasar.ts'

Deno.serve(async (req) => {
  const early = preflight(req)
  if (early) return early

  let body: { order_id?: unknown; payment_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  const orderId = typeof body.order_id === 'string' ? body.order_id : ''
  const paymentId = typeof body.payment_id === 'string' ? body.payment_id : ''
  if (!orderId || !paymentId) return json({ error: 'bad_request' }, 400)

  // The caller must be signed in and able to read this order (RLS: own orders only).
  const caller = callerClient(req)
  const { data: user } = await caller.auth.getUser()
  if (!user.user) return json({ error: 'not_signed_in' }, 401)
  const { data: order } = await caller.from('orders').select('id').eq('id', orderId).maybeSingle()
  if (!order) return json({ error: 'order_not_found' }, 404)

  if (!secretKey()) return json({ status: 'pending', error: 'not_configured' })

  const p = await fetchPayment(paymentId)
  if (!p) return json({ status: 'pending', error: 'lookup_failed' })
  if (p.metadata?.order_id !== orderId) return json({ error: 'mismatch' }, 400)
  if (p.status !== 'paid') return json({ status: p.status, message: p.source?.message ?? null })

  try {
    return json({ status: 'paid', result: await confirmPaid(p) })
  } catch (e) {
    console.error('confirm failed', (e as Error).message)
    return json({ status: 'pending', error: 'confirm_failed' })
  }
})
