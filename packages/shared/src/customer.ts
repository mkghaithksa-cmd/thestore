/** Row shape of public.customers (see supabase/migrations). */
export interface Customer {
  id: string
  /** E.164, e.g. +966500000001 */
  phone: string
  full_name: string | null
  email: string | null
  privacy_accepted_at: string | null
  /** Computed in the database: 'full' once name and consent exist. */
  profile_type: 'short' | 'full'
  created_at: string
  updated_at: string
}

/** Login code rules (mirrored in the Supabase project settings). */
export const OTP_LENGTH = 6
export const OTP_RESEND_SECONDS = 60
export const OTP_EXPIRY_SECONDS = 300

const ARABIC_DIGITS = /[٠-٩۰-۹]/g

/** Converts Arabic-Indic / Persian digits to ASCII digits. */
export function toAsciiDigits(input: string): string {
  return input.replace(ARABIC_DIGITS, (d) => {
    const code = d.charCodeAt(0)
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660)
  })
}

/**
 * Normalises a Saudi mobile number to E.164 (+9665XXXXXXXX).
 * Accepts 05XXXXXXXX, 5XXXXXXXX, 9665XXXXXXXX, +9665XXXXXXXX, 009665XXXXXXXX
 * (spaces, dashes and Arabic digits allowed). Returns null if invalid.
 */
export function normalizeSaudiPhone(input: string): string | null {
  let d = toAsciiDigits(input).replace(/[\s\-()]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  if (d.startsWith('00')) d = d.slice(2)
  if (d.startsWith('966')) d = d.slice(3)
  if (d.startsWith('0')) d = d.slice(1)
  return /^5\d{8}$/.test(d) ? `+966${d}` : null
}

/** +9665XXXXXXXX -> 05XXXXXXXX for display. */
export function formatSaudiPhoneLocal(e164: string | null | undefined): string {
  if (!e164) return ''
  const d = e164.replace(/^\+?966/, '')
  return d.startsWith('5') ? `0${d}` : e164
}
