import { PRODUCT_IMAGES_BUCKET, publicStorageUrl, type Category, type HomeBanner, type Product, type ProductImage, type StoreSettings } from '@ghaith/shared'
import { isSupabaseConfigured, supabase } from './supabase'

export type ProductWithCategory = Product & {
  category: Pick<Category, 'name_ar' | 'slug'> | null
  images: Pick<ProductImage, 'storage_path' | 'sort_order'>[]
  /** Bundle contents; a component is null when it is not published. */
  components: { qty: number; product: Pick<Product, 'id' | 'name_ar' | 'price_before_vat' | 'sku'> | null }[]
  manufacturer: { name: string } | null
  compat: { device_model: string; stage_number: number | null; lifetime_months: number }[]
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''

/** Public URLs of all the product's images, main image first. */
export function imageUrls(p: ProductWithCategory): string[] {
  const urls = [...(p.images ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => publicStorageUrl(SUPABASE_URL, PRODUCT_IMAGES_BUCKET, i.storage_path))
  return urls.length ? urls : p.image_url ? [p.image_url] : []
}

/** URL of the product's main (first) image, if any. */
export function mainImageUrl(p: ProductWithCategory): string | null {
  const first = [...(p.images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]
  return first ? publicStorageUrl(SUPABASE_URL, PRODUCT_IMAGES_BUCKET, first.storage_path) : p.image_url
}

function assertConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error('لم يتم ضبط الاتصال بقاعدة البيانات (ملف .env.local).')
  }
}

/** Published products in visible categories (RLS enforces this too). */
export async function fetchProducts(): Promise<ProductWithCategory[]> {
  assertConfigured()
  const { data, error } = await supabase
    .from('products')
    .select('*, category:categories(name_ar, slug), images:product_images(storage_path, sort_order), ' +
        'components:bundle_items!bundle_items_bundle_product_id_fkey(qty, product:products!bundle_items_component_product_id_fkey(id, sku, name_ar, price_before_vat)), ' +
        'manufacturer:manufacturers(name), compat:filter_compatibility(device_model, stage_number, lifetime_months)')
    .eq('status', 'published')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as ProductWithCategory[]
}

/** What the bundle's components cost bought one by one (before VAT); null if any is unavailable. */
export function bundleComponentsTotal(p: ProductWithCategory): number | null {
  if (p.type !== 'bundle' || !p.components?.length) return null
  if (p.components.some((c) => !c.product)) return null
  return p.components.reduce((sum, c) => sum + Number(c.product!.price_before_vat) * c.qty, 0)
}

export async function fetchCategories(): Promise<Category[]> {
  assertConfigured()
  const { data, error } = await supabase.from('categories').select('*').order('sort_order')
  if (error) throw error
  return (data ?? []) as Category[]
}

export async function fetchSettings(): Promise<StoreSettings> {
  assertConfigured()
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle()
  if (error) throw error
  // VAT and fees come only from the settings table — never from code.
  if (!data) throw new Error('لم يتم العثور على إعدادات المتجر.')
  return data as StoreSettings
}

export const formatSar = (n: number) =>
  `${n.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ر.س`

/** Banners that are live now (RLS hides inactive and out-of-date ones). */
export async function fetchBanners(): Promise<HomeBanner[]> {
  assertConfigured()
  const { data, error } = await supabase.from('home_banners').select('*').order('sort_order')
  if (error) throw error
  return (data ?? []) as HomeBanner[]
}
