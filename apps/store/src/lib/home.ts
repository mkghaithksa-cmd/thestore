import { BANNERS_BUCKET, PUBLIC_REVIEW_COLUMNS, publicStorageUrl, type HomeSection, type Review } from '@ghaith/shared'
import { supabase } from './supabase'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''

/** Public URL of a home image (banners bucket). */
export const homeImageUrl = (path: string) => publicStorageUrl(SUPABASE_URL, BANNERS_BUCKET, path)

export async function fetchHomeSections(): Promise<HomeSection[]> {
  const { data, error } = await supabase.from('home_sections').select('*').order('sort_order')
  if (error) throw error
  return (data ?? []) as HomeSection[]
}

/** Approved reviews the admin featured for the home page. */
export async function fetchFeaturedReviews(): Promise<Review[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select(PUBLIC_REVIEW_COLUMNS)
    .eq('status', 'approved')
    .eq('is_featured', true)
    .order('created_at', { ascending: false })
    .limit(9)
  if (error) throw error
  return (data ?? []) as Review[]
}

/** Approved reviews of one product, newest first. */
export async function fetchProductReviews(productId: string): Promise<Review[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select(PUBLIC_REVIEW_COLUMNS)
    .eq('status', 'approved')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as Review[]
}

/** Average stars (one decimal) and count. */
export function ratingSummary(reviews: Pick<Review, 'rating'>[]): { avg: number; count: number } | null {
  if (!reviews.length) return null
  const avg = reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
  return { avg: Math.round(avg * 10) / 10, count: reviews.length }
}
