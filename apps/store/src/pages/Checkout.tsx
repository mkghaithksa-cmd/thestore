import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { orderErrorMessage, type Fulfillment } from '@ghaith/shared'
import { AddressConfirm } from '../components/AddressConfirm'
import { CatalogStatus } from '../components/CatalogStatus'
import { saveAddress } from '../lib/addresses'
import { useCart } from '../lib/cart'
import { formatSar } from '../lib/catalog'
import { fetchMyCustomer } from '../lib/customer'
import { addressFromPin } from '../lib/geocode'
import { availableHere, useLocationChoice } from '../lib/location'
import { fetchNeighborhoods, fetchWorkDays, hoodKey, placeOrder, visitDays } from '../lib/orders'
import { usePageMeta } from '../lib/seo'
import { useAsync } from '../lib/useAsync'
import { useCatalog } from '../lib/useCatalog'

const round2 = (n: number) => Math.round(n * 100) / 100

export function Checkout() {
  usePageMeta('إتمام الطلب')
  const cart = useCart()
  const navigate = useNavigate()
  const { location, openDialog, addresses, reloadAddresses } = useLocationChoice()
  const { state, reload } = useCatalog()
  const extra = useAsync(async () => {
    const [customer, hoods, days] = await Promise.all([fetchMyCustomer(), fetchNeighborhoods(), fetchWorkDays()])
    return { customer, hoods, days }
  })

  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [hood, setHood] = useState('')
  const [street, setStreet] = useState('')
  const [notes, setNotes] = useState('')
  const [city, setCity] = useState('')
  const [install, setInstall] = useState(true)
  const [visit, setVisit] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (extra.state.status !== 'success') return
    const saved = extra.state.data.customer?.full_name ?? ''
    setName((n) => n || saved)
  }, [extra.state])
  useEffect(() => {
    if (location?.zone === 'outside') setCity((c) => c || (location.city !== 'مدينة أخرى' ? location.city : ''))
  }, [location])

  // Fill the neighbourhood, street and city from the pin. A field the customer
  // typed in is left alone; one we filled before is updated when the pin moves.
  const auto = useRef({ hood: '', street: '', city: '' })
  const [lookup, setLookup] = useState<'idle' | 'busy' | 'done' | 'none'>('idle')
  const pinLat = location?.lat
  const pinLng = location?.lng
  const pinZone = location?.zone
  const saved = addresses.find((a) => a.id === location?.addressId) ?? null
  const savedHood = saved?.neighborhood_name ?? ''
  const savedStreet = saved?.street ?? ''
  const savedNote = saved?.building_note ?? ''
  useEffect(() => {
    if (!savedHood && !savedStreet && !savedNote) return
    setHood((v) => v || savedHood)
    setStreet((v) => v || savedStreet)
    setNotes((v) => v || savedNote)
  }, [savedHood, savedStreet, savedNote])
  useEffect(() => {
    if (pinLat === undefined || pinLng === undefined) return
    // A saved address already has its neighbourhood: no map lookup needed.
    if (savedHood) return
    let live = true
    setLookup('busy')
    addressFromPin(pinLat, pinLng).then((a) => {
      if (!live) return
      if (!a || (!a.neighborhood && !a.street)) return setLookup('none')
      const was = auto.current
      const outside = pinZone === 'outside'
      const next = {
        hood: outside ? '' : (a.neighborhood ?? ''),
        street: outside ? [a.neighborhood, a.street].filter(Boolean).join('، ') : (a.street ?? ''),
        city: outside ? (a.city ?? '') : '',
      }
      const take = (cur: string, old: string, nu: string) => (!cur.trim() || cur === old ? nu || cur : cur)
      setHood((v) => take(v, was.hood, next.hood))
      setStreet((v) => take(v, was.street, next.street))
      if (outside && next.city) setCity((v) => take(v, was.city, next.city))
      auto.current = next
      setLookup('done')
    })
    return () => {
      live = false
    }
  }, [pinLat, pinLng, pinZone, savedHood])

  const days = useMemo(() => (extra.state.status === 'success' ? visitDays(extra.state.data.days) : []), [extra.state])

  if (!cart.lines.length) {
    return (
      <div className="notice">
        <b>سلتك فاضية.</b>
        <Link to="/products" className="btn sm">
          تصفح المنتجات
        </Link>
      </div>
    )
  }
  if (state.status !== 'success') return <CatalogStatus state={state} reload={reload} />
  if (extra.state.status === 'loading') return <p className="muted">جاري التحميل…</p>
  if (extra.state.status === 'error') {
    return (
      <div className="notice bad" role="alert">
        <b>تعذّر تحميل صفحة الطلب.</b>
        <button className="btn sm" onClick={extra.reload}>
          إعادة المحاولة
        </button>
      </div>
    )
  }

  const { customer, hoods } = extra.state.data
  if (!customer) {
    return (
      <div className="notice warn" role="alert">
        <b>هذا الحساب حساب موظف.</b>
        <span>للطلب من المتجر سجّل دخول برقم جوال عميل.</span>
      </div>
    )
  }

  // Location first: the pin decides everything else.
  if (!location) {
    return (
      <div className="stack narrow">
        <h1 className="page-h">إتمام الطلب</h1>
        <div className="notice">
          <b>حدد موقع بيتك على الخريطة أولاً.</b>
          <span className="muted">منه نعرف هل نوصّل ونركّب داخل مكة، أو نشحن لك.</span>
          <button className="btn sm" onClick={() => openDialog()}>
            حدد بيتك على الخريطة
          </button>
        </div>
      </div>
    )
  }

  const inMecca = location.zone === 'mecca'
  const { products, settings } = state.data
  const vat = Number(settings.vat_rate)
  const rows = cart.lines
    .map((l) => ({ line: l, product: products.find((p) => p.id === l.productId) }))
    .filter((r) => r.product && availableHere(r.product.type, inMecca))
  const skipped = cart.lines.length - rows.length
  const installUnits = rows.filter((r) => r.product!.installable_in_mecca).reduce((n, r) => n + r.line.qty, 0)
  const hasService = rows.some((r) => r.product!.type === 'service')
  const withInstall = inMecca && install && installUnits > 0
  const fulfillment: Fulfillment = !inMecca ? 'shipping' : withInstall ? 'delivery_install' : 'delivery'
  const needsVisit = withInstall || hasService

  const subtotal = round2(rows.reduce((s, r) => s + Number(r.product!.price_before_vat) * r.line.qty, 0))
  const installFee = withInstall ? round2(Number(settings.install_fee) * installUnits) : 0
  const shipping = inMecca ? 0 : Number(settings.shipping_fee)
  const vatAmount = round2((subtotal + installFee + shipping) * vat)
  const total = round2(subtotal + installFee + shipping + vatAmount)
  const needsConsent = !customer.privacy_accepted_at

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (name.trim().length < 2) return setError('اكتب اسمك الكامل.')
    if (inMecca && hood.trim().length < 2) return setError('اكتب اسم الحي.')
    if (!inMecca && city.trim().length < 2) return setError('اكتب اسم مدينتك.')
    if (!inMecca && street.trim().length < 5) return setError('اكتب عنوان الشحن (الحي والشارع).')
    if (needsVisit && !visit) return setError('اختر اليوم المناسب للزيارة.')
    if (needsConsent && !agreed) return setError('يلزم الموافقة على الشروط وسياسة الخصوصية.')
    if (!rows.length) return setError('ما في سلتك منتجات متاحة لموقعك.')
    setBusy(true)
    try {
      const placed = await placeOrder({
        items: rows.map((r) => ({ product_id: r.line.productId, qty: r.line.qty })),
        fulfillment,
        lat: location!.lat,
        lng: location!.lng,
        city: inMecca ? null : city.trim(),
        neighborhood_id: inMecca ? (hoods.find((h) => hoodKey(h.name_ar) === hoodKey(hood))?.id ?? null) : null,
        neighborhood_name: inMecca ? hood.trim() : null,
        street: street.trim() || null,
        address_notes: notes.trim() || null,
        contact_name: name.trim(),
        preferred_visit_date: needsVisit ? visit : null,
        customer_notes: orderNotes.trim() || null,
        privacy_accepted: needsConsent ? agreed : false,
      })
      cart.clear()
      saveAddress({
        id: location!.addressId ?? null,
        lat: location!.lat,
        lng: location!.lng,
        neighborhood_name: inMecca ? hood.trim() : null,
        street: street.trim() || null,
        building_note: notes.trim() || null,
      })
        .then(() => reloadAddresses())
        .catch(() => {})
      navigate(`/orders/${placed.id}?new=1`, { replace: true })
    } catch (err) {
      setError(orderErrorMessage(err instanceof Error ? err.message : null))
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="page-h">إتمام الطلب</h1>
      <form className="cart" onSubmit={submit} noValidate>
        <div className="stack">
          <section className="card co-step">
            <h2 className="h3">
              <span className="co-n">1</span> الموقع
            </h2>
            {location.title && (
              <p className="co-addr-title">
                📍 <b>{location.title}</b>
              </p>
            )}
            <p>
              {inMecca ? (
                <b>بيتك داخل منطقة الخدمة في مكة المكرمة: نوصّل الطلب لبابك.</b>
              ) : (
                <b>بيتك خارج منطقة الخدمة: نشحن الطلب لك.</b>
              )}
            </p>
            <button type="button" className="linkbtn" onClick={() => openDialog()}>
              {addresses.length > 1 ? 'اختيار عنوان ثاني' : 'تعديل مكان الدبوس'}
            </button>
            {skipped > 0 && (
              <p className="notice warn">
                {skipped === 1 ? 'منتج في سلتك غير متاح لموقعك' : `${skipped} منتجات في سلتك غير متاحة لموقعك`} (خدمات داخل مكة فقط، أو لم تعد متوفرة)، ولن
                تدخل في الطلب.
              </p>
            )}
          </section>

          <section className="card co-step">
            <h2 className="h3">
              <span className="co-n">2</span> بياناتك والعنوان
            </h2>
            <div className="field">
              <label htmlFor="co-name">الاسم الكامل</label>
              <input id="co-name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            </div>
            {inMecca ? (
              <div className="field">
                <label htmlFor="co-hood">الحي</label>
                <input
                  id="co-hood"
                  className="input"
                  list="co-hoods"
                  autoComplete="address-level3"
                  value={hood}
                  onChange={(e) => setHood(e.target.value)}
                  maxLength={80}
                  placeholder={lookup === 'busy' ? 'نقرأ الحي من الخريطة…' : 'اسم الحي'}
                />
                <datalist id="co-hoods">
                  {hoods.map((h) => (
                    <option key={h.id} value={h.name_ar} />
                  ))}
                </datalist>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="co-city">المدينة</label>
                <input id="co-city" className="input" autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} />
              </div>
            )}
            <div className="field">
              <label htmlFor="co-street">
                {inMecca ? 'الشارع ورقم البيت' : 'عنوان الشحن (الحي، الشارع، رقم البيت)'} {inMecca && <span className="muted">(اختياري)</span>}
              </label>
              <input id="co-street" className="input" autoComplete="street-address" value={street} onChange={(e) => setStreet(e.target.value)} maxLength={300} />
            </div>
            <div className="field">
              <label htmlFor="co-notes">
                وصف المبنى <span className="muted">(يساعد المندوب{needsVisit ? ' والفني' : ''} يوصل)</span>
              </label>
              <input id="co-notes" className="input" placeholder="مثال: عمارة بيضاء، الدور الثاني" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
            </div>
            {lookup === 'done' && <p className="muted">عبّينا العنوان من مكان الدبوس، عدّله إذا فيه شي غلط.</p>}
            {lookup === 'none' && <p className="muted">ما قدرنا نقرأ العنوان من الخريطة، اكتبه بنفسك.</p>}
            <p className="muted">نتواصل معك على جوالك {customer.phone.replace('+966', '0')} لتأكيد الطلب.</p>
          </section>

          <section className="card co-step">
            <h2 className="h3">
              <span className="co-n">3</span> {inMecca ? 'التوصيل والتركيب' : 'الشحن'}
            </h2>
            {!inMecca ? (
              <p>
                شحن إلى {city || 'مدينتك'} برسوم {formatSar(round2(shipping * (1 + vat)))} للطلب شامل الضريبة.
              </p>
            ) : installUnits > 0 ? (
              <fieldset className="co-options">
                <legend className="sr-only">طريقة الاستلام</legend>
                <label className={install ? 'on' : undefined}>
                  <input type="radio" name="fulfillment" checked={install} onChange={() => setInstall(true)} />
                  <span>
                    <b>توصيل وتركيب</b>
                    <small>
                      فني يركّب الجهاز في بيتك: {formatSar(round2(Number(settings.install_fee) * (1 + vat)))} لكل جهاز شامل الضريبة
                      {installUnits > 1 ? ` (${installUnits} أجهزة)` : ''}.
                    </small>
                  </span>
                </label>
                <label className={!install ? 'on' : undefined}>
                  <input type="radio" name="fulfillment" checked={!install} onChange={() => setInstall(false)} />
                  <span>
                    <b>توصيل فقط</b>
                    <small>نوصّل الطلب لبيتك بدون تركيب.</small>
                  </span>
                </label>
              </fieldset>
            ) : (
              <p>نوصّل الطلب لبيتك داخل مكة المكرمة.</p>
            )}

            {needsVisit && (
              <div className="field">
                <label htmlFor="co-day">{withInstall ? 'اليوم المناسب للتركيب' : 'اليوم المناسب للزيارة'}</label>
                <select id="co-day" className="input" value={visit} onChange={(e) => setVisit(e.target.value)}>
                  <option value="">اختر اليوم</option>
                  {days.map((d) => (
                    <option key={d.date} value={d.date}>
                      {d.label}
                    </option>
                  ))}
                </select>
                <span className="muted">هذا اليوم اللي يناسبك، ونتصل عليك نأكد الموعد والوقت.</span>
              </div>
            )}

            <div className="field">
              <label htmlFor="co-order-notes">
                ملاحظات على الطلب <span className="muted">(اختياري)</span>
              </label>
              <textarea id="co-order-notes" className="input area" rows={2} value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} maxLength={500} />
            </div>
          </section>
        </div>

        <aside className="card cart-summary" aria-label="ملخص الطلب">
          <h2 className="h3">
            <span className="co-n">4</span> مراجعة الطلب
          </h2>
          <ul className="co-items">
            {rows.map((r) => (
              <li key={r.line.productId}>
                <span>
                  {r.product!.name_ar} {r.line.qty > 1 && <span className="muted">× {r.line.qty}</span>}
                </span>
                <span>{formatSar(round2(Number(r.product!.price_before_vat) * r.line.qty))}</span>
              </li>
            ))}
          </ul>
          <dl>
            <div>
              <dt>المجموع قبل الضريبة</dt>
              <dd>{formatSar(subtotal)}</dd>
            </div>
            {installFee > 0 && (
              <div>
                <dt>التركيب</dt>
                <dd>{formatSar(installFee)}</dd>
              </div>
            )}
            {shipping > 0 && (
              <div>
                <dt>الشحن</dt>
                <dd>{formatSar(shipping)}</dd>
              </div>
            )}
            <div>
              <dt>ضريبة القيمة المضافة ({Math.round(vat * 100)}٪)</dt>
              <dd>{formatSar(vatAmount)}</dd>
            </div>
            <div className="grand">
              <dt>الإجمالي</dt>
              <dd>{formatSar(total)}</dd>
            </div>
          </dl>
          <AddressConfirm
            heading={withInstall || hasService ? 'يوصل الطلب والفني إلى' : inMecca ? 'يوصل الطلب إلى' : 'يُشحن الطلب إلى'}
            title={location.title ?? (inMecca ? hood.trim() || 'مكة المكرمة' : city.trim() || location.city)}
            lines={[inMecca ? [hood.trim(), street.trim()].filter(Boolean).join('، ') : street.trim(), notes.trim()]}
            lat={location.lat}
            lng={location.lng}
            onChange={() => openDialog()}
          />
          {needsConsent && (
            <label className="check">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
              <span>
                أوافق على{' '}
                <Link to="/pages/terms" className="link" target="_blank">
                  الشروط والأحكام
                </Link>{' '}
                و
                <Link to="/pages/privacy" className="link" target="_blank">
                  سياسة الخصوصية
                </Link>
              </span>
            </label>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn block" disabled={busy || !rows.length}>
            {busy ? 'جاري إنشاء الطلب…' : 'العنوان صحيح، أكّد الطلب'}
          </button>
          <p className="muted center">بعد التأكيد يكون طلبك بانتظار الدفع لمدة 24 ساعة.</p>
          <Link to="/cart" className="link center">
            الرجوع للسلة
          </Link>
        </aside>
      </form>
    </>
  )
}
