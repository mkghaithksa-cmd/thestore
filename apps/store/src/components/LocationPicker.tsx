import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { MECCA_CITY, OTHER_CITY, SAUDI_CITIES } from '@ghaith/shared'
import { DETECT_ERRORS, detectLocation, manualLocation, pinnedLocation, useLocationChoice, type DetectError, type StoreLocation } from '../lib/location'

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

/** A detect hook shared by the prompt bar and the dialog. */
function useDetect(onDone: (loc: StoreLocation) => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<DetectError | null>(null)
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      onDone(await detectLocation())
    } catch (e) {
      setError(typeof e === 'string' && e in DETECT_ERRORS ? (e as DetectError) : 'unavailable')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

/** First-visit bar under the header until the customer picks a location. */
export function LocationPrompt() {
  const { location, set, promptDismissed, dismissPrompt, openDialog } = useLocationChoice()
  const { busy, error, run } = useDetect(set)
  if (location || promptDismissed) return null
  return (
    <div className="loc-prompt" role="region" aria-label="اختيار الموقع">
      <div className="wrap">
        <p>
          <b>وين موقعك؟</b> التركيب والصيانة داخل مكة المكرمة، والشحن لباقي المدن.
        </p>
        <div className="loc-prompt-actions">
          <button type="button" className="btn sm" onClick={() => openDialog('map')}>
            حدد بيتك على الخريطة
          </button>
          <button type="button" className="btn sm ghost" onClick={run} disabled={busy}>
            {busy ? 'جاري التحديد…' : 'تحديد تلقائي'}
          </button>
          <button type="button" className="btn sm ghost" onClick={() => set(manualLocation(MECCA_CITY))}>
            داخل مكة
          </button>
          <button type="button" className="btn sm ghost" onClick={() => openDialog()}>
            مدينة أخرى
          </button>
          <button type="button" className="linkbtn" onClick={dismissPrompt}>
            لاحقاً
          </button>
        </div>
        {error && (
          <p className="loc-error" role="alert">
            {DETECT_ERRORS[error]}
          </p>
        )}
      </div>
    </div>
  )
}

/** The full chooser: detect automatically, or pick Mecca / another city. */
export function LocationDialog() {
  const { location, set, dialogOpen, dialogView, closeDialog } = useLocationChoice()
  const [view, setView] = useState(dialogView)
  const [pinBusy, setPinBusy] = useState(false)
  const [pinError, setPinError] = useState('')
  const ref = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<'mecca' | 'outside'>('mecca')
  const [city, setCity] = useState('')
  const { busy, error, run } = useDetect((loc) => {
    set(loc)
    closeDialog()
  })

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (dialogOpen && !d.open) {
      setMode(location?.zone ?? 'mecca')
      setCity(location?.zone === 'outside' ? location.city : '')
      setView(dialogView)
      setPinError('')
      d.showModal()
    } else if (!dialogOpen && d.open) d.close()
  }, [dialogOpen, location, dialogView])

  const save = () => {
    if (mode === 'mecca') set(manualLocation(MECCA_CITY))
    else if (city) set(manualLocation(city))
    else return
    closeDialog()
  }

  const confirmPin = async (lat: number, lng: number) => {
    setPinBusy(true)
    setPinError('')
    try {
      set(await pinnedLocation(lat, lng))
      closeDialog()
    } catch {
      setPinError(DETECT_ERRORS['check-failed'])
    } finally {
      setPinBusy(false)
    }
  }

  const initialPin = location?.lat != null && location.lng != null ? { lat: location.lat, lng: location.lng } : null

  return (
    <dialog ref={ref} className={view === 'map' ? 'loc-dialog wide' : 'loc-dialog'} aria-labelledby="loc-title" onClose={closeDialog} onCancel={closeDialog}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <div className="loc-head">
          <h2 id="loc-title" className="h3">
            وين موقعك؟
          </h2>
          <button type="button" className="loc-x" aria-label="إغلاق" onClick={closeDialog}>
            ×
          </button>
        </div>
        {view === 'map' && dialogOpen ? (
          <>
            <Suspense fallback={<div className="map-loading">جاري تحميل الخريطة…</div>}>
              <MapPicker initial={initialPin} busy={pinBusy} onConfirm={confirmPin} onCancel={() => setView('choose')} />
            </Suspense>
            {pinError && (
              <p className="loc-error" role="alert">
                {pinError}
              </p>
            )}
          </>
        ) : (
          <>
        <p className="muted">التركيب والصيانة متاحة داخل مكة المكرمة فقط، وباقي المدن نشحن لها.</p>

        <button type="button" className="btn block loc-detect" onClick={() => setView('map')}>
          <PinIcon />
          حدد بيتك على الخريطة
        </button>

        <button type="button" className="btn block ghost loc-detect" onClick={run} disabled={busy}>
          <PinIcon />
          {busy ? 'جاري تحديد موقعك…' : 'حدد موقعي تلقائياً'}
        </button>
        {error && (
          <p className="loc-error" role="alert">
            {DETECT_ERRORS[error]}
          </p>
        )}

        <div className="loc-or" aria-hidden="true">
          <span>أو اختر</span>
        </div>

        <fieldset className="loc-options">
          <legend className="sr-only">المنطقة</legend>
          <label className={mode === 'mecca' ? 'on' : undefined}>
            <input type="radio" name="zone" checked={mode === 'mecca'} onChange={() => setMode('mecca')} />
            <span>
              <b>داخل مكة المكرمة</b>
              <small>توصيل، وتركيب، وصيانة</small>
            </span>
          </label>
          <label className={mode === 'outside' ? 'on' : undefined}>
            <input type="radio" name="zone" checked={mode === 'outside'} onChange={() => setMode('outside')} />
            <span>
              <b>مدينة أخرى</b>
              <small>شحن فقط</small>
            </span>
          </label>
        </fieldset>

        {mode === 'outside' && (
          <div className="field">
            <label htmlFor="loc-city">المدينة</label>
            <select id="loc-city" className="input" value={city} onChange={(e) => setCity(e.target.value)} required>
              <option value="">اختر مدينتك</option>
              {SAUDI_CITIES.filter((c) => c.name !== MECCA_CITY).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
              <option value={OTHER_CITY}>{OTHER_CITY}</option>
            </select>
          </div>
        )}

        <button type="submit" className="btn block" disabled={mode === 'outside' && !city}>
          حفظ
        </button>
        {location?.source === 'pin' && (
          <p className="muted center">موقع بيتك محدد على الخريطة. يبقى محفوظاً في جهازك ونستخدمه عند إتمام الطلب.</p>
        )}
          </>
        )}
        {view !== 'map' && location?.source === 'gps' && (
          <p className="muted center">تم التحديد تلقائياً. نستخدم موقعك فقط لمعرفة هل أنت داخل منطقة الخدمة، ويبقى محفوظاً في جهازك.</p>
        )}
      </form>
    </dialog>
  )
}
