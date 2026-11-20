import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { priceWithVat, type StoreSettings } from '@ghaith/shared'
import { fetchSettings, formatSar } from '../lib/catalog'
import { addressErrorMessage, addressTitle, LABEL_CHOICES, MAX_ADDRESSES, saveAddress } from '../lib/addresses'
import { useCart } from '../lib/cart'
import { CHECK_FAILED, fromSaved, pinnedLocation, useLocationChoice, type StoreLocation } from '../lib/location'

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
        <small>{!location ? 'موقعك' : location.zone === 'outside' ? 'الشحن إلى' : 'التوصيل إلى'}</small>
        <b>{location ? (location.title?.split(' – ')[0] ?? location.city) : 'حدد موقعك'}</b>
      </span>
    </button>
  )
}

/** First-visit bar under the header until the customer pins the house. */
export function LocationPrompt() {
  const { location, promptDismissed, dismissPrompt, openDialog, offerSave } = useLocationChoice()
  const { count } = useCart()
  if (offerSave) return <SaveOffer />
  if (location || promptDismissed || count === 0) return null
  return (
    <div className="loc-prompt" role="region" aria-label="تحديد الموقع">
      <div className="wrap">
        <p>
          <b>وين نوصّل طلبك؟</b> حدد بيتك على الخريطة ونقول لك هل التوصيل والتركيب متاح عندك.
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

/** Signed in with a pin from before: keep it in «عناويني»? One question, once. */
function SaveOffer() {
  const { saveCurrent, dismissOffer } = useLocationChoice()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (label: string) => {
    setBusy(true)
    setError('')
    try {
      await saveCurrent(label)
    } catch (e) {
      setError(addressErrorMessage(e instanceof Error ? e.message : null))
      setBusy(false)
    }
  }
  return (
    <div className="loc-prompt" role="region" aria-label="حفظ العنوان">
      <div className="wrap">
        <p>
          <b>نحفظ الموقع اللي حددته في «عناويني»؟</b> عشان ما نسألك عنه مرة ثانية، حتى من جوال ثاني.
        </p>
        <div className="loc-prompt-actions">
          {LABEL_CHOICES.slice(0, 2).map((l) => (
            <button key={l} type="button" className="btn sm" disabled={busy} onClick={() => save(l)}>
              احفظه كـ «{l}»
            </button>
          ))}
          <button type="button" className="linkbtn" onClick={dismissOffer}>
            لا، شكراً
          </button>
        </div>
        {error && <p className="loc-error">{error}</p>}
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
  const { location, set, dialogOpen, closeDialog, addresses, customerId, reloadAddresses } = useLocationChoice()
  const [view, setView] = useState<'list' | 'map' | 'result'>('map')
  const [savedNote, setSavedNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<StoreSettings | null>(null)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (dialogOpen && !d.open) {
      // A customer who already pinned the house sees what applies, with a way to move the pin.
      setView(addresses.length ? 'list' : location ? 'result' : 'map')
      setError('')
      setSavedNote('')
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
      const loc = await pinnedLocation(lat, lng)
      set(loc)
      // A signed-in customer keeps the pin in «عناويني» (a pin near a saved one updates it).
      if (customerId) {
        try {
          const id = await saveAddress({ lat: loc.lat, lng: loc.lng, label: addresses.length === 0 ? 'البيت' : null, makeDefault: addresses.length === 0 })
          const list = await reloadAddresses()
          const saved = list.find((a) => a.id === id)
          if (saved) set(fromSaved(saved))
          setSavedNote(addresses.some((a) => a.id === id) ? 'حدّثنا مكان العنوان في «عناويني».' : 'انحفظ في «عناويني». تقدر تسمّيه وتضيف وصف المبنى من هناك.')
        } catch (e) {
          setSavedNote(addressErrorMessage(e instanceof Error ? e.message : null))
        }
      }
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
            {view === 'map' ? 'حدد بيتك على الخريطة' : view === 'list' ? 'وين نوصّل؟' : 'موقعك'}
          </h2>
          <button type="button" className="loc-x" aria-label="إغلاق" onClick={closeDialog}>
            ×
          </button>
        </div>
        {view === 'list' ? (
          <div className="addr-pick">
            {addresses.map((a) => (
              <button
                key={a.id}
                type="button"
                className={location?.addressId === a.id ? 'on' : undefined}
                onClick={() => {
                  set(fromSaved(a))
                  closeDialog()
                }}
              >
                <PinIcon />
                <span>
                  <b>{addressTitle(a)}</b>
                  <small>
                    {[a.street, a.building_note].filter(Boolean).join(' · ') || (a.in_service_area ? 'داخل مكة' : 'خارج مكة: شحن فقط')}
                  </small>
                </span>
                {a.is_default ? <em>الأساسي</em> : !a.in_service_area && <em className="off">شحن فقط</em>}
              </button>
            ))}
            {addresses.length < MAX_ADDRESSES ? (
              <button type="button" className="btn block ghost" onClick={() => setView('map')}>
                + عنوان جديد على الخريطة
              </button>
            ) : (
              <p className="muted center">عندك {MAX_ADDRESSES} عناوين، وهذا الحد. تقدر تحذف واحد من «عناويني».</p>
            )}
            <Link to="/account/addresses" className="link center" onClick={closeDialog}>
              إدارة عناويني
            </Link>
          </div>
        ) : view === 'map' && dialogOpen ? (
          <>
            <Suspense fallback={<div className="map-loading">جاري تحميل الخريطة…</div>}>
              <MapPicker
                initial={initialPin}
                busy={busy}
                onConfirm={confirmPin}
                onCancel={() => (addresses.length ? setView('list') : location ? setView('result') : closeDialog())}
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
              {savedNote ? (
                <p className="muted center">{savedNote}</p>
              ) : customerId ? null : (
                <p className="muted center">موقعك محفوظ في جهازك. سجّل دخول عشان نحفظه في حسابك.</p>
              )}
            </>
          )
        )}
      </div>
    </dialog>
  )
}
