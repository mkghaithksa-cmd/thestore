import { supabase } from './supabase'

/** "05xxxxxxxx" / "5xxxxxxxx" / "+9665…" → "+9665xxxxxxxx", or null. Same rule as the database. */
export function normalizePhone(v: string): string | null {
  let d = v.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660)).replace(/[^0-9]/g, '')
  if (/^05\d{8}$/.test(d)) d = '966' + d.slice(1)
  else if (/^5\d{8}$/.test(d)) d = '966' + d
  else if (/^009665\d{8}$/.test(d)) d = d.slice(2)
  return /^9665\d{8}$/.test(d) ? '+' + d : null
}

export const localPhone = (p: string) => p.replace(/^\+966/, '0')

export function waLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`
}

/** Today (or today + n) as YYYY-MM-DD, Saudi time. */
export function riyadhDate(addDays = 0, now = Date.now()): string {
  const r = new Date(now + 3 * 3600 * 1000)
  return new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate()) + addDays * 86400000).toISOString().slice(0, 10)
}

/** ISO time → value for <input type="datetime-local"> in Saudi time. */
export const toRiyadhInput = (iso: string) => new Date(Date.parse(iso) + 3 * 3600 * 1000).toISOString().slice(0, 16)
/** <input type="datetime-local"> value (Saudi time) → ISO with offset. */
export const fromRiyadhInput = (v: string) => `${v}:00+03:00`

export const when = (iso: string, time = true) =>
  new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleString('ar-SA-u-ca-gregory-nu-latn', {
    weekday: iso.length === 10 ? 'long' : undefined,
    day: 'numeric',
    month: 'short',
    ...(time && iso.length > 10 ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: 'Asia/Riyadh',
  })

export interface Technician {
  id: string
  full_name: string
  phone: string
}

export async function fetchTechnicians(): Promise<Technician[]> {
  const { data, error } = await supabase.rpc('technicians_list')
  if (error) throw new Error(error.message)
  return (data ?? []) as Technician[]
}

export async function fetchFaultTypes(): Promise<string[]> {
  const { data, error } = await supabase.from('settings').select('fault_types').eq('id', 1).maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.fault_types as string[] | undefined) ?? []
}

export async function photoUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('service-photos').createSignedUrl(path, 600)
  return data?.signedUrl ?? null
}

export interface StaffDevice {
  id: string
  customer_id: string | null
  owner_phone: string | null
  product_id: string | null
  device_kind: import('@ghaith/shared').DeviceKind | null
  brand: string | null
  stages: number | null
  added_by: string | null
  name_ar: string
  model: string | null
  installed: boolean
  started_on: string
  date_uncertain: boolean
  warranty_until: string | null
  notes: string | null
  is_active: boolean
  next_contact_on: string | null
  order_id: string | null
  filters: import('@ghaith/shared').DeviceFilter[]
}

export interface PhoneLookup {
  phone: string
  customer: { id: string; full_name: string | null; phone: string; created_at: string } | null
  devices: StaffDevice[]
  addresses: { id: string; label: string | null; neighborhood_name: string | null; street: string | null; in_service_area: boolean; neighborhood: { name_ar: string } | null }[]
}

/** Customer (if any), devices and addresses for a phone number. */
export async function lookupPhone(phone: string): Promise<PhoneLookup> {
  const c = await supabase.from('customers').select('id, full_name, phone, created_at').eq('phone', phone).maybeSingle()
  if (c.error) throw new Error(c.error.message)
  const customer = c.data
  const dq = supabase.from('customer_devices').select('*, filters:device_filters(*)').order('started_on', { ascending: false })
  const [d, a] = await Promise.all([
    customer ? dq.eq('customer_id', customer.id) : dq.eq('owner_phone', phone),
    customer
      ? supabase
          .from('addresses')
          .select('id, label, neighborhood_name, street, in_service_area, neighborhood:service_neighborhoods(name_ar)')
          .eq('customer_id', customer.id)
          .eq('is_active', true)
          .order('last_used_at', { ascending: false, nullsFirst: false })
      : Promise.resolve({ data: [], error: null }),
  ])
  if (d.error) throw new Error(d.error.message)
  if (a.error) throw new Error(a.error.message)
  const devices = ((d.data ?? []) as StaffDevice[]).map((x) => ({
    ...x,
    filters: (x.filters ?? []).sort((p, q) => Number(q.is_active) - Number(p.is_active) || p.next_due_on.localeCompare(q.next_due_on)),
  }))
  return { phone, customer, devices, addresses: (a.data ?? []) as unknown as PhoneLookup['addresses'] }
}

/** Where the store lives (the technician link and the customer payment link point there). */
export const STORE_ORIGIN = import.meta.env.DEV ? 'http://localhost:5173' : window.location.origin

export const techLink = (token: string) => `${STORE_ORIGIN}/t/${token}`

export async function woPhotoUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('work-order-photos').createSignedUrl(path, 600)
  return data?.signedUrl ?? null
}

export const sar = (n: number | string) =>
  Number(n).toLocaleString('ar-SA-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س'
