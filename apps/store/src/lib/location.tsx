import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { MECCA_CITY, nearestCity, OTHER_CITY, type ProductType, type Zone } from '@ghaith/shared'
import { supabase } from './supabase'

/**
 * The customer's location, kept in this browser only. It decides what the
 * store shows: inside Mecca installation and services are offered, anywhere
 * else the store ships only. The checkout asks for the full address and pin.
 */
export interface StoreLocation {
  zone: Zone
  city: string
  source: 'gps' | 'manual' | 'pin'
  /** From the map pin (about 1 m) or auto-detect (about 100 m); kept in this browser to prefill the checkout. */
  lat?: number
  lng?: number
  at: string
}

const STORAGE_KEY = 'ghaith-location-v1'
const DISMISS_KEY = 'ghaith-location-prompt-dismissed'

function read(): StoreLocation | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (v && (v.zone === 'mecca' || v.zone === 'outside') && typeof v.city === 'string') return v as StoreLocation
  } catch {
    // ignore
  }
  return null
}

function write(loc: StoreLocation | null) {
  try {
    if (loc) localStorage.setItem(STORAGE_KEY, JSON.stringify(loc))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode: the choice still holds for this visit.
  }
}

export type DetectError = 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'check-failed'

export const DETECT_ERRORS: Record<DetectError, string> = {
  unsupported: 'متصفحك لا يدعم تحديد الموقع. اختر يدوياً.',
  denied: 'لم تسمح بالوصول لموقعك. تقدر تسمح من إعدادات المتصفح، أو تختار يدوياً.',
  unavailable: 'تعذّر تحديد موقعك الآن. اختر يدوياً.',
  timeout: 'أخذ تحديد الموقع وقتاً طويلاً. حاول مرة ثانية أو اختر يدوياً.',
  'check-failed': 'تعذّر التحقق من منطقة الخدمة. حاول مرة ثانية أو اختر يدوياً.',
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject('unsupported' satisfies DetectError)
    navigator.geolocation.getCurrentPosition(resolve, (e) => {
      reject((e.code === e.PERMISSION_DENIED ? 'denied' : e.code === e.TIMEOUT ? 'timeout' : 'unavailable') satisfies DetectError)
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60 * 1000 })
  })
}

/** Ask the browser for the position, then let the server decide if it is in the service area. */
export async function detectLocation(): Promise<StoreLocation> {
  const pos = await getPosition()
  return checkPoint(pos.coords.latitude, pos.coords.longitude, 'gps')
}

/** The customer placed the pin on their house: same server check, finer precision. */
export function pinnedLocation(lat: number, lng: number): Promise<StoreLocation> {
  return checkPoint(lat, lng, 'pin')
}

async function checkPoint(rawLat: number, rawLng: number, source: 'gps' | 'pin'): Promise<StoreLocation> {
  const f = source === 'pin' ? 100000 : 1000
  const lat = Math.round(rawLat * f) / f
  const lng = Math.round(rawLng * f) / f
  const { data, error } = await supabase.rpc('is_in_service_area', { lat, lng })
  if (error || typeof data !== 'boolean') throw 'check-failed' satisfies DetectError
  const near = nearestCity(lat, lng)
  return {
    zone: data ? 'mecca' : 'outside',
    city: data ? MECCA_CITY : near && near !== MECCA_CITY ? near : OTHER_CITY,
    source,
    lat,
    lng,
    at: new Date().toISOString(),
  }
}

export function manualLocation(city: string): StoreLocation {
  return { zone: city === MECCA_CITY ? 'mecca' : 'outside', city, source: 'manual', at: new Date().toISOString() }
}

interface LocationState {
  location: StoreLocation | null
  /** Unknown counts as Mecca (the default shop), the checkout confirms it. */
  inMecca: boolean
  set: (loc: StoreLocation) => void
  clear: () => void
  promptDismissed: boolean
  dismissPrompt: () => void
  dialogOpen: boolean
  /** Which screen the chooser opens on: the map pin, or the quick choice. */
  dialogView: DialogView
  openDialog: (view?: DialogView) => void
  closeDialog: () => void
}

export type DialogView = 'map' | 'choose'

const LocationContext = createContext<LocationState | null>(null)

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<StoreLocation | null>(read)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogView, setDialogView] = useState<DialogView>('choose')
  const [promptDismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setLocation(read())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const set = useCallback((loc: StoreLocation) => {
    write(loc)
    setLocation(loc)
  }, [])

  const value = useMemo<LocationState>(
    () => ({
      location,
      inMecca: location?.zone !== 'outside',
      set,
      clear: () => {
        write(null)
        setLocation(null)
      },
      promptDismissed,
      dismissPrompt: () => {
        setDismissed(true)
        try {
          sessionStorage.setItem(DISMISS_KEY, '1')
        } catch {
          // ignore
        }
      },
      dialogOpen,
      dialogView,
      openDialog: (view = 'choose') => {
        setDialogView(view)
        setDialogOpen(true)
      },
      closeDialog: () => setDialogOpen(false),
    }),
    [location, set, promptDismissed, dialogOpen, dialogView],
  )

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>
}

export function useLocationChoice(): LocationState {
  const ctx = useContext(LocationContext)
  if (!ctx) throw new Error('useLocationChoice must be used inside LocationProvider')
  return ctx
}

/** Services (installation, maintenance visits) are offered in Mecca only. */
export function availableHere(type: ProductType, inMecca: boolean): boolean {
  return inMecca || type !== 'service'
}
