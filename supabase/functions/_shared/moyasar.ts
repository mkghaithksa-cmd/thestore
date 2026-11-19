// Moyasar helpers. The secret key lives only in Edge Function secrets
// (MOYASAR_SECRET_KEY), set from a local window; it is never in the repository.
import { adminClient } from './common.ts'

export interface MoyasarPayment {
  id: string
  status: string
  amount: number
  currency: string
  metadata?: Record<string, string> | null
  source?: { type?: string; company?: string; message?: string } | null
}

const API = 'https://api.moyasar.com/v1/payments/'

export function secretKey(): string | null {
  const k = Deno.env.get('MOYASAR_SECRET_KEY') ?? ''
  return /^sk_(test|live)_[A-Za-z0-9]+$/.test(k) ? k : null
}

/** Reads a payment from Moyasar's API (the only source we trust). */
export async function fetchPayment(id: string): Promise<MoyasarPayment | null> {
  const key = secretKey()
  if (!key || !/^[0-9a-f-]{20,64}$/i.test(id)) return null
  const res = await fetch(API + encodeURIComponent(id), {
    headers: { Authorization: 'Basic ' + btoa(key + ':') },
  })
  if (!res.ok) {
    console.error('moyasar fetch failed', res.status)
    return null
  }
  return (await res.json()) as MoyasarPayment
}

/** Records a paid Moyasar payment against its order or work order (amount checked in the database). */
export async function confirmPaid(p: MoyasarPayment): Promise<string> {
  const workOrderId = p.metadata?.work_order_id
  if (workOrderId) {
    const { data, error } = await adminClient().rpc('wo_payment_confirm', {
      p_work_order_id: workOrderId,
      p_provider_payment_id: p.id,
      p_amount_halalas: p.amount,
      p_currency: p.currency,
      p_raw: { id: p.id, status: p.status, amount: p.amount, currency: p.currency, source: { type: p.source?.type, company: p.source?.company } },
    })
    if (error) throw new Error(error.message)
    return data as string
  }
  const orderId = p.metadata?.order_id
  if (!orderId) throw new Error('no_order')
  const method = p.source?.company ?? p.source?.type ?? null
  const { data, error } = await adminClient().rpc('payment_confirm', {
    p_order_id: orderId,
    p_provider_payment_id: p.id,
    p_amount_halalas: p.amount,
    p_currency: p.currency,
    p_method: method,
    p_raw: { id: p.id, status: p.status, amount: p.amount, currency: p.currency, source: { type: p.source?.type, company: p.source?.company } },
  })
  if (error) throw new Error(error.message)
  return data as string
}
