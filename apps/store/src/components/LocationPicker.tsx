import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { priceWithVat, type StoreSettings } from '@ghaith/shared'
import { fetchSettings, formatSar } from '../lib/catalog'
import { CHECK_FAILED, pinnedLocation, useLocationChoice, type StoreLocation } from '../lib/location'

// The map library is only downloaded when the customer opens the map.
const MapPicker = lazy(() => import('./MapPicker'))

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  )
}

/** "Deliver to" chip in the header. */
export function LocationButton() {
  const { location, openDialog } = useLocationChoice()
  return (
    <button type="button" className="loc-btn" onClick={() => openDialog()} aria-haspopup="dialog">
      <PinIcon />
      <span className="loc-label">
        <small>{location?.zone === 'outside' ? 'الشحن إلى' : 'موقعك'}</small>
        <b>{location ? location.city : 'حدد موقعك'}</b>
      </span>
    </button>
  )
}

/** First-visit bar under the header until the customer pins the house. */
export function LocationPrompt() {
  const { location, promptDismissed, dismissPrompt, openDialog } = useLocationChoice()
  if (location || promptDismissed) return null
  return (
    <div className="loc-prompt" role="region" aria-label="تحديد الموقع">
      <div className="wrap">
        <p>
          <b>وين بيتك؟</b> حدده على الخريطة ونقول لك وش الخدمات المتاحة لك.
        </p>
        <div className="loc-prompt-actions">
          <button type="button" className="btn sm" onClick={() => openDialog()}>
            حدد بيتك على الخريطة
          </button>
          <button type="button" className="linkbtn" onClick={dismissPrompt}>
            لاحقاً
          </button>
        </div>
      </div>
    </div>
  )
}

/** What happens with orders at this pin: Mecca gets delivery, installation and maintenance; elsewhere ships only. */
function Outcome({ location, settings }: { location: StoreLocation; settings: StoreSettings | null }) {
  const fee = (n: number) => (settings ? formatSar(priceWithVat(n, settings.vat_rate)) : '…')
  if (location.zone === 'mecca') {
    return (
      <div className="loc-outcome ok" role="status">
        <b>بيتك داخل منطقة الخدمة في مكة المكرمة</b>
        <ul>
          <li>نوصّل طلبك لباب البيت.</li>
          <li>نركّب الجهاز عندك برسوم {fee(settings?.install_fee ?? 0)} شامل الضريبة (تختاره عند إتمام الطلب).</li>
          <li>خدمات الصيانة وتغيير الفلاتر والزيارات متاحة لك.</li>
        </ul>
      </div>
    )
  }
  return (
    <div className="loc-outcome" role="status">
      <b>بيتك خارج منطقة الخدمة ({location.city})</b>
      <ul>
        <li>نشحن طلبك لك، ورسوم الشحن {fee(settings?.shipping_fee ?? 0)} للطلب شامل الضريبة.</li>
        <li>التركيب والصيانة والزيارات متاحة داخل مكة المكرمة فقط، فما تظهر لك في المتجر.</li>
      </ul>
    </div>
  )
}

/** The chooser: the customer pins the house on the map, then sees what that location gets. */
export function LocationDialog() {
  const { location, set, dialogOpen, closeDialog } = useLocationChoice()
  const [view, setView] = useState<'map' | 'result'>('map')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<StoreSettings | null>(null)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (dialogOpen && !d.open) {
      // A customer who already pinned the house sees what applies, with a way to move the pin.
      setView(location ? 'result' : 'map')
      setError('')
      d.showModal()
    } else if (!dialogOpen && d.open) d.close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogOpen])

  useEffect(() => {
    if (dialogOpen && !settings) fetchSettings().then(setSettings, () => {})
  }, [dialogOpen, settings])

  const confirmPin = async (lat: number, lng: number) => {
    setBusy(true)
    setError('')
    try {
      set(await pinnedLocation(lat, lng))
      setView('result')
    } catch {
      setError(CHECK_FAILED)
    } finally {
      setBusy(false)
    }
  }

  const initialPin = location ? { lat: location.lat, lng: location.lng } : null

  return (
    <dialog ref={ref} className={view === 'map' ? 'loc-dialog wide' : 'loc-dialog'} aria-labelledby="loc-title" onClose={closeDialog} onCancel={closeDialog}>
      <div className="loc-body">
        <div className="loc-head">
          <h2 id="loc-title" className="h3">
            {view === 'map' ? 'حدد بيتك على الخريطة' : 'موقعك'}
          </h2>
          <button type="button" className="loc-x" aria-label="إغلاق" onClick={closeDialog}>
            ×
          </button>
        </div>
        {view === 'map' && dialogOpen ? (
          <>
            <Suspense fallback={<div className="map-loading">جاري تحميل الخريطة…</div>}>
              <MapPicker
                initial={initialPin}
                busy={busy}
                onConfirm={confirmPin}
                onCancel={() => (location ? setView('result') : closeDialog())}
                cancelLabel={location ? 'رجوع' : 'لاحقاً'}
              />
            </Suspense>
            {error && (
              <p className="loc-error" role="alert">
                {error}
              </p>
            )}
          </>
        ) : (
          location && (
            <>
              <Outcome location={location} settings={settings} />
              <button type="button" className="btn block" onClick={closeDialog}>
                تمام، كمّل التسوق
              </button>
              <button type="button" className="btn block ghost loc-detect" onClick={() => setView('map')}>
                <PinIcon />
                تعديل مكان الدبوس
              </button>
              <p className="muted center">موقع بيتك محفوظ في جهازك فقط، ونستخدمه عند إتمام الطلب.</p>
            </>
          )
        )}
      </div>
    </dialog>
  )
}
