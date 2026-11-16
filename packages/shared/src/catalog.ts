import type { ProductType } from './index'

/** Row shapes for the catalog tables (see supabase/migrations). */
export interface Category {
  id: string
  name_ar: string
  slug: string
  parent_id: string | null
  sort_order: number
  is_visible: boolean
  created_at: string
}

export interface Manufacturer {
  id: string
  name: string
  country: string | null
  is_active: boolean
  created_at: string
}

export type ProductStatus = 'draft' | 'published'

export interface Product {
  id: string
  sku: string
  name_ar: string
  name_en: string | null
  description_ar: string | null
  type: ProductType
  category_id: string
  manufacturer_id: string | null
  model: string | null
  /** Postgres numeric — returned as a number by PostgREST. */
  price_before_vat: number
  image_url: string | null
  specs: string[]
  status: ProductStatus
  is_featured: boolean
  tracks_stock: boolean
  reorder_level: number
  unit: string
  warranty_months: number
  installable_in_mecca: boolean
  created_at: string
  updated_at: string
}

export interface ProductImage {
  id: string
  product_id: string
  storage_path: string
  alt_ar: string | null
  sort_order: number
}

export interface FilterCompatibility {
  id: string
  filter_product_id: string
  device_model: string
  stage_number: number | null
  lifetime_months: number
}

export interface BundleItem {
  bundle_product_id: string
  component_product_id: string
  qty: number
}

export interface StoreSettings {
  id: number
  vat_rate: number
  install_fee: number
  inspection_fee: number
  shipping_fee: number
  charge_inspection_if_absent: boolean
  maintenance_alert_days: number
  technician_link_hours: number
  updated_at: string
}

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  device: 'جهاز',
  filter: 'فلتر',
  part: 'قطعة غيار',
  service: 'خدمة',
  bundle: 'باقة',
}

/** Which form sections each product type asks for. */
export const PRODUCT_TYPE_FIELDS: Record<
  ProductType,
  { model: boolean; warranty: boolean; installable: boolean; stock: boolean; compatibility: boolean; components: boolean }
> = {
  device: { model: true, warranty: true, installable: true, stock: true, compatibility: false, components: false },
  filter: { model: false, warranty: false, installable: false, stock: true, compatibility: true, components: false },
  part: { model: true, warranty: true, installable: false, stock: true, compatibility: false, components: false },
  service: { model: false, warranty: false, installable: false, stock: false, compatibility: false, components: false },
  bundle: { model: false, warranty: true, installable: true, stock: false, compatibility: false, components: true },
}

export const MAX_PRODUCT_IMAGES = 5
export const PRODUCT_IMAGES_BUCKET = 'product-images'

/** Price including VAT, rounded to halalas. */
export function priceWithVat(priceBeforeVat: number, vatRate: number): number {
  return Math.round(Number(priceBeforeVat) * (1 + Number(vatRate)) * 100) / 100
}

/** Public URL of a file in a public Supabase Storage bucket. */
export function publicStorageUrl(supabaseUrl: string, bucket: string, path: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${path}`
}
