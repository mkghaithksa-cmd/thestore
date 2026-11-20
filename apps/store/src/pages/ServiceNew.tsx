import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  DEVICE_KIND_LABELS,
  OPEN_SERVICE_STATUSES,
  PERIOD_LABELS,
  serviceErrorMessage,
  type DeviceKind,
  type ServiceKind,
  type ServicePeriod,
} from '@ghaith/shared'
import { AddressConfirm } from '../components/AddressConfirm'
import { saveAddress } from '../lib/addresses'
import { useAuth } from '../lib/auth'
import { fetchSettings, formatSar } from '../lib/catalog'
import { fetchMyCustomer } from '../lib/customer'
import { addressFromPin } from '../lib/geocode'
import { useLocationChoice } from '../lib/location'
import { fetchNeighborhoods, fetchWorkDays, formatDate, visitDays } from '../lib/orders'
import { fetchMyDevicesFull, fetchMyMeccaAddresses, fetchMyRequests, requestService, riyadhDate, uploadServicePhoto } from '../lib/service'
import { usePageMeta } from '../lib/seo'
import { useAsync } from '../lib/useAsync'

const MAX_PHOTO = 5 * 1024 * 1024
const KINDS = Object.keys(DEVICE_KIND_LABELS) as DeviceKind[]
/** Device choice: a saved device id, a new device of any company, or "don't know". */
type DeviceChoice = string | 'other' | 'unknown' | ''

async function loadForm() {
  const [customer, devices, addresses, settings, days, hoods, requests] = await Promise.all([
    fetchMyCustomer(),
    fetchMyDevicesFull(),
    fetchMyMeccaAddresses(),
    fetchSettings(),
    fetchWorkDays(),
    fetchNeighborhoods(),
    fetchMyRequests(),
  ])
  return { customer, devices, addresses, settings, days, hoods, open: requests.filter((r) => OPEN_SERVICE_STATUSES.includes(r.status)) }
}

/** Saudi hour now (0–23). */
const riyadhHour = () => new Date(Date.now() + 3 * 3600 * 1000).getUTCHours()

/**
 * /service/new — report a fault or book maintenance, for any device (ours or
 * another company's). Built for few taps: problem → device → when → send.
 */
export function ServiceNew() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { location, openDialog, reloadAddresses } = useLocationChoice()
  const { state, reload } = useAsync(loadForm)

  const [kind, setKind] = useState<ServiceKind>(params.get('kind') === 'maintenance' ? 'maintenance' : 'emergency')
  const emergency = kind === 'emergency'
  usePageMeta(emergency ? 'بلاغ عطل' : 'حجز صيانة')

  const [fault, setFault] = useState('')
  const [device, setDevice] = useState<DeviceChoice>(params.get('device') ?? '')
  const [otherKind, setOtherKind] = useState<DeviceKind>('under_sink')
  const [otherBrand, setOtherBrand] = useState('')
  const [date, setDate] = useState('')
  const [period, setPeriod] = useState<ServicePeriod | ''>('')
  const [addressId, setAddressId] = useState('')
  const [pickAddress, setPickAddress] = useState(false)
  const [hood, setHood] = useState('')
  const [street, setStreet] = useState('')
  const [note, setNote] = useState('')
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const data = state.status === 'success' ? state.data : null
  const pinInMecca = location?.zone === 'mecca'

  // Sensible defaults so most customers only tap the problem and send.
  useEffect(() => {
    if (!data) return
    setAddressId((a) => a || (data.addresses.find((x) => x.id === location?.addressId)?.id ?? data.addresses[0]?.id ?? 'pin'))
    setName((n) => n || data.customer?.full_name || '')
    const free = data.devices.filter((d) => !data.open.some((r) => r.device_id === d.id))
    setDevice((d) => d || (free.length === 1 ? free[0].id : data.devices.length === 0 ? 'other' : ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Emergency: as soon as possible — today, or tomorrow morning late at night.
  useEffect(() => {
    if (!emergency) {
      setDate('')
      setPeriod('')
      return
    }
    const h = riyadhHour()
    if (h >= 19) {
      setDate(riyadhDate(1))
      setPeriod('morning')
    } else {
      setDate(riyadhDate())
      setPeriod(h < 12 ? 'morning' : 'evening')
    }
  }, [emergency])

  // Fill the neighbourhood and street from the map pin (fields the customer typed stay).
  const auto = useRef({ hood: '', street: '' })
  const pinLat = location?.lat
  const pinLng = location?.lng
  useEffect(() => {
    if (pinLat === undefined || pinLng === undefined || !pinInMecca) return
    let live = true
    addressFromPin(pinLat, pinLng).then((a) => {
      if (!live || !a) return
      const was = auto.current
      const next = { hood: a.neighborhood ?? '', street: a.street ?? '' }
      setHood((v) => (!v.trim() || v === was.hood ? next.hood || v : v))
      setStreet((v) => (!v.trim() || v === was.street ? next.street || v : v))
      auto.current = next
    })
    return () => {
      live = false
    }
  }, [pinLat, pinLng, pinInMecca])

  const workDays = useMemo(() => (data ? visitDays(data.days) : []), [data])
  const dayChips = useMemo(() => {
    if (emergency) {
      return [
        { date: riyadhDate(), label: 'اليوم' },
        { date: riyadhDate(1), label: 'بكرة' },
      ]
    }
    return workDays.slice(0, 3).map((d) => ({ date: d.date, label: d.label.replace('بكرة، ', 'بكرة ') }))
  }, [emergency, workDays])
  const moreDays = (emergency ? workDays : workDays.slice(3)).filter((d) => !dayChips.some((c) => c.date === d.date))

  if (state.status === 'loading') return <p className="muted">جاري التحميل…</p>
  if (state.status === 'error' || !data) {
    return (
      <div className="notice bad" role="alert">
        <b>تعذّر تحميل الصفحة.</b>
        <button className="btn sm" onClick={reload}>
          إعادة المحاولة
        </button>
      </div>
    )
  }
  if (!data.customer) {
    return (
      <div className="notice warn" role="alert">
        <b>هذا الحساب حساب موظف.</b>
        <span>للبلاغات من المتجر سجّل دخول برقم جوال عميل.</span>
      </div>
    )
  }
  if (data.open.length >= 2) {
    return (
      <div className="stack narrow">
        <h1 className="page-h">{emergency ? 'بلاغ عطل' : 'حجز صيانة'}</h1>
        <div className="notice warn">
          <b>عندك طلبين مفتوحين.</b>
          <span>انتظر انتهاء أحدها، أو اتصل بنا إذا الأمر مستعجل.</span>
          <Link to="/service" className="btn sm self-start">
            طلبات الصيانة
          </Link>
        </div>
      </div>
    )
  }

  const busyDevices = new Set(data.open.map((r) => r.device_id).filter(Boolean))
  const devices = data.devices.filter((d) => !busyDevices.has(d.id))
  const faults = (data.settings.fault_types ?? []).filter((f) => emergency || f !== 'تغيير فلاتر')
  const usePin = addressId === 'pin'
  const address = data.addresses.find((a) => a.id === addressId)
  const buildingNote = note.trim() || address?.building_note || ''
  const fee = Number(data.settings.inspection_fee) * (1 + Number(data.settings.vat_rate))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (emergency && !fault) return setError('اختر وش المشكلة.')
    if (!device || (!emergency && device === 'unknown')) return setError('اختر الجهاز.')
    if (!date) return setError('اختر اليوم.')
    if (!period) return setError('اختر الفترة: الصباح أو المساء.')
    if (usePin && !pinInMecca) return setError('خدمة الصيانة والبلاغات داخل مكة فقط. حدد موقع بيتك في مكة.')
    if (usePin && !hood.trim()) return setError('اكتب اسم الحي.')
    if (!name.trim()) return setError('اكتب اسمك.')
    if (photo && photo.size > MAX_PHOTO) return setError('الصورة أكبر من 5 ميجا.')
    setBusy(true)
    try {
      const photoPath = photo && session ? await uploadServicePhoto(session.user.id, photo) : null
      // Keep the address (and its building note) in «عناويني»; the request copies the note for the technician.
      let useAddressId = usePin ? null : addressId
      if (usePin && location) {
        useAddressId = await saveAddress({ lat: location.lat, lng: location.lng, neighborhood_name: hood.trim(), street: street.trim(), building_note: note.trim() || null }).catch(() => null)
      } else if (address && note.trim() && note.trim() !== (address.building_note ?? '')) {
        await saveAddress({ id: address.id, lat: address.lat!, lng: address.lng!, label: address.label, neighborhood_name: address.neighborhood_name, street: address.street, building_note: note.trim() }).catch(() => null)
      }
      if (useAddressId) reloadAddresses()
      const r = await requestService({
        kind,
        deviceId: device !== 'other' && device !== 'unknown' ? device : null,
        newDevice: device === 'other' ? { kind: otherKind, brand: otherBrand } : null,
        date,
        period,
        faultType: emergency ? fault : null,
        description,
        photoPath,
        contactName: name,
        addressId: useAddressId,
        pin: !useAddressId && location ? { lat: location.lat, lng: location.lng, neighborhood: hood.trim(), street: street.trim() } : null,
      })
      navigate(`/service?new=${encodeURIComponent(r.request_number)}`, { replace: true })
    } catch (err) {
      setError(serviceErrorMessage((err as Error).message))
      setBusy(false)
    }
  }

  const n = (i: number) => <span className="sv-n">{i}</span>
  let step = 0

  return (
    <form className="stack narrow sv-form" onSubmit={submit} noValidate>
      <h1 className="page-h">{emergency ? 'بلاغ عطل' : 'حجز صيانة وتغيير فلاتر'}</h1>
      <div className="seg" role="group" aria-label="نوع الطلب">
        {(['emergency', 'maintenance'] as ServiceKind[]).map((k) => (
          <button key={k} type="button" className={kind === k ? 'on' : undefined} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === 'emergency' ? 'عندي عطل' : 'صيانة دورية'}
          </button>
        ))}
      </div>

      {emergency && (
        <section className="card stack-sm">
          <h2 className="h3">
            {n(++step)} وش المشكلة؟
          </h2>
          <div className="pick" role="radiogroup" aria-label="المشكلة">
            {faults.map((f) => (
              <button key={f} type="button" role="radio" aria-checked={fault === f} className={fault === f ? 'on' : undefined} onClick={() => setFault(f)}>
                {f}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card stack-sm">
        <h2 className="h3">
          {n(++step)} أي جهاز؟
        </h2>
        <div className="pick" role="radiogroup" aria-label="الجهاز">
          {devices.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={device === d.id} className={device === d.id ? 'on' : undefined} onClick={() => setDevice(d.id)}>
              {d.name_ar}
              <small>{d.product_id ? `من غيث · ${formatDate(d.started_on)}` : 'جهاز مسجل عندك'}</small>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={device === 'other'} className={device === 'other' ? 'on' : undefined} onClick={() => setDevice('other')}>
            {devices.length ? 'جهاز ثاني' : 'جهازي'}
            <small>من أي شركة</small>
          </button>
          {emergency && (
            <button type="button" role="radio" aria-checked={device === 'unknown'} className={device === 'unknown' ? 'on' : undefined} onClick={() => setDevice('unknown')}>
              ما أعرف
              <small>الفني يشوفه</small>
            </button>
          )}
        </div>
        {device === 'other' && (
          <div className="inset-box stack-sm">
            <span className="muted">نوعه:</span>
            <div className="seg" role="radiogroup" aria-label="نوع الجهاز">
              {KINDS.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={otherKind === k} className={otherKind === k ? 'on' : undefined} onClick={() => setOtherKind(k)}>
                  {DEVICE_KIND_LABELS[k]}
                </button>
              ))}
            </div>
            <input className="input" aria-label="الشركة أو الماركة (اختياري)" placeholder="الشركة أو الماركة (اختياري)" maxLength={60} value={otherBrand} onChange={(e) => setOtherBrand(e.target.value)} />
            <small className="muted">نحفظه في «أجهزتي» عشان نذكّرك بتغيير الفلاتر.</small>
          </div>
        )}
      </section>

      <section className="card stack-sm">
        <h2 className="h3">
          {n(++step)} متى يناسبك؟
        </h2>
        <div className="pick" role="radiogroup" aria-label="اليوم">
          {dayChips.map((d) => (
            <button key={d.date} type="button" role="radio" aria-checked={date === d.date} className={date === d.date ? 'on' : undefined} onClick={() => setDate(d.date)}>
              {d.label}
            </button>
          ))}
          <select
            className={`input pick-select${date && !dayChips.some((c) => c.date === date) ? ' on' : ''}`}
            aria-label="يوم ثاني"
            value={dayChips.some((c) => c.date === date) ? '' : date}
            onChange={(e) => setDate(e.target.value)}
          >
            <option value="">يوم ثاني…</option>
            {moreDays.map((d) => (
              <option key={d.date} value={d.date}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className="seg" role="radiogroup" aria-label="الفترة">
          {(['morning', 'evening'] as ServicePeriod[]).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={period === p} className={period === p ? 'on' : undefined} onClick={() => setPeriod(p)}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
        <small className="muted">نحدد الساعة ونتصل فيك نأكدها.</small>
      </section>

      <section className="card stack-sm">
        <h2 className="h3">
          {n(++step)} وين نزورك؟
        </h2>
        {address && !pickAddress ? (
          <div className="row between wrapr">
            <span>
              <b>{address.label || address.neighborhood_name || 'عنواني'}</b>
              {address.street && <span className="muted"> · {address.street}</span>}
              {address.building_note && <small className="muted d-block">{address.building_note}</small>}
            </span>
            <button type="button" className="linkbtn" onClick={() => setPickAddress(true)}>
              تغيير
            </button>
          </div>
        ) : (
          <>
            {data.addresses.length > 0 && (
              <fieldset className="co-options one">
                <legend className="sr-only">العنوان</legend>
                {data.addresses.map((a) => (
                  <label key={a.id} className={addressId === a.id ? 'on' : undefined}>
                    <input
                      type="radio"
                      name="address"
                      checked={addressId === a.id}
                      onChange={() => {
                        setAddressId(a.id)
                        setPickAddress(false)
                      }}
                    />
                    <span>
                      <b>{a.label || a.neighborhood_name || 'عنواني'}</b>
                      <small>{[a.neighborhood_name, a.street].filter(Boolean).join('، ') || 'عنوان محفوظ'}</small>
                    </span>
                  </label>
                ))}
                <label className={usePin ? 'on' : undefined}>
                  <input type="radio" name="address" checked={usePin} onChange={() => setAddressId('pin')} />
                  <span>
                    <b>مكان آخر على الخريطة</b>
                  </span>
                </label>
              </fieldset>
            )}
            {usePin && (
              <>
                {!location || !pinInMecca ? (
                  <p className="notice warn">
                    <b>{location ? 'الدبوس خارج منطقة الخدمة.' : 'حدد موقع بيتك على الخريطة.'}</b>
                    <span>خدمة الصيانة والبلاغات داخل مكة فقط.</span>
                  </p>
                ) : (
                  <>
                    <input className="input" list="sv-hoods" aria-label="الحي" placeholder="الحي" value={hood} onChange={(e) => setHood(e.target.value)} maxLength={80} />
                    <datalist id="sv-hoods">
                      {data.hoods.map((h) => (
                        <option key={h.id} value={h.name_ar} />
                      ))}
                    </datalist>
                    <input className="input" aria-label="الشارع ورقم البيت (اختياري)" placeholder="الشارع ورقم البيت (اختياري)" value={street} onChange={(e) => setStreet(e.target.value)} maxLength={300} />
                  </>
                )}
                <button type="button" className="linkbtn self-start" onClick={() => openDialog()}>
                  {location ? 'تعديل مكان الدبوس' : 'حدد بيتك على الخريطة'}
                </button>
              </>
            )}
          </>
        )}
        {(usePin ? pinInMecca : address && !address.building_note) && (
          <input
            className="input"
            aria-label="وصف المبنى"
            placeholder="وصف المبنى للفني: مثال عمارة بيضاء، الدور الثاني"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
          />
        )}
        {!data.customer.full_name && (
          <input className="input" autoComplete="name" aria-label="اسمك" placeholder="اسمك" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        )}
      </section>

      <details className="card sv-more">
        <summary>{emergency ? 'أضف وصف أو صورة للعطل (اختياري)' : 'ملاحظات (اختياري)'}</summary>
        <div className="stack-sm">
          <textarea
            className="input"
            rows={3}
            maxLength={1000}
            aria-label="الوصف"
            placeholder={emergency ? 'مثال: فيه تسريب من تحت الخزان من أمس' : 'أي شي تبي الفني يعرفه'}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {emergency && (
            <label className="stack-sm">
              <span className="muted">صورة (حتى 5 ميجا)</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            </label>
          )}
        </div>
      </details>

      {emergency && (
        <p className="muted center">
          رسوم الفحص {formatSar(Math.round(fee * 100) / 100)} شامل الضريبة، تندفع عند الزيارة. بدون دفع مسبق.
        </p>
      )}
      {(address && !usePin && address.lat !== null && address.lng !== null) || (usePin && location && pinInMecca) ? (
        <AddressConfirm
          heading="يزورك الفني في"
          title={usePin ? hood.trim() || 'الموقع على الخريطة' : address!.label || address!.neighborhood_name || 'عنواني'}
          lines={usePin ? [street.trim(), note.trim()] : [[address!.neighborhood_name, address!.street].filter(Boolean).join('، '), buildingNote]}
          lat={usePin ? location!.lat : address!.lat!}
          lng={usePin ? location!.lng : address!.lng!}
          onChange={() => (usePin ? openDialog() : setPickAddress(true))}
        />
      ) : null}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn block" disabled={busy}>
        {busy ? 'نرسل…' : emergency ? 'العنوان صحيح، أرسل البلاغ' : 'العنوان صحيح، احجز الصيانة'}
      </button>
    </form>
  )
}
