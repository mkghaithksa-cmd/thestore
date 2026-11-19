import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { fillReminder, serviceErrorMessage, type StoreSettings } from '@ghaith/shared'
import { riyadhDate } from '../lib/service'
import { RequirePage } from '../components/Layout'
import { fetchSettings } from '../lib/catalog'
import { parseAmount } from '../lib/format'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

interface WorkDay {
  day_of_week: number
  name_ar: string
  is_working: boolean
  start_time: string | null
  end_time: string | null
}

interface Neighborhood {
  id: string
  name_ar: string
  is_active: boolean
  sort_order: number
}

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '')
const errText = (m: string) =>
  m.includes('row-level security') || m.includes('permission denied')
    ? 'لا تملك صلاحية تعديل الإعدادات.'
    : m.includes('duplicate')
      ? 'الاسم موجود مسبقاً.'
      : m.includes('invalid_name')
        ? 'الاسم قصير جداً.'
        : 'تعذّر الحفظ. حاول مرة أخرى.'

/** VAT, fees, inspection rule and maintenance alert. */
function FeesCard({ settings, canEdit, onSaved }: { settings: StoreSettings; canEdit: boolean; onSaved: () => void }) {
  const [vat, setVat] = useState(String(Math.round(settings.vat_rate * 10000) / 100))
  const [install, setInstall] = useState(String(settings.install_fee))
  const [inspection, setInspection] = useState(String(settings.inspection_fee))
  const [shipping, setShipping] = useState(String(settings.shipping_fee))
  const [chargeAbsent, setChargeAbsent] = useState(settings.charge_inspection_if_absent)
  const [vatNo, setVatNo] = useState(settings.seller_vat_number ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const v = parseAmount(vat)
    const fees = [install, inspection, shipping].map(parseAmount)
    if (!(v >= 0 && v < 100)) return setMsg({ ok: false, text: 'نسبة الضريبة بين 0 و 99.' })
    if (fees.some((f) => !(f >= 0))) return setMsg({ ok: false, text: 'الرسوم أرقام صفر أو أكثر.' })
    if (vatNo && !/^3\d{13}3$/.test(vatNo)) return setMsg({ ok: false, text: 'الرقم الضريبي 15 رقم، يبدأ وينتهي بـ 3.' })
    setBusy(true)
    setMsg(null)
    const { error } = await supabase
      .from('settings')
      .update({
        vat_rate: Math.round(v * 100) / 10000,
        install_fee: fees[0],
        inspection_fee: fees[1],
        shipping_fee: fees[2],
        charge_inspection_if_absent: chargeAbsent,
        seller_vat_number: vatNo || null,
      })
      .eq('id', 1)
    setBusy(false)
    if (error) return setMsg({ ok: false, text: errText(error.message) })
    setMsg({ ok: true, text: 'تم الحفظ ✓ يظهر في المتجر فوراً.' })
    onSaved()
  }

  const money = (id: string, label: string, value: string, set: (v: string) => void, hint?: string) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input num" inputMode="decimal" dir="ltr" value={value} onChange={(e) => set(e.target.value)} />
      {hint && <span className="muted">{hint}</span>}
    </div>
  )

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <h2 className="h3">الضريبة والرسوم</h2>
      <fieldset className="plain" disabled={!canEdit || busy}>
        <div className="grid-form">
          {money('vat', 'ضريبة القيمة المضافة (٪)', vat, setVat)}
          {money('install', 'رسوم التركيب (ر.س، قبل الضريبة)', install, setInstall, 'داخل مكة فقط')}
          {money('inspection', 'رسوم الفحص (ر.س، قبل الضريبة)', inspection, setInspection, 'للبلاغ الطارئ')}
          {money('shipping', 'رسوم الشحن (ر.س، قبل الضريبة)', shipping, setShipping, 'لخارج مكة')}
          <div className="field">
            <label htmlFor="vatno">الرقم الضريبي للمؤسسة</label>
            <input id="vatno" className="input num" inputMode="numeric" dir="ltr" maxLength={15} value={vatNo} onChange={(e) => setVatNo(e.target.value.replace(/\D/g, ''))} />
            <span className="muted">يظهر في فاتورة العميل مع رمز QR حسب هيئة الزكاة. اتركه فاضي إذا ما عندكم.</span>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={chargeAbsent} onChange={(e) => setChargeAbsent(e.target.checked)} />
          نحسب رسوم الفحص إذا وصل الفني والعميل غير موجود
        </label>
      </fieldset>
      {msg && <p className={msg.ok ? 'ok-text' : 'form-error'}>{msg.text}</p>}
      {canEdit && (
        <button className="btn self-start" disabled={busy}>
          {busy ? 'جاري الحفظ…' : 'حفظ'}
        </button>
      )}
    </form>
  )
}

function WorkDaysCard({ days, canEdit, onSaved }: { days: WorkDay[]; canEdit: boolean; onSaved: () => void }) {
  const [rows, setRows] = useState(days.map((d) => ({ ...d, start_time: hhmm(d.start_time), end_time: hhmm(d.end_time) })))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)))

  async function save() {
    for (const r of rows) {
      if (r.is_working && (!r.start_time || !r.end_time || r.end_time <= r.start_time))
        return setMsg({ ok: false, text: `يوم ${r.name_ar}: وقت النهاية يجب أن يكون بعد البداية.` })
    }
    setBusy(true)
    setMsg(null)
    const changed = rows.filter((r, i) => {
      const o = days[i]
      return r.is_working !== o.is_working || r.start_time !== hhmm(o.start_time) || r.end_time !== hhmm(o.end_time)
    })
    const results = await Promise.all(
      changed.map((r) =>
        supabase
          .from('work_days')
          .update({ is_working: r.is_working, start_time: r.is_working ? r.start_time : null, end_time: r.is_working ? r.end_time : null })
          .eq('day_of_week', r.day_of_week),
      ),
    )
    setBusy(false)
    const failed = results.find((r) => r.error)
    if (failed?.error) return setMsg({ ok: false, text: errText(failed.error.message) })
    setMsg({ ok: true, text: 'تم الحفظ ✓' })
    onSaved()
  }

  return (
    <section className="card stack">
      <h2 className="h3">أيام العمل وساعاته</h2>
      <span className="muted">منها نعرض للعميل المواعيد المتاحة للتركيب والصيانة.</span>
      <div className="tw">
        <table>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.day_of_week} className={r.is_working ? '' : 'dim'}>
                <td>
                  <b>{r.name_ar}</b>
                </td>
                <td>
                  <label className="check tight">
                    <input type="checkbox" disabled={!canEdit} checked={r.is_working} onChange={(e) => set(i, { is_working: e.target.checked, start_time: r.start_time || '09:00', end_time: r.end_time || '21:00' })} />
                    {r.is_working ? 'يوم عمل' : 'إجازة'}
                  </label>
                </td>
                <td>
                  {r.is_working && (
                    <div className="row">
                      <input type="time" className="input sm" dir="ltr" disabled={!canEdit} value={r.start_time} onChange={(e) => set(i, { start_time: e.target.value })} aria-label={`بداية ${r.name_ar}`} />
                      <span className="muted">إلى</span>
                      <input type="time" className="input sm" dir="ltr" disabled={!canEdit} value={r.end_time} onChange={(e) => set(i, { end_time: e.target.value })} aria-label={`نهاية ${r.name_ar}`} />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg && <p className={msg.ok ? 'ok-text' : 'form-error'}>{msg.text}</p>}
      {canEdit && (
        <button className="btn self-start" disabled={busy} onClick={save}>
          {busy ? 'جاري الحفظ…' : 'حفظ أيام العمل'}
        </button>
      )}
    </section>
  )
}

function NeighborhoodsCard({ list, canAdd, canEdit, onSaved }: { list: Neighborhood[]; canAdd: boolean; canEdit: boolean; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const { error: err } = await supabase
      .from('service_neighborhoods')
      .insert({ name_ar: name, sort_order: Math.max(0, ...list.map((n) => n.sort_order)) + 1 })
    if (err) return setError(errText(err.message))
    setName('')
    onSaved()
  }

  async function toggle(n: Neighborhood) {
    setError(null)
    const { error: err } = await supabase.from('service_neighborhoods').update({ is_active: !n.is_active }).eq('id', n.id)
    if (err) setError(errText(err.message))
    else onSaved()
  }

  async function rename(n: Neighborhood, value: string) {
    if (value.trim() === n.name_ar) return
    setError(null)
    const { error: err } = await supabase.from('service_neighborhoods').update({ name_ar: value }).eq('id', n.id)
    if (err) setError(errText(err.message))
    else onSaved()
  }

  const active = list.filter((n) => n.is_active).length

  return (
    <section className="card stack">
      <h2 className="h3">الأحياء المخدومة في مكة</h2>
      <span className="muted">
        تظهر للعميل عند اختيار عنوانه. المفعّل {active} من {list.length}. الإيقاف يخفي الحي ولا يحذفه.
      </span>
      {canAdd && (
        <form className="row wrapr align-end" onSubmit={add}>
          <div className="field grow">
            <label htmlFor="nh">حي جديد</label>
            <input id="nh" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button className="btn field-btn" disabled={name.trim().length < 2}>
            إضافة
          </button>
        </form>
      )}
      <div className="nh-list">
        {list.map((n) => (
          <div key={n.id} className={`nh${n.is_active ? '' : ' off'}`}>
            <input className="input sm grow" defaultValue={n.name_ar} disabled={!canEdit} onBlur={(e) => rename(n, e.target.value)} aria-label="اسم الحي" />
            {canEdit && (
              <button className="btn sm ghost" onClick={() => toggle(n)}>
                {n.is_active ? 'إيقاف' : 'تفعيل'}
              </button>
            )}
          </div>
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
    </section>
  )
}

function FaultTypesCard({ list, canEdit, onSaved }: { list: string[]; canEdit: boolean; onSaved: () => void }) {
  const [items, setItems] = useState(list)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => setItems(list), [list])
  const dirty = items.join('|') !== list.join('|')

  async function save() {
    setError(null)
    setSaved(false)
    const { error: err } = await supabase.from('settings').update({ fault_types: items }).eq('id', 1)
    if (err) return setError(err.message.includes('invalid_fault_types') ? 'كل نوع من 2 إلى 40 حرف، وخلّ نوع واحد على الأقل.' : errText(err.message))
    setSaved(true)
    onSaved()
  }
  const move = (i: number, by: number) => {
    const next = [...items]
    const [x] = next.splice(i, 1)
    next.splice(i + by, 0, x)
    setItems(next)
  }

  return (
    <section className="card stack">
      <h2 className="h3">أنواع الأعطال</h2>
      <span className="muted">تظهر للعميل في نموذج «بلاغ عطل» وللموظف في البلاغ الهاتفي. البلاغات القديمة تحتفظ بنوعها حتى لو حذفته.</span>
      <ol className="ft-list">
        {items.map((t, i) => (
          <li key={t} className="row">
            <span className="grow">{t}</span>
            {canEdit && (
              <>
                <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`رفع ${t}`}>
                  ↑
                </button>
                <button type="button" className="btn sm ghost" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={`تنزيل ${t}`}>
                  ↓
                </button>
                <button type="button" className="linkbtn" disabled={items.length === 1} onClick={() => setItems(items.filter((x) => x !== t))}>
                  حذف
                </button>
              </>
            )}
          </li>
        ))}
      </ol>
      {canEdit && (
        <>
          <form
            className="row wrapr align-end"
            onSubmit={(e) => {
              e.preventDefault()
              const v = name.trim().replace(/\s+/g, ' ')
              if (v.length < 2 || v.length > 40 || items.includes(v)) return
              setItems([...items, v])
              setName('')
            }}
          >
            <div className="field grow">
              <label htmlFor="ft">نوع عطل جديد</label>
              <input id="ft" className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <button className="btn sm ghost field-btn" disabled={name.trim().length < 2}>
              إضافة للقائمة
            </button>
          </form>
          <div className="row">
            <button type="button" className="btn self-start" disabled={!dirty} onClick={save}>
              حفظ أنواع الأعطال
            </button>
            {saved && !dirty && <span className="ok-text">تم الحفظ ✓</span>}
          </div>
        </>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  )
}

function FilterLifeCard({ value, canEdit, onSaved }: { value: number; canEdit: boolean; onSaved: () => void }) {
  const [v, setV] = useState(String(value))
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => setV(String(value)), [value])

  async function save(e: FormEvent) {
    e.preventDefault()
    const n = Number(v)
    if (!Number.isInteger(n) || n < 1 || n > 60) return setError('اكتب عدد أشهر من 1 إلى 60.')
    setError(null)
    const { error: err } = await supabase.from('settings').update({ default_filter_life_months: n }).eq('id', 1)
    if (err) return setError(errText(err.message))
    setSaved(true)
    onSaved()
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h2 className="h3">عمر الفلاتر الافتراضي</h2>
      <span className="muted">
        للأجهزة اللي ما نعرف فلاترها (أجهزة الشركات الأخرى، أو موديلات ما سجّلنا فلاترها). ينحسب منه موعد التذكير، والفني يعدّله لكل جهاز بعد الزيارة.
        يطبّق على الأجهزة اللي تنضاف بعد الحفظ.
      </span>
      <div className="row wrapr align-end">
        <div className="field">
          <label htmlFor="dfl">بالأشهر</label>
          <input id="dfl" className="input num" inputMode="numeric" style={{ width: 100 }} disabled={!canEdit} value={v} onChange={(e) => { setSaved(false); setV(e.target.value.replace(/[^0-9]/g, '')) }} />
        </div>
        {canEdit && (
          <button className="btn field-btn" disabled={v === String(value)}>
            حفظ
          </button>
        )}
        {saved && v === String(value) && <span className="ok-text field-btn">تم الحفظ ✓</span>}
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  )
}

const REMINDER_TAGS = ['{الاسم}', '{الجهاز}', '{الفلاتر}', '{الموعد}']

/** «تذكير الفلاتر»: on/off, the from–to window, after a decline, and the WhatsApp text. */
function RemindersCard({ settings, canEdit, onSaved }: { settings: StoreSettings; canEdit: boolean; onSaved: () => void }) {
  const [on, setOn] = useState(settings.maintenance_reminders_on ?? true)
  const [before, setBefore] = useState(String(settings.maintenance_alert_days))
  const [keepAfter, setKeepAfter] = useState((settings.maintenance_overdue_days ?? 60) > 0)
  const [after, setAfter] = useState(String(settings.maintenance_overdue_days || 60))
  const [decline, setDecline] = useState(String(settings.maintenance_decline_days ?? 90))
  const [message, setMessage] = useState(settings.maintenance_wa_message ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const digits = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setMsg(null)
    set(e.target.value.replace(/[^0-9]/g, ''))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const b = Number(before)
    const a = keepAfter ? Number(after) : 0
    const d = Number(decline)
    if (!before || b > 180) return setMsg({ ok: false, text: 'بداية التذكير من 0 إلى 180 يوم قبل الموعد.' })
    if (keepAfter && (!after || a < 1 || a > 365)) return setMsg({ ok: false, text: 'نهاية التذكير من 1 إلى 365 يوم بعد الموعد.' })
    if (!decline || d < 7 || d > 365) return setMsg({ ok: false, text: 'بعد الرفض من 7 إلى 365 يوم.' })
    if (message.trim().length < 10 || message.trim().length > 500) return setMsg({ ok: false, text: 'نص الرسالة من 10 إلى 500 حرف.' })
    setBusy(true)
    setMsg(null)
    const { error } = await supabase
      .from('settings')
      .update({
        maintenance_reminders_on: on,
        maintenance_alert_days: b,
        maintenance_overdue_days: a,
        maintenance_decline_days: d,
        maintenance_wa_message: message.trim(),
      })
      .eq('id', 1)
    setBusy(false)
    if (error) return setMsg({ ok: false, text: errText(error.message) })
    setMsg({ ok: true, text: 'تم الحفظ ✓' })
    onSaved()
  }

  const preview = fillReminder(message, { name: 'محمد', device: 'منقي تحت المغسلة', filters: ['طقم الفلاتر'], due: riyadhDate(5) })

  return (
    <form className="card stack" onSubmit={save}>
      <h2 className="h3">تذكير الفلاتر</h2>
      <span className="muted">
        يحدد متى يظهر الجهاز في «الصيانة المستحقة» عند الموظفين، ومتى يشوف العميل تنبيه «حان وقت تغيير الفلاتر» في «أجهزتي».
      </span>
      <fieldset className="plain stack" disabled={!canEdit || busy}>
        <label className="check">
          <input type="checkbox" checked={on} onChange={(e) => { setMsg(null); setOn(e.target.checked) }} />
          التذكير شغّال
        </label>
        {on && (
          <>
            <div className="row wrapr align-end">
              <div className="field">
                <label htmlFor="rem-from">يبدأ قبل موعد الفلتر بـ (يوم)</label>
                <input id="rem-from" className="input num" inputMode="numeric" dir="ltr" style={{ width: 100 }} value={before} onChange={digits(setBefore)} />
              </div>
              <div className="field">
                <span>وينتهي</span>
                <div className="seg">
                  <button type="button" className={!keepAfter ? 'on' : undefined} onClick={() => { setMsg(null); setKeepAfter(false) }}>
                    لين يتغيّر الفلتر
                  </button>
                  <button type="button" className={keepAfter ? 'on' : undefined} onClick={() => { setMsg(null); setKeepAfter(true) }}>
                    بعد عدد أيام
                  </button>
                </div>
              </div>
              {keepAfter && (
                <div className="field">
                  <label htmlFor="rem-to">بعد الموعد بـ (يوم)</label>
                  <input id="rem-to" className="input num" inputMode="numeric" dir="ltr" style={{ width: 100 }} value={after} onChange={digits(setAfter)} />
                </div>
              )}
            </div>
            <p className="inset-box">
              يعني: الجهاز يظهر للتذكير من <b>{before || '…'} يوم قبل</b> موعد تغيير الفلتر،{' '}
              {keepAfter ? (
                <>
                  ويختفي إذا مرّ <b>{after || '…'} يوم بعد</b> الموعد وما تغيّر.
                </>
              ) : (
                <>ويبقى لين يتغيّر الفلتر أو يتسجل رد العميل.</>
              )}
            </p>
            <div className="field">
              <label htmlFor="rem-dec">إذا رفض العميل، يرجع للقائمة بعد (يوم)</label>
              <input id="rem-dec" className="input num" inputMode="numeric" dir="ltr" style={{ width: 100 }} value={decline} onChange={digits(setDecline)} />
            </div>
            <div className="field">
              <label htmlFor="rem-msg">رسالة الواتساب</label>
              <textarea id="rem-msg" className="input" rows={3} maxLength={500} value={message} onChange={(e) => { setMsg(null); setMessage(e.target.value) }} />
              <span className="muted">
                تقدر تحط:{' '}
                {REMINDER_TAGS.map((t) => (
                  <button key={t} type="button" className="linkbtn" style={{ marginInlineEnd: 10 }} onClick={() => setMessage((m) => `${m}${m.endsWith(' ') || !m ? '' : ' '}${t}`)}>
                    {t}
                  </button>
                ))}
              </span>
              <span className="muted">مثال: {preview}</span>
            </div>
          </>
        )}
      </fieldset>
      {msg && <p className={msg.ok ? 'ok-text' : 'form-error'}>{msg.text}</p>}
      {canEdit && (
        <button className="btn self-start" disabled={busy}>
          {busy ? 'جاري الحفظ…' : 'حفظ'}
        </button>
      )}
    </form>
  )
}

interface TechRow {
  id: string
  full_name: string
  phone: string
  is_active: boolean
}

/** «الفنيين»: name and phone. They have no account; each visit gets a link. */
function TechniciansCard({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<TechRow[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    supabase
      .from('technicians')
      .select('id, full_name, phone, is_active')
      .order('is_active', { ascending: false })
      .order('full_name')
      .then(({ data }) => setRows((data ?? []) as TechRow[]))
  }, [])
  useEffect(load, [load])

  async function save(id: string | null, n: string, p: string, active: boolean) {
    setBusy(true)
    setError(null)
    const { error: e } = await supabase.rpc('technician_save', { p_id: id, p_name: n, p_phone: p, p_active: active })
    setBusy(false)
    if (e) {
      setError(serviceErrorMessage(e.message))
      return false
    }
    load()
    return true
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (await save(null, name, phone, true)) {
      setName('')
      setPhone('')
    }
  }

  return (
    <section className="card stack">
      <h2 className="h3">الفنيين</h2>
      <span className="muted">
        الفني ما يحتاج حساب. لكل زيارة يوصله رابط واتساب يفتحه من جواله، وما يشوف فيه الأسعار. الفني الموقّف ما يظهر في اختيار الفني.
      </span>
      {rows.length === 0 ? (
        <p className="notice warn">ما فيه فنيين. أضف فني عشان تقدر تحدد الزيارات وترسل الروابط.</p>
      ) : (
        <ul className="stack-sm ft-list">
          {rows.map((t) => (
            <li key={t.id} className="row between wrapr">
              <span>
                <b className={t.is_active ? undefined : 'muted'}>{t.full_name}</b>{' '}
                <span className="muted" dir="ltr">
                  {t.phone.replace(/^\+966/, '0')}
                </span>
                {!t.is_active && <span className="muted"> · موقّف</span>}
              </span>
              {canEdit && (
                <button type="button" className="linkbtn" disabled={busy} onClick={() => save(t.id, t.full_name, t.phone, !t.is_active)}>
                  {t.is_active ? 'إيقاف' : 'تفعيل'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form className="row wrapr align-end" onSubmit={add}>
          <div className="field">
            <label htmlFor="tn">اسم الفني</label>
            <input id="tn" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tp">جواله</label>
            <input id="tp" className="input num" inputMode="tel" dir="ltr" placeholder="05xxxxxxxx" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <button className="btn field-btn" disabled={busy || !name.trim() || !phone.trim()}>
            إضافة فني
          </button>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  )
}

/** How long a technician link lasts. */
function WorkOrderRulesCard({ settings, canEdit, onSaved }: { settings: StoreSettings; canEdit: boolean; onSaved: () => void }) {
  const [hours, setHours] = useState(String(settings.technician_link_hours))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    const h = Number(hours)
    if (!Number.isInteger(h) || h < 1 || h > 168) return setMsg({ ok: false, text: 'مدة الرابط من 1 إلى 168 ساعة.' })
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.from('settings').update({ technician_link_hours: h }).eq('id', 1)
    setBusy(false)
    if (error) return setMsg({ ok: false, text: errText(error.message) })
    setMsg({ ok: true, text: 'تم الحفظ ✓' })
    onSaved()
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h2 className="h3">أوامر العمل والموافقات</h2>
      <fieldset className="plain" disabled={!canEdit || busy}>
        <div className="row wrapr align-end">
          <div className="field">
            <label htmlFor="lhrs">رابط الفني صالح لمدة (ساعة)</label>
            <input id="lhrs" className="input num" inputMode="numeric" dir="ltr" style={{ width: 100 }} value={hours} onChange={(e) => { setMsg(null); setHours(e.target.value.replace(/[^0-9]/g, '')) }} />
          </div>
        </div>
      </fieldset>
      <span className="muted">الخصم يطبّق مباشرة ويوصل للمدير تنبيه في سجل التدقيق. فرق العهدة وفرق الجرد يحتاجون موافقة مدير (والمدير يقدر يعتمد طلبه بنفسه).</span>
      {msg && <p className={msg.ok ? 'ok-text' : 'form-error'}>{msg.text}</p>}
      {canEdit && (
        <button className="btn self-start" disabled={busy}>
          حفظ
        </button>
      )}
    </form>
  )
}

export function Settings() {
  const { can } = useStaffAuth()
  const canEdit = can('settings', 'edit')
  const [settings, setSettings] = useState<StoreSettings | null>(null)
  const [days, setDays] = useState<WorkDay[]>([])
  const [hoods, setHoods] = useState<Neighborhood[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [s, d, n] = await Promise.all([
      fetchSettings(),
      supabase.from('work_days').select('*').order('day_of_week'),
      supabase.from('service_neighborhoods').select('id, name_ar, is_active, sort_order').order('sort_order').order('name_ar'),
    ])
    setSettings(s)
    setDays((d.data ?? []) as WorkDay[])
    setHoods((n.data ?? []) as Neighborhood[])
  }, [])

  useEffect(() => {
    load().catch(() => setError('تعذّر تحميل الإعدادات.'))
  }, [load])

  return (
    <RequirePage page="settings">
      <div className="ph">
        <div>
          <h1>الإعدادات</h1>
          <p>كل الأرقام هنا يقرأها المتجر مباشرة. كل تغيير يُسجَّل في سجل التدقيق باسم من غيّره.</p>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!settings ? (
        !error && <p className="muted">جاري التحميل…</p>
      ) : (
        <>
          {!canEdit && <p className="muted">عرض فقط — لا تملك صلاحية تعديل الإعدادات.</p>}
          <FeesCard settings={settings} canEdit={canEdit} onSaved={load} />
          <WorkDaysCard days={days} canEdit={canEdit} onSaved={load} />
          <NeighborhoodsCard list={hoods} canAdd={can('settings', 'add')} canEdit={canEdit} onSaved={load} />
          <FaultTypesCard list={settings.fault_types ?? []} canEdit={canEdit} onSaved={load} />
          <TechniciansCard canEdit={canEdit} />
          <WorkOrderRulesCard settings={settings} canEdit={canEdit} onSaved={load} />
          <RemindersCard settings={settings} canEdit={canEdit} onSaved={load} />
          <FilterLifeCard value={settings.default_filter_life_months ?? 6} canEdit={canEdit} onSaved={load} />
        </>
      )}
    </RequirePage>
  )
}
