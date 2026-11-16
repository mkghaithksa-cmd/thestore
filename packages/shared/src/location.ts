/**
 * Where the customer is, as far as the store needs to know:
 * inside Mecca (installation and maintenance available) or another city
 * (shipping only). The exact pin and address come later at checkout.
 */
export type Zone = 'mecca' | 'outside'

export interface SaudiCity {
  name: string
  lat: number
  lng: number
}

export const MECCA_CITY = 'مكة المكرمة'

/** Main Saudi cities, used for the manual choice and to name a detected location. */
export const SAUDI_CITIES: SaudiCity[] = [
  { name: MECCA_CITY, lat: 21.4225, lng: 39.8262 },
  { name: 'جدة', lat: 21.5433, lng: 39.1728 },
  { name: 'الطائف', lat: 21.2703, lng: 40.4158 },
  { name: 'المدينة المنورة', lat: 24.4686, lng: 39.6142 },
  { name: 'الرياض', lat: 24.7136, lng: 46.6753 },
  { name: 'الدمام', lat: 26.4207, lng: 50.0888 },
  { name: 'الخبر', lat: 26.2172, lng: 50.1971 },
  { name: 'الظهران', lat: 26.2361, lng: 50.0393 },
  { name: 'الأحساء', lat: 25.3833, lng: 49.5861 },
  { name: 'الجبيل', lat: 27.0046, lng: 49.646 },
  { name: 'القصيم (بريدة)', lat: 26.3592, lng: 43.9818 },
  { name: 'عنيزة', lat: 26.0843, lng: 43.9935 },
  { name: 'حائل', lat: 27.5114, lng: 41.7208 },
  { name: 'تبوك', lat: 28.3835, lng: 36.5662 },
  { name: 'ينبع', lat: 24.0895, lng: 38.0618 },
  { name: 'رابغ', lat: 22.7986, lng: 39.0349 },
  { name: 'الليث', lat: 20.1497, lng: 40.2776 },
  { name: 'القنفذة', lat: 19.1264, lng: 41.0789 },
  { name: 'الباحة', lat: 20.0129, lng: 41.4677 },
  { name: 'أبها', lat: 18.2164, lng: 42.5053 },
  { name: 'خميس مشيط', lat: 18.3, lng: 42.7333 },
  { name: 'جازان', lat: 16.8892, lng: 42.5511 },
  { name: 'نجران', lat: 17.4917, lng: 44.1322 },
  { name: 'بيشة', lat: 20.0005, lng: 42.6052 },
  { name: 'الجوف (سكاكا)', lat: 29.9697, lng: 40.2064 },
  { name: 'عرعر', lat: 30.9753, lng: 41.0381 },
  { name: 'حفر الباطن', lat: 28.4342, lng: 45.9636 },
]

export const OTHER_CITY = 'مدينة أخرى'

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180
  const dLat = (bLat - aLat) * rad
  const dLng = (bLng - aLng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

/** Nearest listed city within 60 km, or null when the point is far from all of them. */
export function nearestCity(lat: number, lng: number): string | null {
  let best: { name: string; d: number } | null = null
  for (const c of SAUDI_CITIES) {
    const d = distanceKm(lat, lng, c.lat, c.lng)
    if (!best || d < best.d) best = { name: c.name, d }
  }
  return best && best.d <= 60 ? best.name : null
}
