import type { ProductWithCategory } from './catalog'

/**
 * Loose Arabic matching: no diacritics or tatweel, and the common spelling
 * variants are treated alike (أ/إ/آ → ا, ة → ه, ى → ي, Arabic digits → Latin).
 */
export function normalizeArabic(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, ' ')
    .trim()
}

function haystack(p: ProductWithCategory): string {
  return normalizeArabic(
    [
      p.name_ar,
      p.name_en,
      p.sku,
      p.model,
      p.description_ar,
      p.category?.name_ar,
      p.manufacturer?.name,
      ...(p.specs ?? []),
      ...(p.compat ?? []).map((c) => c.device_model),
    ]
      .filter(Boolean)
      .join(' '),
  )
}

/** Every word of the query must appear somewhere in the product. */
export function matchesQuery(p: ProductWithCategory, query: string): boolean {
  const words = normalizeArabic(query).split(' ').filter(Boolean)
  if (!words.length) return true
  const text = haystack(p)
  return words.every((w) => text.includes(w))
}

export const SORTS = {
  featured: 'المميز أولاً',
  'price-asc': 'السعر: الأقل أولاً',
  'price-desc': 'السعر: الأعلى أولاً',
  newest: 'الأحدث',
} as const

export type SortKey = keyof typeof SORTS

export function isSortKey(v: string | null): v is SortKey {
  return v !== null && v in SORTS
}

/** 2 = name has every word, 1 = found elsewhere (specs, description…). */
function relevance(p: ProductWithCategory, query: string): number {
  const words = normalizeArabic(query).split(' ').filter(Boolean)
  const name = normalizeArabic(`${p.name_ar} ${p.name_en ?? ''} ${p.sku} ${p.model ?? ''}`)
  return words.every((w) => name.includes(w)) ? 2 : 1
}

export function sortProducts(list: ProductWithCategory[], sort: SortKey, query = ''): ProductWithCategory[] {
  const out = [...list]
  if (sort === 'featured' && query.trim()) {
    // While searching, products whose name matches come first.
    return out.sort((a, b) => relevance(b, query) - relevance(a, query) || Number(b.is_featured) - Number(a.is_featured))
  }
  switch (sort) {
    case 'price-asc':
      return out.sort((a, b) => a.price_before_vat - b.price_before_vat)
    case 'price-desc':
      return out.sort((a, b) => b.price_before_vat - a.price_before_vat)
    case 'newest':
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at))
    default:
      // Featured first, then the catalog's own order.
      return out.sort((a, b) => Number(b.is_featured) - Number(a.is_featured))
  }
}
