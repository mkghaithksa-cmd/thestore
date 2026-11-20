import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { addressErrorMessage, addressTitle, LABEL_CHOICES, MAX_ADDRESSES, removeAddress, saveAddress, type SavedAddress } from '../lib/addresses'
import { addressFromPin } from '../lib/geocode'
import { fromSaved, useLocationChoice } from '../lib/location'
import { usePageMeta } from '../lib/seo'

const MapPicker = lazy(() => import('../components/MapPicker'))

interface Draft {
  id: string | null
  label: string
  lat: number | null
  lng: number | null
  hood: string
  street: string
  note: string
}

const emptyDraft: Draft = { id: null, label: '', lat: null, lng: null, hood: '', street: '', note: '' }

/** «عناويني»: up to 5 addresses, one of them the main one. */
export function Addresses() {
  usePageMeta('عناويني')
  const { addresses, customerId, reloadAddresses, location, set, clear } = useLocationChoice()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    reloadAddresses()
  }, [reloadAddresses])

  if (!customerId) {
    return (
      <div className="notice">
        <b>عناويني متاحة لحسابات العملاء.</b>
      </div>
    )
  }

  const startNew = () => {
    setMsg('')
    setError('')
    setDraft({ ...emptyDraft, label: addresses.length === 0 ? 'البيت' : '' })
    setMapOpen(true)
  }
  const startEdit = (a: SavedAddress) => {
    setMsg('')
    setError('')
    setDraft({ id: a.id, label: a.label ?? '', lat: a.lat, lng: a.lng, hood: a.neighborhood_name ?? '', street: a.street ?? '', note: a.building_note ?? '' })
    setMapOpen(false)
  }

  const pinned = (lat: number, lng: number) => {
    setMapOpen(false)
    setDraft((d) => (d ? { ...d, lat, lng } : d))
    // Fill the neighbourhood and street from the pin when they are empty.
    addressFromPin(lat, lng).then((a) => {
      if (!a) return
      setDraft((d) => (d ? { ...d, hood: d.hood || a.neighborhood || '', street: d.street || a.street || '' } : d))
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!draft || draft.lat === null || draft.lng === null) return setError('حدد المكان على الخريطة.')
    setBusy(true)
    setError('')
    try {
      const id = await saveAddress({
        id: draft.id,
        label: draft.label.trim() || null,
        lat: draft.lat,
        lng: draft.lng,
        neighborhood_name: draft.hood,
        street: draft.street,
        building_note: draft.note,
      })
      const list = await reloadAddresses()
      const saved = list.find((a) => a.id === id)
      // The address in use follows its edit.
      if (saved && (location?.addressId === id || !location)) set(fromSaved(saved))
      setMsg(draft.id ? 'انحفظ التعديل ✓' : 'انضاف العنوان ✓')
      setDraft(null)
    } catch (err) {
      setError(addressErrorMessage(err instanceof Error ? err.message : null))
    } finally {
      setBusy(false)
    }
  }

  async function makeMain(a: SavedAddress) {
    setBusy(true)
    try {
      await saveAddress({ id: a.id, lat: a.lat, lng: a.lng, label: a.label, neighborhood_name: a.neighborhood_name, street: a.street, building_note: a.building_note, makeDefault: true })
      await reloadAddresses()
      set(fromSaved({ ...a, is_default: true }))
      setMsg(`«${addressTitle(a)}» صار العنوان الأساسي ✓`)
    } catch (err) {
      setError(addressErrorMessage(err instanceof Error ? err.message : null))
    } finally {
      setBusy(false)
    }
  }

  async function remove(a: SavedAddress) {
    if (!window.confirm(`حذف «${addressTitle(a)}» من عناويني؟ الطلبات القديمة ما تتأثر.`)) return
    setBusy(true)
    try {
      await removeAddress(a.id)
      const list = await reloadAddresses()
      if (location?.addressId === a.id) {
        const main = list.find((x) => x.is_default) ?? list[0]
        if (main) set(fromSaved(main))
        else clear()
      }
      setMsg('انحذف العنوان.')
    } catch {
      setError('تعذّر الحذف. حاول مرة ثانية.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack narrow">
      <div className="row between wrapr">
        <h1 className="page-h">عناويني</h1>
        <Link to="/account" className="link">
          حسابي
        </Link>
      </div>
      <p className="muted">نستخدم العنوان الأساسي تلقائياً في الطلبات والصيانة، وتقدر تختار غيره وقت الطلب. لحد {MAX_ADDRESSES} عناوين.</p>

      {msg && <p className="notice ok">{msg}</p>}

      {addresses.length === 0 && !draft && (
        <div className="empty-state card">
          <b>ما عندك عناوين محفوظة.</b>
          <span className="muted">أضف عنوان بيتك مرة وحدة، وما نسألك عنه بعدها.</span>
          <button className="btn" onClick={startNew}>
            + أضف عنوانك
          </button>
        </div>
      )}

      <ul className="addr-list">
        {addresses.map((a) =>
          draft?.id === a.id ? null : (
            <li key={a.id} className={`card addr-card${a.is_default ? ' main' : ''}`}>
              <div className="row between wrapr">
                <b className="addr-name">{addressTitle(a)}</b>
                <span className="row wrapr">
                  {a.is_default && <span className="tag">الأساسي</span>}
                  <span className={`tag ${a.in_service_area ? "ok" : "off"}`}>{a.in_service_area ? 'داخل منطقة الخدمة' : 'خارج مكة: شحن فقط'}</span>
                </span>
              </div>
              {a.street && <span>{a.street}</span>}
              {a.building_note ? (
                <span className="muted">وصف المبنى: {a.building_note}</span>
              ) : (
                <span className="warn-text">ما فيه وصف للمبنى. أضفه عشان يوصل المندوب والفني بسهولة.</span>
              )}
              <div className="row wrapr addr-actions">
                <button className="btn sm ghost" disabled={busy} onClick={() => startEdit(a)}>
                  تعديل
                </button>
                {!a.is_default && (
                  <button className="btn sm ghost" disabled={busy} onClick={() => makeMain(a)}>
                    اجعله الأساسي
                  </button>
                )}
                <button className="linkbtn danger" disabled={busy} onClick={() => remove(a)}>
                  حذف
                </button>
              </div>
            </li>
          ),
        )}
      </ul>

      {draft && (
        <form className="card stack" onSubmit={submit} noValidate>
          <b>{draft.id ? 'تعديل العنوان' : 'عنوان جديد'}</b>
          {mapOpen ? (
            <Suspense fallback={<div className="map-loading">جاري تحميل الخريطة…</div>}>
              <MapPicker
                initial={draft.lat !== null && draft.lng !== null ? { lat: draft.lat, lng: draft.lng } : null}
                onConfirm={pinned}
                onCancel={() => (draft.lat === null ? setDraft(null) : setMapOpen(false))}
                cancelLabel={draft.lat === null ? 'إلغاء' : 'رجوع'}
              />
            </Suspense>
          ) : (
            <>
              <div className="row between wrapr">
                <span className="muted">{draft.lat !== null ? '📍 المكان محدد على الخريطة' : 'ما تحدد المكان'}</span>
                <button type="button" className="linkbtn" onClick={() => setMapOpen(true)}>
                  {draft.lat !== null ? 'تعديل مكان الدبوس' : 'حدد على الخريطة'}
                </button>
              </div>
              <div className="field">
                <span className="field-label">اسم العنوان</span>
                <div className="chips">
                  {LABEL_CHOICES.map((l) => (
                    <button key={l} type="button" className={draft.label === l ? 'on' : undefined} onClick={() => setDraft({ ...draft, label: l })}>
                      {l}
                    </button>
                  ))}
                </div>
                <input className="input" aria-label="اسم العنوان" placeholder="أو اكتب اسم ثاني" maxLength={50} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ad-hood">الحي</label>
                <input id="ad-hood" className="input" maxLength={80} value={draft.hood} onChange={(e) => setDraft({ ...draft, hood: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ad-street">
                  الشارع ورقم البيت <span className="muted">(اختياري)</span>
                </label>
                <input id="ad-street" className="input" maxLength={300} value={draft.street} onChange={(e) => setDraft({ ...draft, street: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ad-note">وصف المبنى</label>
                <input id="ad-note" className="input" placeholder="مثال: عمارة بيضاء، الدور الثاني، الباب البني" maxLength={200} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
                <span className="muted">يساعد المندوب والفني يوصلون لك بدون اتصال.</span>
              </div>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="row wrapr">
                <button className="btn" disabled={busy}>
                  {busy ? 'جاري الحفظ…' : 'حفظ'}
                </button>
                <button type="button" className="btn ghost" onClick={() => setDraft(null)}>
                  إلغاء
                </button>
              </div>
            </>
          )}
        </form>
      )}

      {!draft && addresses.length > 0 && addresses.length < MAX_ADDRESSES && (
        <button className="btn ghost block" onClick={startNew}>
          + أضف عنوان ثاني
        </button>
      )}
      {!draft && error && <p className="form-error">{error}</p>}
    </div>
  )
}
