// Shared helpers for Ghaith Edge Functions.
// Keys come from the environment Supabase injects into every function;
// nothing secret is stored in the repository.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Handles CORS preflight and rejects anything but POST. */
export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  return null
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } }

/** Full-access client. Never returned to callers. */
export const adminClient = (): SupabaseClient => createClient(SUPABASE_URL, SERVICE_KEY, noSession)

/** Public client (used to exchange a one-time token for a session). */
export const publicClient = (): SupabaseClient => createClient(SUPABASE_URL, ANON_KEY, noSession)

/** Client acting as the caller (RLS + auth.uid() apply). */
export const callerClient = (req: Request): SupabaseClient =>
  createClient(SUPABASE_URL, ANON_KEY, {
    ...noSession,
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })

/** 05XXXXXXXX / +9665XXXXXXXX / 9665XXXXXXXX -> +9665XXXXXXXX, else null. */
export function normalizeSaudiPhone(input: unknown): string | null {
  if (typeof input !== 'string') return null
  let d = input.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[\s\-()]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('966')) d = d.slice(3)
  if (d.startsWith('0')) d = d.slice(1)
  return /^5\d{8}$/.test(d) ? `+966${d}` : null
}

export const isSixDigits = (v: unknown): v is string => typeof v === 'string' && /^\d{6}$/.test(v)

/** Hidden login e-mail for a staff auth user (never receives mail). */
export const staffEmail = () => `staff-${crypto.randomUUID()}@staff.ghaith.invalid`

/** Turns a Postgres "raise exception 'code'" into its code. */
export function dbErrorCode(message: string | undefined): string {
  const known = [
    'forbidden', 'invalid_code', 'invalid_phone', 'invalid_name', 'invalid_role',
    'phone_taken', 'already_bootstrapped', 'locked_admin', 'not_found', 'cannot_change_self',
  ]
  return known.find((k) => message?.includes(k)) ?? 'server_error'
}

/** Creates a session for a user without any password, via a one-time token. */
export async function sessionFor(userId: string) {
  const admin = adminClient()
  const { data: u, error: userErr } = await admin.auth.admin.getUserById(userId)
  if (userErr || !u.user?.email) throw new Error('user_lookup_failed')
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: u.user.email,
  })
  if (linkErr || !link.properties?.hashed_token) throw new Error('link_failed')
  const { data, error } = await publicClient().auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  })
  if (error || !data.session) throw new Error('session_failed')
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token }
}
