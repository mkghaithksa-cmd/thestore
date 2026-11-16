import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { MECCA_CITY, nearestCity, OTHER_CITY, type ProductType, type Zone } from '@ghaith/shared'
import { supabase } from './supabase'

/**
 * The customer's location, kept in this browser only. The customer places a
 * pin on their house; the server decides if it is inside the Mecca service
 * area. Inside: delivery, installation and maintenance. Outside: shipping only.
 */
export interface StoreLocation {
  zone: Zone
  city: string
  /** Always the map pin: the customer places it on their house. */
  source: 'pin'
  lat: number
  lng: number
  at: string
}

const STORAGE_KEY = 'ghaith-location-v1'
const DISMISS_KEY = 'ghaith-location-prompt-dismissed'

function read(): StoreLocation | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    // Older choices (auto-detect, or a picked city with no pin) are dropped: the customer pins the house again.
    if (
      v &&
      v.source === 'pin' &&
      (v.zone === 'mecca' || v.zone === 'outside') &&
      typeof v.city === 'string' &&
      typeof v.lat === 'number' &&
      typeof v.lng === 'number'
    )
      return v as StoreLocation
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

export const CHECK_FAILED = 'تعذّر التحقق من منطقة الخدمة. تأكد من الاتصال وحاول مرة ثانية.'

/** The customer placed the pin on their house: the server decides if it is inside the service area. */
export async function pinnedLocation(rawLat: number, rawLng: number): Promise<StoreLocation> {
  const lat = Math.round(rawLat * 100000) / 100000
  const lng = Math.round(rawLng * 100000) / 100000
  const { data, error } = await supabase.rpc('is_in_service_area', { lat, lng })
  if (error || typeof data !== 'boolean') throw new Error('check-failed')
  const near = nearestCity(lat, lng)
  return {
    zone: data ? 'mecca' : 'outside',
    city: data ? MECCA_CITY : near && near !== MECCA_CITY ? near : OTHER_CITY,
    source: 'pin',
    lat,
    lng,
    at: new Date().toISOString(),
  }
}

interface LocationState {
  location: StoreLocation | null
  /** Unknown counts as Mecca (the default shop) until the customer pins the house. */
  inMecca: boolean
  set: (loc: StoreLocation) => void
  clear: () => void
  promptDismissed: boolean
  dismissPrompt: () => void
  dialogOpen: boolean
  openDialog: () => void
  closeDialog: () => void
}

const LocationContext = createContext<LocationState | null>(null)

export function LocationProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<StoreLocation | null>(read)
  const [dialogOpen, setDialogOpen] = useState(false)
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
      openDialog: () => setDialogOpen(true),
      closeDialog: () => setDialogOpen(false),
    }),
    [location, set, promptDismissed, dialogOpen],
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
