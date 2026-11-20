import type { DeviceFilter, DeviceKind, ServiceKind, ServicePeriod, ServiceRequest, ServiceRequestEvent, WorkOrder } from '@ghaith/shared'
import { supabase } from './supabase'

export interface MyDeviceFull {
  id: string
  name_ar: string
  model: string | null
  product_id: string | null
  device_kind: DeviceKind | null
  brand: string | null
  installed: boolean
  started_on: string
  date_uncertain: boolean
  warranty_until: string | null
  order_id: string | null
  next_contact_on: string | null
  product: { sku: string } | null
  filters: DeviceFilter[]
}

export async function fetchMyDevicesFull(): Promise<MyDeviceFull[]> {
  const { data, error } = await supabase
    .from('customer_devices')
    .select(
      'id, name_ar, model, product_id, device_kind, brand, installed, started_on, date_uncertain, warranty_until, order_id, next_contact_on, product:products(sku), filters:device_filters(*)',
    )
    .eq('is_active', true)
    .order('started_on', { ascending: false })
  if (error) throw error
  return ((data ?? []) as unknown as MyDeviceFull[]).map((d) => ({
    ...d,
    filters: (d.filters ?? []).filter((f) => f.is_active).sort((a, b) => a.next_due_on.localeCompare(b.next_due_on)),
  }))
}

export async function fetchMyRequests(): Promise<ServiceRequest[]> {
  const uid = (await supabase.auth.getSession()).data.session?.user.id ?? ''
  const { data, error } = await supabase.from('service_requests').select('*').eq('customer_id', uid).order('created_at', { ascending: false }).limit(50)
  if (error) throw error
  return (data ?? []) as ServiceRequest[]
}

export async function fetchRequestEvents(ids: string[]): Promise<ServiceRequestEvent[]> {
  if (!ids.length) return []
  const { data, error } = await supabase.from('service_request_events').select('*').in('request_id', ids).order('created_at')
  if (error) throw error
  return (data ?? []) as ServiceRequestEvent[]
}

export interface MyAddress {
  id: string
  label: string | null
  neighborhood_name: string | null
  street: string | null
  building_note: string | null
  lat: number | null
  lng: number | null
  is_default: boolean
}

/** Saved addresses inside the service area (maintenance is Mecca only). */
export async function fetchMyMeccaAddresses(): Promise<MyAddress[]> {
  const { data, error } = await supabase
    .from('addresses')
    .select('id, label, neighborhood_name, street, building_note, lat, lng, is_default, neighborhood:service_neighborhoods(name_ar)')
    // Only this customer's own (a staff account could otherwise read everyone's).
    .eq('customer_id', (await supabase.auth.getSession()).data.session?.user.id ?? '')
    .eq('is_active', true)
    .eq('in_service_area', true)
    .order('is_default', { ascending: false })
    .order('last_used_at', { ascending: false, nullsFirst: false })
    .limit(5)
  if (error) throw error
  return ((data ?? []) as unknown as (MyAddress & { neighborhood: { name_ar: string } | null })[]).map((a) => ({
    ...a,
    neighborhood_name: a.neighborhood_name ?? a.neighborhood?.name_ar ?? null,
  }))
}

export interface ServiceInput {
  kind: ServiceKind
  deviceId: string | null
  date: string
  period: ServicePeriod
  faultType: string | null
  description: string
  photoPath: string | null
  contactName: string
  addressId: string | null
  pin: { lat: number; lng: number; neighborhood: string; street: string } | null
  /** «جهاز ثاني»: a device not saved yet (any company). */
  newDevice: { kind: DeviceKind; brand: string } | null
}

export async function requestService(input: ServiceInput): Promise<{ id: string; request_number: string }> {
  const { data, error } = await supabase.rpc('request_service', {
    p_kind: input.kind,
    p_device_id: input.deviceId,
    p_address_id: input.addressId,
    p_preferred_date: input.date,
    p_preferred_period: input.period,
    p_fault_type: input.faultType,
    p_description: input.description.trim() || null,
    p_photo_path: input.photoPath,
    p_contact_name: input.contactName.trim() || null,
    p_lat: input.pin?.lat ?? null,
    p_lng: input.pin?.lng ?? null,
    p_neighborhood_name: input.pin?.neighborhood ?? null,
    p_street: input.pin?.street ?? null,
    p_device_kind: input.newDevice?.kind ?? null,
    p_brand: input.newDevice?.brand.trim() || null,
  })
  if (error) throw new Error(error.message)
  return data as { id: string; request_number: string }
}

export async function cancelMyRequest(id: string): Promise<void> {
  const { error } = await supabase.rpc('request_cancel_mine', { p_request_id: id })
  if (error) throw new Error(error.message)
}

export async function snoozeMyDevice(id: string, until: string): Promise<void> {
  const { error } = await supabase.rpc('device_snooze_mine', { p_device_id: id, p_until: until })
  if (error) throw new Error(error.message)
}

/** Uploads the fault photo under the customer's own folder; returns its path. */
export async function uploadServicePhoto(userId: string, file: File): Promise<string> {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('service-photos').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw new Error('invalid_photo')
  return path
}

/** YYYY-MM-DD for today + n days, Saudi time. */
export function riyadhDate(addDays = 0, now = Date.now()): string {
  const r = new Date(now + 3 * 3600 * 1000)
  return new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth(), r.getUTCDate()) + addDays * 86400000).toISOString().slice(0, 10)
}

export async function addMyDevice(input: { kind: DeviceKind; brand: string; stages: number | null; startedOn: string | null }): Promise<string> {
  const { data, error } = await supabase.rpc('device_add_mine', {
    p_kind: input.kind,
    p_brand: input.brand.trim() || null,
    p_stages: input.stages,
    p_started_on: input.startedOn,
  })
  if (error) throw new Error(error.message)
  return data as string
}

export async function removeMyDevice(id: string): Promise<void> {
  const { error } = await supabase.rpc('device_remove_mine', { p_device_id: id })
  if (error) throw new Error(error.message)
}

/** Work orders (quotes) for the customer's requests. */
export async function fetchMyWorkOrders(requestIds: string[]): Promise<WorkOrder[]> {
  if (!requestIds.length) return []
  const { data, error } = await supabase
    .from('work_orders')
    .select('*, parts:work_order_parts(*)')
    .in('request_id', requestIds)
    .neq('status', 'cancelled')
  if (error) throw error
  return (data ?? []) as WorkOrder[]
}

export async function decideMyQuote(workOrderId: string, decision: 'approved' | 'rejected'): Promise<void> {
  const { error } = await supabase.rpc('wo_decide_mine', { p_work_order_id: workOrderId, p_decision: decision })
  if (error) throw new Error(error.message)
}

/** Asks the server to check a Moyasar payment for a work order. */
export async function verifyServicePayment(workOrderId: string, paymentId: string): Promise<{ status: string; message?: string | null; error?: string }> {
  const { data, error } = await supabase.functions.invoke('moyasar-verify', { body: { work_order_id: workOrderId, payment_id: paymentId } })
  if (error) return { status: 'pending', error: 'request_failed' }
  return data as { status: string; message?: string | null }
}
