import type { ProductType } from './index'

/** Row shapes for the step-1 catalog tables (see supabase/migrations). */
export interface Category {
  id: string
  name_ar: string
  slug: string
  sort_order: number
  is_visible: boolean
  created_at: string
}

export type ProductStatus = 'draft' | 'published'

export interface Product {
  id: string
  sku: string
  name_ar: string
  description_ar: string | null
  type: ProductType
  category_id: string
  /** Postgres numeric — returned as a number by PostgREST. */
  price_before_vat: number
  image_url: string | null
  specs: string[]
  status: ProductStatus
  is_featured: boolean
  created_at: string
  updated_at: string
}

export interface StoreSettings {
  id: number
  vat_rate: number
  install_fee: number
  inspection_fee: number
  shipping_fee: number
  updated_at: string
}

export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  device: 'جهاز',
  filter: 'فلتر',
  part: 'قطعة غيار',
  service: 'خدمة',
  bundle: 'باقة',
}

/** Price including VAT, rounded to halalas. */
export function priceWithVat(priceBeforeVat: number, vatRate: number): number {
  return Math.round(Number(priceBeforeVat) * (1 + Number(vatRate)) * 100) / 100
}
