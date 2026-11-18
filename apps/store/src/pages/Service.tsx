import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  OPEN_SERVICE_STATUSES,
  PERIOD_LABELS,
  SERVICE_KIND_LABELS,
  SERVICE_STATUS_LABELS,
  serviceErrorMessage,
  type ServiceKind,
  type ServicePeriod,
} from '@ghaith/shared'
import { useAuth } from '../lib/auth'
import { fetchSettings, formatSar } from '../lib/catalog'
import { fetchMyCustomer } from '../lib/customer'
import { addressFromPin } from '../lib/geocode'
import { useLocationChoice } from '../lib/location'
import { fetchNeighborhoods, fetchWorkDays, formatDate, visitDays } from '../lib/orders'
import {
  cancelMyRequest,
  fetchMyDevicesFull,
  fetchMyMeccaAddresses,
  fetchMyRequests,
  fetchRequestEvents,
  requestService,
  riyadhDate,
  uploadServicePhoto,
} from '../lib/service'
import { usePageMeta } from '../lib/seo'
import { useAsync } from '../lib/useAsync'

const MAX_PHOTO = 5 * 1024 * 1024

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

/** /service/new — report a fault (emergency) or book a maintenance visit. Mecca only. */
export function ServiceNew() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const { location, openDialog } = useLocationChoice()
  const { state, reload } = useAsync(loadForm)

  const [kind, setKind] = useState<ServiceKind>(params.get('kind') === 'maintenance' ? 'maintenance' : 'emergency')
  usePageMeta(kind === 'emergency' ? 'بلاغ عطل' : 'حجز صيانة')
  const [deviceId, setDeviceId] = useState(params.get('device') ?? '')
  const [fault, setFault] = useState('')
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [date, setDate] = useState('')
  const [period, setPeriod] = useState<ServicePeriod | ''>('')
  const [addressId, setAddressId] = useState<string>('')
  const [hood, setHood] = useState('')
  const [street, setStreet] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const data = state.status === 'success' ? state.data : null
  const pinInMecca = location?.zone === 'mecca'

  // Default: the first saved Mecca address, else the map pin.
  useEffect(() => {
    if (!data) return
    setAddressId((a) => a || (data.addresses[0]?.id ?? 'pin'))
    setName((n) => n || data.customer?.full_name || '')
  }, [data])

  // Fill the neighbourhood and street from the pin (only fields not typed by the customer).
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

  const days = useMemo(() => {
    if (!data) return []
    const list = visitDays(data.days)
    return kind === 'emergency' ? [{ date: riyadhDate(), label: 'اليوم' }, ...list.filter((d) => d.date !== riyadhDate())] : list
  }, [data, kind])
  useEffect(() => {
    if (date && !days.some((d) => d.date === date)) setDate('')
  }, [days, date])

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
        <h1 className="page-h">{kind === 'emergency' ? 'بلاغ عطل' : 'حجز صيانة'}</h1>
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
  const faults = data.settings.fault_types ?? []
  const usePin = addressId === 'pin'
  const fee = Number(data.settings.inspection_fee) * (1 + Number(data.settings.vat_rate))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (kind === 'maintenance' && !deviceId) return setError('اختر الجهاز.')
    if (kind === 'emergency' && !fault) return setError('اختر نوع العطل.')
    if (!date) return setError('اختر اليوم المناسب.')
    if (!period) return setError('اختر الفترة: الصباح أو المساء.')
    if (usePin && !pinInMecca) return setError('خدمة الصيانة والبلاغات داخل مكة فقط. حدد موقع بيتك في مكة.')
    if (usePin && !hood.trim()) return setError('اكتب اسم الحي.')
    if (!name.trim()) return setError('اكتب اسمك.')
    if (photo && photo.size > MAX_PHOTO) return setError('الصورة أكبر من 5 ميجا.')
    setBusy(true)
    try {
      const photoPath = photo && session ? await uploadServicePhoto(session.user.id, photo) : null
      const r = await requestService({
        kind,
        deviceId: deviceId || null,
        date,
        period,
        faultType: kind === 'emergency' ? fault : null,
        description,
        photoPath,
        contactName: name,
        addressId: usePin ? null : addressId,
        pin: usePin && location ? { lat: location.lat, lng: location.lng, neighborhood: hood.trim(), street: street.trim() } : null,
      })
      navigate(`/service?new=${encodeURIComponent(r.request_number)}`, { replace: true })
    } catch (err) {
      setError(serviceErrorMessage((err as Error).message))
      setBusy(false)
    }
  }

  return (
    <form className="stack narrow" onSubmit={submit} noValidate>
      <h1 className="page-h">{kind === 'emergency' ? 'بلاغ عطل' : 'حجز صيانة'}</h1>
      <div className="seg" role="group" aria-label="نوع الطلب">
        {(['emergency', 'maintenance'] as ServiceKind[]).map((k) => (
          <button key={k} type="button" className={kind === k ? 'on' : undefined} aria-pressed={kind === k} onClick={() => setKind(k)}>
            {k === 'emergency' ? 'عطل في الجهاز' : 'صيانة دورية وتغيير فلاتر'}
          </button>
        ))}
      </div>

      <section className="card">
        <div className="field">
          <label htmlFor="sv-device">الجهاز</label>
          <select id="sv-device" className="input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            <option value="">{kind === 'emergency' ? 'جهاز غير مسجل عندي / ما أعرف' : 'اختر الجهاز'}</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name_ar}
                {d.model ? ` (${d.model})` : ''} · {formatDate(d.started_on)}
              </option>
            ))}
          </select>
          {data.devices.length > devices.length && <small className="muted">الأجهزة اللي عليها طلب مفتوح ما تظهر هنا.</small>}
        </div>

        {kind === 'emergency' && (
          <>
            <div className="field">
              <label htmlFor="sv-fault">نوع العطل</label>
              <select id="sv-fault" className="input" value={fault} onChange={(e) => setFault(e.target.value)}>
                <option value="">اختر</option>
                {faults.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="sv-desc">
                وصف المشكلة <span className="muted">(اختياري)</span>
              </label>
              <textarea
                id="sv-desc"
                className="input"
                rows={3}
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="مثال: فيه تسريب من تحت الخزان من أمس"
              />
            </div>
            <div className="field">
              <label htmlFor="sv-photo">
                صورة للعطل <span className="muted">(اختياري، حتى 5 ميجا)</span>
              </label>
              <input id="sv-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            </div>
          </>
        )}
        {kind === 'maintenance' && (
          <div className="field">
            <label htmlFor="sv-desc">
              ملاحظات <span className="muted">(اختياري)</span>
            </label>
            <textarea id="sv-desc" className="input" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="h3">مكان الزيارة</h2>
        <fieldset className="co-options one">
          <legend className="sr-only">العنوان</legend>
          {data.addresses.map((a) => (
            <label key={a.id} className={addressId === a.id ? 'on' : undefined}>
              <input type="radio" name="address" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
              <span>
                <b>{a.label || a.neighborhood_name || 'عنواني'}</b>
                <small>{[a.neighborhood_name, a.street].filter(Boolean).join('، ') || 'عنوان محفوظ'}</small>
              </span>
            </label>
          ))}
          <label className={usePin ? 'on' : undefined}>
            <input type="radio" name="address" checked={usePin} onChange={() => setAddressId('pin')} />
            <span>
              <b>{data.addresses.length ? 'مكان آخر على الخريطة' : 'موقع البيت على الخريطة'}</b>
              <small>{location ? (pinInMecca ? 'الدبوس داخل مكة' : 'الدبوس خارج مكة') : 'ما حددت الموقع بعد'}</small>
            </span>
          </label>
        </fieldset>
        {usePin && (
          <>
            {!location || !pinInMecca ? (
              <p className="notice warn">
                <b>{location ? 'الدبوس خارج منطقة الخدمة.' : 'حدد موقع بيتك على الخريطة.'}</b>
                <span>خدمة الصيانة والبلاغات داخل مكة فقط.</span>
              </p>
            ) : (
              <>
                <div className="field">
                  <label htmlFor="sv-hood">الحي</label>
                  <input id="sv-hood" className="input" list="sv-hoods" value={hood} onChange={(e) => setHood(e.target.value)} maxLength={80} />
                  <datalist id="sv-hoods">
                    {data.hoods.map((h) => (
                      <option key={h.id} value={h.name_ar} />
                    ))}
                  </datalist>
                </div>
                <div className="field">
                  <label htmlFor="sv-street">
                    الشارع ورقم البيت <span className="muted">(اختياري)</span>
                  </label>
                  <input id="sv-street" className="input" value={street} onChange={(e) => setStreet(e.target.value)} maxLength={300} />
                </div>
              </>
            )}
            <button type="button" className="linkbtn" onClick={() => openDialog()}>
              {location ? 'تعديل مكان الدبوس' : 'حدد بيتك على الخريطة'}
            </button>
          </>
        )}
      </section>

      <section className="card">
        <h2 className="h3">الموعد المناسب لك</h2>
        <div className="field">
          <label htmlFor="sv-day">اليوم</label>
          <select id="sv-day" className="input" value={date} onChange={(e) => setDate(e.target.value)}>
            <option value="">اختر اليوم</option>
            {days.map((d) => (
              <option key={d.date} value={d.date}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span id="sv-period-l">الفترة</span>
          <div className="seg" role="group" aria-labelledby="sv-period-l">
            {(['morning', 'evening'] as ServicePeriod[]).map((p) => (
              <button key={p} type="button" className={period === p ? 'on' : undefined} aria-pressed={period === p} onClick={() => setPeriod(p)}>
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
        <p className="muted">نحدد الساعة ونتصل فيك نأكدها قبل الزيارة.</p>
        {!data.customer.full_name && (
          <div className="field">
            <label htmlFor="sv-name">اسمك</label>
            <input id="sv-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          </div>
        )}
      </section>

      {kind === 'emergency' && (
        <p className="notice">
          <b>رسوم الفحص {formatSar(Math.round(fee * 100) / 100)} شامل الضريبة.</b>
          <span>تندفع عند الزيارة، بدون دفع مسبق. إذا احتاج الجهاز قطع غيار نعطيك السعر قبل ما نركّبها.</span>
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn block" disabled={busy}>
        {busy ? 'نرسل الطلب…' : kind === 'emergency' ? 'أرسل البلاغ' : 'احجز الصيانة'}
      </button>
    </form>
  )
}

async function loadList() {
  const requests = await fetchMyRequests()
  const events = await fetchRequestEvents(requests.filter((r) => OPEN_SERVICE_STATUSES.includes(r.status)).map((r) => r.id))
  return { requests, events }
}

/** /service — the customer's fault reports and maintenance visits. */
export function ServiceList() {
  usePageMeta('طلبات الصيانة')
  const [params] = useSearchParams()
  const created = params.get('new')
  const { state, reload } = useAsync(loadList)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function cancel(id: string) {
    if (!window.confirm('متأكد تبي تلغي الطلب؟')) return
    setBusy(id)
    setError(null)
    try {
      await cancelMyRequest(id)
      reload()
    } catch (e) {
      setError(serviceErrorMessage((e as Error).message))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack narrow">
      <div className="row between wrapr">
        <h1 className="page-h">طلبات الصيانة</h1>
        <div className="row wrapr">
          <Link to="/devices" className="link">
            أجهزتي
          </Link>
          <Link to="/service/new?kind=emergency" className="btn sm">
            بلّغ عن عطل
          </Link>
        </div>
      </div>
      {created && (
        <p className="notice ok" role="status">
          <b>استلمنا طلبك رقم <span dir="ltr">{created}</span>.</b>
          <span>بنتصل فيك نأكد الساعة. البلاغات الطارئة لها الأولوية.</span>
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {state.status === 'loading' && <p className="muted">جاري التحميل…</p>}
      {state.status === 'error' && (
        <div className="notice bad" role="alert">
          <b>تعذّر تحميل طلباتك.</b>
          <button className="btn sm" onClick={reload}>
            إعادة المحاولة
          </button>
        </div>
      )}
      {state.status === 'success' && state.data.requests.length === 0 && (
        <div className="notice">
          <b>ما عندك طلبات صيانة.</b>
          <span className="muted">من «أجهزتي» تقدر تحجز صيانة أو تبلّغ عن عطل.</span>
        </div>
      )}
      {state.status === 'success' &&
        state.data.requests.map((r) => {
          const changes = state.data.events.filter((e) => e.request_id === r.id && e.from_status === 'scheduled' && e.to_status === 'scheduled')
          return (
            <section key={r.id} className="card stack-sm">
              <div className="row between wrapr">
                <b>
                  {SERVICE_KIND_LABELS[r.kind]} <span dir="ltr">{r.request_number}</span>
                </b>
                <span className={`tag${r.status === 'done' ? ' ok' : r.status === 'cancelled' ? ' off' : r.status === 'new' ? ' warn' : ''}`}>
                  {SERVICE_STATUS_LABELS[r.status]}
                </span>
              </div>
              {r.fault_type && <span>{r.fault_type}</span>}
              {r.status === 'scheduled' || r.status === 'in_progress' ? (
                <span>
                  الموعد: <b>{formatDate(r.scheduled_at!, true)}</b>
                </span>
              ) : (
                r.status === 'new' && (
                  <span className="muted">
                    طلبت: {formatDate(r.preferred_date)} {PERIOD_LABELS[r.preferred_period]}
                  </span>
                )
              )}
              {changes.length > 0 && r.status === 'scheduled' && (
                <span className="muted">تغيّر الموعد: {changes[changes.length - 1].note}</span>
              )}
              {r.neighborhood_name && <span className="muted">{[r.neighborhood_name, r.street].filter(Boolean).join('، ')}</span>}
              {r.kind === 'emergency' && Number(r.inspection_fee) > 0 && r.status !== 'cancelled' && (
                <span className="muted">رسوم الفحص {formatSar(Number(r.inspection_fee))} قبل الضريبة، تندفع عند الزيارة.</span>
              )}
              {r.status === 'cancelled' && r.cancel_reason && <span className="muted">سبب الإلغاء: {r.cancel_reason}</span>}
              {(r.status === 'new' || r.status === 'scheduled') && (
                <button type="button" className="linkbtn danger self-start" disabled={busy === r.id} onClick={() => cancel(r.id)}>
                  إلغاء الطلب
                </button>
              )}
            </section>
          )
        })}
    </div>
  )
}
