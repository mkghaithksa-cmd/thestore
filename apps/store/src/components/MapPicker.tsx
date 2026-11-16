import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

/** Al-Haram, the default view when we know nothing about the customer. */
const MECCA = { lat: 21.4225, lng: 39.8262 }

export interface MapPickerProps {
  initial?: { lat: number; lng: number } | null
  busy?: boolean
  onConfirm: (lat: number, lng: number) => void
  onCancel: () => void
}

/**
 * Full map with a fixed pin in the middle: the customer moves the map until
 * the pin sits on their house. Loaded only when opened (OpenStreetMap tiles).
 */
export default function MapPicker({ initial, busy, onConfirm, onCancel }: MapPickerProps) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState('')

  useEffect(() => {
    if (!box.current) return
    const start = initial ?? MECCA
    const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([start.lat, start.lng], initial ? 17 : 12)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m)
    m.attributionControl.setPrefix(false)
    map.current = m
    // The dialog may still be sizing itself when the map is created.
    const t = setTimeout(() => m.invalidateSize(), 150)
    return () => {
      clearTimeout(t)
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const myLocation = () => {
    if (!('geolocation' in navigator)) {
      setGeoError('متصفحك لا يدعم تحديد الموقع.')
      return
    }
    setLocating(true)
    setGeoError('')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false)
        map.current?.flyTo([p.coords.latitude, p.coords.longitude], 18, { duration: 0.8 })
      },
      (e) => {
        setLocating(false)
        setGeoError(e.code === e.PERMISSION_DENIED ? 'لم تسمح بالوصول لموقعك. حرّك الخريطة يدوياً.' : 'تعذّر تحديد موقعك. حرّك الخريطة يدوياً.')
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    )
  }

  const confirm = () => {
    const c = map.current?.getCenter()
    if (c) onConfirm(c.lat, c.lng)
  }

  return (
    <div className="map-picker">
      <p className="muted">حرّك الخريطة حتى يكون الدبوس فوق بيتك بالضبط، وكبّر للتأكد.</p>
      <div className="map-box">
        <div ref={box} className="map-canvas" />
        <div className="map-pin" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 22s-7.5-6.6-7.5-12.2a7.5 7.5 0 0 1 15 0C19.5 15.4 12 22 12 22z" />
            <circle cx="12" cy="9.8" r="2.8" />
          </svg>
        </div>
        <button type="button" className="map-me" onClick={myLocation} disabled={locating}>
          {locating ? 'جاري التحديد…' : 'موقعي الحالي'}
        </button>
      </div>
      {geoError && (
        <p className="loc-error" role="alert">
          {geoError}
        </p>
      )}
      <div className="row map-actions">
        <button type="button" className="btn" onClick={confirm} disabled={busy}>
          {busy ? 'جاري التحقق…' : 'تأكيد الموقع'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          رجوع
        </button>
      </div>
    </div>
  )
}
