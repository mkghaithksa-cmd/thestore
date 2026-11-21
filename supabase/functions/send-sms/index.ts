// Supabase Auth "Send SMS" hook: delivers the customer's login code through
// Authentica (Saudi SMS / WhatsApp). Supabase creates and checks the code;
// this function only delivers it. The request is signed by Supabase Auth
// (Standard Webhooks), so nobody else can use it to send messages.
//
// Secrets (set in Supabase, never in the repository):
//   AUTHENTICA_API_KEY      Authentica API key (X-Authorization)
//   SEND_SMS_HOOK_SECRET    "v1,whsec_..." shared with the Auth hook
// Optional:
//   AUTHENTICA_METHOD       sms (default) or whatsapp
//   AUTHENTICA_TEMPLATE_ID  Authentica message template (default: account default)
import { Webhook } from 'npm:standardwebhooks@1.0.0'

const API = 'https://api.authentica.sa/api/v2/send-otp'

function reply(status: number, message?: string): Response {
  const body = status === 200 ? {} : { error: { http_code: status, message } }
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, 'method not allowed')

  const apiKey = Deno.env.get('AUTHENTICA_API_KEY') ?? ''
  const hookSecret = (Deno.env.get('SEND_SMS_HOOK_SECRET') ?? '').replace('v1,whsec_', '')
  if (!apiKey || !hookSecret) {
    console.error('send-sms: missing secrets')
    return reply(500, 'SMS is not configured')
  }

  const raw = await req.text()
  let payload: { user?: { phone?: string }; sms?: { otp?: string } }
  try {
    payload = new Webhook(hookSecret).verify(raw, Object.fromEntries(req.headers)) as typeof payload
  } catch {
    return reply(401, 'invalid signature')
  }

  const digits = String(payload.user?.phone ?? '').replace(/\D/g, '')
  const otp = String(payload.sms?.otp ?? '')
  if (!/^[1-9]\d{7,14}$/.test(digits) || !/^\d{4,10}$/.test(otp)) return reply(400, 'bad payload')

  const method = Deno.env.get('AUTHENTICA_METHOD') === 'whatsapp' ? 'whatsapp' : 'sms'
  const template = Number(Deno.env.get('AUTHENTICA_TEMPLATE_ID') ?? '')
  const body: Record<string, unknown> = { method, phone: `+${digits}`, otp }
  if (Number.isInteger(template) && template > 0) body.template_id = template

  let res: Response
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { 'X-Authorization': apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
  } catch (e) {
    console.error('send-sms: Authentica unreachable', (e as Error).message)
    return reply(502, 'SMS provider unreachable')
  }
  const text = await res.text()
  let ok = res.ok
  try {
    const j = JSON.parse(text)
    if (j && j.success === false) ok = false
  } catch {
    // Non-JSON reply: trust the HTTP status.
  }
  if (!ok) {
    // Log the provider's answer (never the code or the key) and the last digits only.
    console.error('send-sms: Authentica refused', res.status, text.slice(0, 300), `…${digits.slice(-3)}`)
    return reply(502, 'SMS provider refused the message')
  }
  return reply(200)
})
