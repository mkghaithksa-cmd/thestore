import {
  PRODUCT_IMAGES_BUCKET,
  publicStorageUrl,
  type Category,
  type Manufacturer,
  type Product,
  type ProductImage,
  type StoreSettings,
} from '@ghaith/shared'
import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''

export const imageUrl = (path: string, bucket = PRODUCT_IMAGES_BUCKET) =>
  publicStorageUrl(SUPABASE_URL, bucket, path)

export type ProductRow = Product & { images: Pick<ProductImage, 'storage_path' | 'sort_order'>[] }

/** Throws the PostgREST error so callers can show it. */
function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

export async function fetchSettings(): Promise<StoreSettings> {
  const data = check(await supabase.from('settings').select('*').eq('id', 1).maybeSingle())
  if (!data) throw new Error('settings_missing')
  return data as StoreSettings
}

export async function fetchCategories(): Promise<Category[]> {
  return check(await supabase.from('categories').select('*').order('sort_order').order('name_ar')) as Category[]
}

export async function fetchManufacturers(): Promise<Manufacturer[]> {
  return check(await supabase.from('manufacturers').select('*').order('name')) as Manufacturer[]
}

export async function fetchProducts(): Promise<ProductRow[]> {
  return check(
    await supabase
      .from('products')
      .select('*, images:product_images(storage_path, sort_order)')
      .order('updated_at', { ascending: false }),
  ) as ProductRow[]
}

/** First image (lowest sort order) or the legacy image_url. */
export function mainImage(p: ProductRow): string | null {
  const first = [...(p.images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]
  return first ? imageUrl(first.storage_path) : p.image_url
}

/** "Parent › Child" labels for a two-level category list, sorted for a select. */
export function categoryOptions(categories: Category[]): { id: string; label: string }[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const out: { id: string; label: string }[] = []
  for (const top of categories.filter((c) => !c.parent_id)) {
    out.push({ id: top.id, label: top.name_ar })
    for (const child of categories.filter((c) => c.parent_id === top.id)) {
      out.push({ id: child.id, label: `${top.name_ar} › ${child.name_ar}` })
    }
  }
  // Orphans (parent hidden from this reader) still need to be selectable.
  for (const c of categories) if (c.parent_id && !byId.has(c.parent_id)) out.push({ id: c.id, label: c.name_ar })
  return out
}

/** Maps database error text to a short Arabic message. */
export function catalogError(message: string): string {
  if (message.includes('products_sku') || message.includes('duplicate key') && message.includes('sku'))
    return 'رمز SKU مستخدم لمنتج آخر.'
  if (message.includes('invalid_sku')) return 'أدخل رمز SKU.'
  if (message.includes('invalid_name')) return 'أدخل اسم المنتج.'
  if (message.includes('bundle_in_bundle')) return 'لا يمكن وضع باقة داخل باقة.'
  if (message.includes('not_a_bundle')) return 'المكونات تُضاف للباقات فقط.'
  if (message.includes('too_many_images')) return 'الحد الأقصى 5 صور لكل منتج.'
  if (message.includes('row-level security') || message.includes('permission denied'))
    return 'لا تملك صلاحية هذا الإجراء.'
  if (message.includes('not_image')) return 'الملف ليس صورة.'
  return 'تعذّر الحفظ. حاول مرة أخرى.'
}
