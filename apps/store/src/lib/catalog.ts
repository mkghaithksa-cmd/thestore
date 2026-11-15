import type { Category, Product, StoreSettings } from '@ghaith/shared'
import { VAT_RATE } from '@ghaith/shared'
import { isSupabaseConfigured, supabase } from './supabase'

export type ProductWithCategory = Product & { category: Pick<Category, 'name_ar' | 'slug'> | null }

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
    .select('*, category:categories(name_ar, slug)')
    .eq('status', 'published')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ProductWithCategory[]
}

export async function fetchCategories(): Promise<Category[]> {
  assertConfigured()
  const { data, error } = await supabase.from('categories').select('*').order('sort_order')
  if (error) throw error
  return (data ?? []) as Category[]
}

const FALLBACK_SETTINGS: StoreSettings = {
  id: 1,
  vat_rate: VAT_RATE,
  install_fee: 150,
  inspection_fee: 60,
  shipping_fee: 35,
  updated_at: '',
}

export async function fetchSettings(): Promise<StoreSettings> {
  assertConfigured()
  const { data, error } = await supabase.from('settings').select('*').eq('id', 1).maybeSingle()
  if (error) throw error
  return (data as StoreSettings | null) ?? FALLBACK_SETTINGS
}

export const formatSar = (n: number) =>
  `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ر.س`
