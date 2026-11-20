import { lazy, Suspense } from 'react'

const MiniMap = lazy(() => import('./MiniMap'))

/**
 * "Your order goes here": shown right before the customer confirms an order
 * or a visit, with the pin on a small map and a way to change it.
 */
export function AddressConfirm({
  heading,
  title,
  lines,
  lat,
  lng,
  onChange,
}: {
  heading: string
  title: string
  lines: (string | null | undefined)[]
  lat: number
  lng: number
  onChange?: () => void
}) {
  const text = lines.filter(Boolean)
  return (
    <div className="addr-confirm" role="group" aria-label={heading}>
      <Suspense fallback={<div className="mini-map" aria-hidden="true" />}>
        <MiniMap lat={lat} lng={lng} />
      </Suspense>
      <div className="addr-confirm-body">
        <small>{heading}</small>
        <b>{title}</b>
        {text.map((t) => (
          <span key={t} className="muted">
            {t}
          </span>
        ))}
        {onChange && (
          <button type="button" className="linkbtn" onClick={onChange}>
            تغيير العنوان
          </button>
        )}
      </div>
    </div>
  )
}
