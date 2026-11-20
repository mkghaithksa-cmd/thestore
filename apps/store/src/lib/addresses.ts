import { supabase } from './supabase'

/** One entry of «عناويني». */
export interface SavedAddress {
  id: string
  label: string | null
  neighborhood_name: string | null
  street: string | null
  building_note: string | null
  lat: number
  lng: number
  in_service_area: boolean
  is_default: boolean
}

export const MAX_ADDRESSES = 5
export const LABEL_CHOICES = ['البيت', 'بيت الأهل', 'الاستراحة', 'العمل']

/** Only this customer’s own rows (a staff account could otherwise read everyone’s). */
export async function fetchMyAddresses(customerId: string): Promise<SavedAddress[]> {
  const { data, error } = await supabase
    .from('addresses')
    .select('id, label, neighborhood_name, street, building_note, lat, lng, in_service_area, is_default, neighborhood:service_neighborhoods(name_ar)')
    .eq('customer_id', customerId)
    .eq('is_active', true)
    .not('lat', 'is', null)
    .order('is_default', { ascending: false })
    .order('last_used_at', { ascending: false, nullsFirst: false })
  if (error) throw error
  return ((data ?? []) as unknown as (SavedAddress & { neighborhood: { name_ar: string } | null })[]).map(({ neighborhood, ...a }) => ({
    ...a,
    neighborhood_name: a.neighborhood_name ?? neighborhood?.name_ar ?? null,
  }))
}

export interface AddressInput {
  id?: string | null
  label?: string | null
  lat: number
  lng: number
  neighborhood_name?: string | null
  street?: string | null
  building_note?: string | null
  makeDefault?: boolean
}

/** Adds or edits an address; a pin within 50 m of a saved one updates that one. Returns its id. */
export async function saveAddress(a: AddressInput): Promise<string> {
  const { data, error } = await supabase.rpc('address_save', {
    p_id: a.id ?? null,
    p_label: a.label ?? null,
    p_lat: a.lat,
    p_lng: a.lng,
    p_neighborhood_name: a.neighborhood_name ?? null,
    p_street: a.street ?? null,
    p_building_note: a.building_note ?? null,
    p_default: a.makeDefault ?? false,
  })
  if (error) throw error
  return data as string
}

export async function removeAddress(id: string): Promise<void> {
  const { error } = await supabase.rpc('address_remove', { p_id: id })
  if (error) throw error
}

export function addressErrorMessage(msg: string | null | undefined): string {
  if (msg?.includes('too_many_addresses')) return `وصلت للحد (${MAX_ADDRESSES} عناوين). احذف عنوان قديم من «عناويني» أولاً.`
  if (msg?.includes('too_long')) return 'النص طويل، اختصره شوي.'
  if (msg?.includes('pin_required')) return 'حدد المكان على الخريطة.'
  return 'تعذّر حفظ العنوان. حاول مرة ثانية.'
}

/** "البيت – العزيزية" */
export function addressTitle(a: Pick<SavedAddress, 'label' | 'neighborhood_name'>): string {
  return [a.label, a.neighborhood_name].filter(Boolean).join(' – ') || 'عنوان محفوظ'
}
