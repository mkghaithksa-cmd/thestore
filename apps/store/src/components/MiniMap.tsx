import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

/** A small still map with the pin, for "your order goes here" confirmations. */
export default function MiniMap({ lat, lng }: { lat: number; lng: number }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!box.current) return
    const m = L.map(box.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      boxZoom: false,
      keyboard: false,
    }).setView([lat, lng], 16)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(m)
    m.attributionControl.setPrefix(false)
    L.marker([lat, lng], {
      icon: L.divIcon({ className: 'mini-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 22] }),
      interactive: false,
      keyboard: false,
    }).addTo(m)
    const t = setTimeout(() => m.invalidateSize(), 100)
    return () => {
      clearTimeout(t)
      m.remove()
    }
  }, [lat, lng])
  return <div ref={box} className="mini-map" aria-hidden="true" />
}
