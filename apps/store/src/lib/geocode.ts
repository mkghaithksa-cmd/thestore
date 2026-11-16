/**
 * Address from the map pin (OpenStreetMap's Nominatim, the same map the store shows).
 * Only the pin's coordinates are sent; the customer can correct anything it returns.
 * Nominatim allows light use only (one lookup per pin here, cached).
 */
export interface PinAddress {
  neighborhood: string | null
  street: string | null
  city: string | null
}

const cache = new Map<string, Promise<PinAddress | null>>()

function clean(v: unknown): string | null {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
  return s || null
}

export function addressFromPin(lat: number, lng: number): Promise<PinAddress | null> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
  let p = cache.get(key)
  if (!p) {
    p = lookup(lat, lng)
    cache.set(key, p)
    p.then((r) => r || cache.delete(key))
  }
  return p
}

async function lookup(lat: number, lng: number): Promise<PinAddress | null> {
  const url = new URL('https://nominatim.openstreetmap.org/reverse')
  url.search = new URLSearchParams({
    format: 'jsonv2',
    lat: lat.toFixed(6),
    lon: lng.toFixed(6),
    zoom: '18',
    addressdetails: '1',
    'accept-language': 'ar',
  }).toString()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    const a = ((await res.json()) as { address?: Record<string, string> }).address
    if (!a) return null
    const road = clean(a.road ?? a.pedestrian ?? a.residential)
    const house = clean(a.house_number)
    return {
      neighborhood: clean(a.neighbourhood ?? a.quarter ?? a.suburb ?? a.city_district),
      street: road ? (house ? `${road}، ${house}` : road) : null,
      city: clean((a.city ?? a.town ?? a.village ?? a.county ?? '').replace(/^محافظة\s+/, '')),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
