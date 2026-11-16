import type { Fulfillment, Order, OrderItem } from '@ghaith/shared'
import { supabase } from './supabase'

export interface Neighborhood {
  id: string
  name_ar: string
}

export interface WorkDay {
  day_of_week: number
  name_ar: string
  is_working: boolean
}

export async function fetchNeighborhoods(): Promise<Neighborhood[]> {
  const { data, error } = await supabase.from('service_neighborhoods').select('id, name_ar').eq('is_active', true).order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function fetchWorkDays(): Promise<WorkDay[]> {
  const { data, error } = await supabase.from('work_days').select('day_of_week, name_ar, is_working').order('day_of_week')
  if (error) throw error
  return data ?? []
}

/** Same rule as the database's hood_key(): "حي الزاهر" = "الزاهر" = "زاهر". */
export function hoodKey(name: string): string {
  return name
    .replace(/s+/g, ' ')
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .replace(/^حي /, '')
    .replace(/(^| )ال/g, '$1')
    .trim()
}

export interface VisitDay {
  /** YYYY-MM-DD */
  date: string
  label: string
}

/** Working days from tomorrow to 30 days out, by Saudi time (the server checks the same rule). */
export function visitDays(workDays: WorkDay[], now = Date.now()): VisitDay[] {
  const open = new Map(workDays.filter((w) => w.is_working).map((w) => [w.day_of_week, w.name_ar]))
  const riyadh = new Date(now + 3 * 3600 * 1000)
  const base = Date.UTC(riyadh.getUTCFullYear(), riyadh.getUTCMonth(), riyadh.getUTCDate())
  const out: VisitDay[] = []
  for (let i = 1; i <= 30; i++) {
    const d = new Date(base + i * 86400000)
    const name = open.get(d.getUTCDay())
    if (!name) continue
    const date = d.toISOString().slice(0, 10)
    const dayMonth = d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    out.push({ date, label: `${i === 1 ? 'بكرة، ' : ''}${name} ${dayMonth}` })
  }
  return out
}

export interface PlaceOrderInput {
  items: { product_id: string; qty: number }[]
  fulfillment: Fulfillment
  lat: number
  lng: number
  city: string | null
  neighborhood_id: string | null
  neighborhood_name: string | null
  street: string | null
  address_notes: string | null
  contact_name: string | null
  preferred_visit_date: string | null
  customer_notes: string | null
  privacy_accepted: boolean
}

export interface PlacedOrder {
  id: string
  order_number: string
  total: number
  expires_at: string
}

/** The server prices and checks everything again; only ids, quantities and the address are sent. */
export async function placeOrder(input: PlaceOrderInput): Promise<PlacedOrder> {
  const { data, error } = await supabase.rpc('create_order', input)
  if (error) throw new Error(error.message)
  return data as PlacedOrder
}

export async function fetchMyOrders(): Promise<Order[]> {
  const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(100)
  if (error) throw error
  return (data ?? []) as Order[]
}

export async function fetchOrder(id: string): Promise<{ order: Order; items: OrderItem[] } | null> {
  const [o, i] = await Promise.all([
    supabase.from('orders').select('*').eq('id', id).maybeSingle(),
    supabase.from('order_items').select('*').eq('order_id', id),
  ])
  if (o.error) throw o.error
  if (i.error) throw i.error
  if (!o.data) return null
  return { order: o.data as Order, items: (i.data ?? []) as OrderItem[] }
}

export function formatDate(iso: string, withTime = false): string {
  return new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleString('ar-SA-u-ca-gregory-nu-latn', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: 'Asia/Riyadh',
  })
}
