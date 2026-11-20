import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { MECCA_CITY, nearestCity, OTHER_CITY, type ProductType, type Zone } from '@ghaith/shared'
import { addressTitle, fetchMyAddresses, saveAddress, type SavedAddress } from './addresses'
import { useAuth } from './auth'
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
  /** Set when the pin is one of the customer's saved addresses («عناويني»). */
  addressId?: string
  /** "البيت – العزيزية" */
  title?: string
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

/** A saved address as the current location (no network call: the server already knows its zone). */
export function fromSaved(a: SavedAddress): StoreLocation {
  const near = nearestCity(a.lat, a.lng)
  return {
    zone: a.in_service_area ? 'mecca' : 'outside',
    city: a.in_service_area ? MECCA_CITY : near && near !== MECCA_CITY ? near : OTHER_CITY,
    source: 'pin',
    lat: a.lat,
    lng: a.lng,
    at: new Date().toISOString(),
    addressId: a.id,
    title: addressTitle(a),
  }
}

interface LocationState {
  location: StoreLocation | null
  /** The signed-in customer's saved addresses (empty for visitors). */
  addresses: SavedAddress[]
  /** Customer id when a customer is signed in. */
  customerId: string | null
  reloadAddresses: () => Promise<SavedAddress[]>
  /** A visitor's pin that a newly signed-in customer may keep as an address. */
  offerSave: boolean
  dismissOffer: () => void
  /** Saves the current pin into «عناويني» with this name. */
  saveCurrent: (label: string | null) => Promise<void>
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
  const { session, loading: authLoading } = useAuth()
  const [location, setLocation] = useState<StoreLocation | null>(read)
  const [addresses, setAddresses] = useState<SavedAddress[]>([])
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [offerDismissed, setOfferDismissed] = useState(false)
  const uid = session?.user.id ?? null
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

  const reloadAddresses = useCallback(async () => {
    if (!uid) return []
    const list = await fetchMyAddresses(uid).catch(() => [] as SavedAddress[])
    setAddresses(list)
    return list
  }, [uid])

  // Signed in: is this a customer, and what did they save?
  useEffect(() => {
    let live = true
    if (!uid) {
      setCustomerId(null)
      setAddresses([])
      // Signed out: an address that came from the account leaves this browser.
      if (!authLoading)
        setLocation((cur) => {
          if (!cur?.addressId) return cur
          write(null)
          return null
        })
      return
    }
    supabase
      .from('customers')
      .select('id')
      .eq('id', uid)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!live || !data) return
        setCustomerId(uid)
        const list = await fetchMyAddresses(uid).catch(() => [] as SavedAddress[])
        if (!live) return
        setAddresses(list)
        setLocation((cur) => {
          // No pin in this browser: use the main address from the account.
          if (!cur) {
            const main = list.find((a) => a.is_default) ?? list[0]
            if (!main) return cur
            const next = fromSaved(main)
            write(next)
            return next
          }
          // The pin is (near) a saved address: show its name.
          const same = list.find((a) => Math.abs(a.lat - cur.lat) < 0.0005 && Math.abs(a.lng - cur.lng) < 0.0005)
          if (same && cur.addressId !== same.id) {
            const next = fromSaved(same)
            write(next)
            return next
          }
          return cur
        })
      })
    return () => {
      live = false
    }
  }, [uid, authLoading])

  const saveCurrent = useCallback(
    async (label: string | null) => {
      if (!location) return
      const id = await saveAddress({ label, lat: location.lat, lng: location.lng })
      const list = await reloadAddresses()
      const saved = list.find((a) => a.id === id)
      if (saved) set(fromSaved(saved))
    },
    [location, reloadAddresses, set],
  )

  const value = useMemo<LocationState>(
    () => ({
      location,
      addresses,
      customerId,
      reloadAddresses,
      offerSave: !!customerId && !!location && !location.addressId && addresses.length === 0 && !offerDismissed,
      dismissOffer: () => setOfferDismissed(true),
      saveCurrent,
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
    [location, addresses, customerId, reloadAddresses, offerDismissed, saveCurrent, set, promptDismissed, dialogOpen],
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
