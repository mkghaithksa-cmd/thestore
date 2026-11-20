import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DEVICE_KIND_LABELS,
  OPEN_SERVICE_STATUSES,
  SERVICE_KIND_LABELS,
  SERVICE_STATUS_LABELS,
  daysUntil,
  filterUsage,
  productPath,
  serviceErrorMessage,
  type DeviceFilter,
  type DeviceKind,
  type ServiceRequest,
} from '@ghaith/shared'
import { fetchSettings, mainImageUrl } from '../lib/catalog'
import { useCatalog } from '../lib/useCatalog'
import { formatDate } from '../lib/orders'
import { addMyDevice, fetchMyDevicesFull, fetchMyRequests, removeMyDevice, riyadhDate, snoozeMyDevice, type MyDeviceFull } from '../lib/service'
import { usePageMeta } from '../lib/seo'
import { useAsync } from '../lib/useAsync'

async function load() {
  const [devices, requests, settings] = await Promise.all([fetchMyDevicesFull(), fetchMyRequests(), fetchSettings()])
  return {
    devices,
    requests,
    alertDays: settings.maintenance_alert_days,
    // Reminder window from the dashboard settings: off, or until N days after the due date (0 = no end).
    remind: (due: string) =>
      settings.maintenance_reminders_on !== false &&
      daysUntil(due) <= settings.maintenance_alert_days &&
      (!settings.maintenance_overdue_days || daysUntil(due) >= -settings.maintenance_overdue_days),
  }
}

function FilterBar({ f, alertDays }: { f: DeviceFilter; alertDays: number }) {
  const used = filterUsage(f)
  const left = daysUntil(f.next_due_on)
  const tone = left < 0 ? 'bad' : left <= alertDays ? 'warn' : 'ok'
  return (
    <li className="fbar">
      <div className="row between wrapr">
        <span>{f.name_ar}</span>
        <span className={`muted fbar-due ${tone}`}>
          {left < 0 ? `متأخر ${-left} يوم` : left === 0 ? 'موعد تغييره اليوم' : `يتغيّر ${formatDate(f.next_due_on)}`}
        </span>
      </div>
      <div
        className={`fbar-track ${tone}`}
        role="meter"
        aria-label={`الباقي من عمر ${f.name_ar}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.max(0, 100 - Math.min(used, 100))}
      >
        <span style={{ width: `${Math.max(0, 100 - Math.min(used, 100))}%` }} />
      </div>
      <small className="muted">
        باقي من عمره {Math.max(0, 100 - Math.min(used, 100))}٪ · آخر تغيير {formatDate(f.last_changed_on)} · يعيش {f.life_months} {f.life_months > 10 ? 'شهر' : 'أشهر'}
      </small>
    </li>
  )
}

const SNOOZE = [
  { days: 14, label: 'أسبوعين' },
  { days: 30, label: 'شهر' },
  { days: 60, label: 'شهرين' },
]

/** The filter closest to its end decides the device's health. */
function health(d: MyDeviceFull, alertDays: number): { pct: number; tone: 'ok' | 'warn' | 'bad' | 'none'; text: string } {
  if (!d.filters.length) return { pct: 0, tone: 'none', text: 'بدون بيانات' }
  const worst = d.filters.reduce((a, f) => (filterUsage(f) > filterUsage(a) ? f : a))
  const pct = Math.max(0, 100 - Math.min(filterUsage(worst), 100))
  const left = daysUntil(d.filters[0].next_due_on)
  const tone = left < 0 ? 'bad' : left <= alertDays ? 'warn' : 'ok'
  return { pct, tone, text: tone === 'bad' ? 'متأخر' : tone === 'warn' ? 'قرّب' : 'ممتاز' }
}

function HealthRing({ pct, tone, text }: ReturnType<typeof health>) {
  const r = 22
  const c = 2 * Math.PI * r
  return (
    <div className={`ring ${tone}`} role="img" aria-label={`حالة الفلاتر: ${text}${tone === 'none' ? '' : `، باقي ${pct}٪`}`}>
      <svg viewBox="0 0 56 56" aria-hidden="true">
        <circle cx="28" cy="28" r={r} className="ring-bg" />
        {tone !== 'none' && <circle cx="28" cy="28" r={r} className="ring-fg" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 28 28)" />}
      </svg>
      <span>
        {tone === 'none' ? '—' : `${pct}٪`}
        <small>{text}</small>
      </span>
    </div>
  )
}

function DeviceCard({
  d,
  open,
  history,
  img,
  alertDays,
  remind,
  onChange,
}: {
  d: MyDeviceFull
  open: ServiceRequest | undefined
  history: ServiceRequest[]
  img: string | null
  alertDays: number
  remind: (due: string) => boolean
  onChange: () => void
}) {
  const h = health(d, alertDays)
  const [snoozing, setSnoozing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = riyadhDate()
  const nextDue = d.filters[0]?.next_due_on
  const dueSoon = nextDue !== undefined && remind(nextDue)
  const snoozed = d.next_contact_on && d.next_contact_on > today

  async function remove() {
    if (!window.confirm('حذف الجهاز من «أجهزتي»؟')) return
    setBusy(true)
    setError(null)
    try {
      await removeMyDevice(d.id)
      onChange()
    } catch (e) {
      setError(serviceErrorMessage((e as Error).message))
      setBusy(false)
    }
  }

  async function snooze(days: number) {
    setBusy(true)
    setError(null)
    try {
      await snoozeMyDevice(d.id, riyadhDate(days))
      setSnoozing(false)
      onChange()
    } catch (e) {
      setError(serviceErrorMessage((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`card stack-sm device-card ${h.tone}`}>
      <div className="dev-head">
        <div className="dev-img" aria-hidden="true">
          {img ? <img src={img} alt="" loading="lazy" /> : <span>💧</span>}
        </div>
        <div className="stack-sm dev-name">
          <b>{d.product ? <Link to={productPath(d.product)}>{d.name_ar}</Link> : d.name_ar}</b>
          <span className="muted">
            {d.product_id ? (
              <>
                {d.model && <span dir="ltr">{d.model} · </span>}
                {d.installed ? 'ركّبناه' : 'استلمته'} في {formatDate(d.started_on)}
                {d.date_uncertain && ' (تقريبي)'}
              </>
            ) : (
              <>جهاز من شركة أخرى{d.date_uncertain ? '' : ` · من ${formatDate(d.started_on)}`}</>
            )}
          </span>
          <div className="row wrapr">
          {d.warranty_until ? (
            d.warranty_until >= today ? (
              <span className="tag ok">بالضمان لين {formatDate(d.warranty_until)}</span>
            ) : (
              <span className="tag off">انتهى الضمان</span>
            )
          ) : null}
          </div>
        </div>
        <HealthRing {...h} />
      </div>

      {d.filters.length > 0 ? (
        <ul className="fbars">
          {d.filters.map((f) => (
            <FilterBar key={f.id} f={f} alertDays={alertDays} />
          ))}
        </ul>
      ) : (
        <p className="muted">ما عندنا بيانات فلاتر هذا الجهاز بعد.</p>
      )}

      {(history.length > 0 || d.order_id) && (
        <details className="dev-history">
          <summary>سجل الجهاز</summary>
          <ol>
            {history.map((r) => (
              <li key={r.id}>
                <b>{formatDate(r.done_at ?? r.scheduled_at ?? r.created_at)}</b>
                <span>
                  {SERVICE_KIND_LABELS[r.kind]}
                  {r.fault_type ? `: ${r.fault_type}` : ''} · {SERVICE_STATUS_LABELS[r.status]}
                </span>
              </li>
            ))}
            <li>
              <b>{formatDate(d.started_on)}</b>
              <span>
                {d.installed ? 'ركّبناه عندك' : d.product_id ? 'استلمته' : 'سجّلته في أجهزتي'}
                {d.order_id && (
                  <>
                    {' '}
                    ·{' '}
                    <Link to={`/orders/${d.order_id}`} className="link">
                      الطلب
                    </Link>
                  </>
                )}
              </span>
            </li>
          </ol>
        </details>
      )}

      {open ? (
        <p className="notice">
          <b>
            {SERVICE_KIND_LABELS[open.kind]} {open.request_number}: {SERVICE_STATUS_LABELS[open.status]}
          </b>
          <Link to="/service" className="link">
            تفاصيل الطلب
          </Link>
        </p>
      ) : (
        <>
          {dueSoon && !snoozed && <p className="notice warn">حان وقت تغيير الفلاتر. احجز زيارة صيانة ونتواصل معك لتأكيد الموعد.</p>}
          {snoozed && <p className="muted">أجّلت تذكير الصيانة لين {formatDate(d.next_contact_on!)}.</p>}
          <div className="row wrapr">
            <Link to={`/service/new?kind=maintenance&device=${d.id}`} className={`btn sm${dueSoon ? '' : ' ghost'}`}>
              احجز صيانة
            </Link>
            <Link to={`/service/new?kind=emergency&device=${d.id}`} className="btn sm ghost">
              بلّغ عن عطل
            </Link>
            {!d.product_id && (
              <button type="button" className="linkbtn danger" disabled={busy} onClick={remove}>
                حذف الجهاز
              </button>
            )}
            {dueSoon && !snoozed && !snoozing && (
              <button type="button" className="linkbtn" onClick={() => setSnoozing(true)}>
                أجّل التذكير
              </button>
            )}
          </div>
          {snoozing && (
            <div className="row wrapr">
              <span className="muted">ذكّرني بعد:</span>
              <div className="seg">
                {SNOOZE.map((s) => (
                  <button key={s.days} type="button" disabled={busy} onClick={() => snooze(s.days)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <button type="button" className="linkbtn" onClick={() => setSnoozing(false)}>
                تراجع
              </button>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** «أجهزتي»: the customer's devices, their filters and maintenance. */
export function Devices() {
  usePageMeta('أجهزتي')
  const { state, reload } = useAsync(load)
  const catalog = useCatalog()
  const [adding, setAdding] = useState(false)
  const img = (productId: string | null) => {
    if (!productId || catalog.state.status !== 'success') return null
    const p = catalog.state.data.products.find((x) => x.id === productId)
    return p ? mainImageUrl(p) : null
  }
  const devices = state.status === 'success' ? state.data.devices : []
  const next = devices
    .flatMap((d) => d.filters.map((f) => ({ d, f })))
    .sort((a, b) => a.f.next_due_on.localeCompare(b.f.next_due_on))[0]
  const nextLeft = next ? daysUntil(next.f.next_due_on) : null

  return (
    <div className="stack narrow">
      <div className="row between wrapr">
        <h1 className="page-h">أجهزتي</h1>
        <div className="row wrapr">
          <Link to="/service" className="link">
            طلبات الصيانة
          </Link>
          <Link to="/orders" className="link">
            طلباتي
          </Link>
        </div>
      </div>
      {state.status === 'loading' && (
        <div className="stack" aria-hidden="true">
          <div className="card skel" />
          <div className="card skel" />
        </div>
      )}
      {state.status === 'success' && devices.length > 0 && (
        <div className={`card dev-summary ${nextLeft !== null && nextLeft < 0 ? 'bad' : nextLeft !== null && nextLeft <= state.data.alertDays ? 'warn' : ''}`}>
          <div>
            <b>{devices.length === 1 ? 'عندك جهاز واحد' : devices.length === 2 ? 'عندك جهازين' : `عندك ${devices.length} أجهزة`}</b>
            {next && nextLeft !== null && (
              <span>
                {nextLeft < 0
                  ? `فلتر «${next.f.name_ar}» متأخر ${-nextLeft} يوم`
                  : nextLeft === 0
                    ? `فلتر «${next.f.name_ar}» موعده اليوم`
                    : `أقرب تغيير فلتر بعد ${nextLeft} يوم (${next.d.name_ar})`}
              </span>
            )}
          </div>
          {next && nextLeft !== null && nextLeft <= state.data.alertDays && (
            <Link to={`/service/new?kind=maintenance&device=${next.d.id}`} className="btn sm">
              احجز تغيير الفلاتر
            </Link>
          )}
        </div>
      )}
      {state.status === 'error' && (
        <div className="notice bad" role="alert">
          <b>تعذّر تحميل أجهزتك.</b>
          <button className="btn sm" onClick={reload}>
            إعادة المحاولة
          </button>
        </div>
      )}
      {state.status === 'success' && (adding ? (
        <AddDeviceForm
          onDone={(saved) => {
            setAdding(false)
            if (saved) reload()
          }}
        />
      ) : (
        <button type="button" className="btn sm ghost self-start" onClick={() => setAdding(true)}>
          + أضف جهاز عندك (من أي شركة)
        </button>
      ))}
      {state.status === 'success' && state.data.devices.length === 0 && !adding && (
        <div className="card empty-state">
          <span className="empty-ic" aria-hidden="true">💧</span>
          <b>ما عندك أجهزة مسجلة بعد.</b>
          <span className="muted">
            أضف جهازك (منّا أو من أي شركة) ونذكّرك بموعد تغيير الفلاتر، وتقدر تحجز صيانة أو تبلّغ عن عطل بضغطة.
          </span>
          <Link to="/service/new?kind=emergency" className="btn sm self-start">
            بلّغ عن عطل
          </Link>
        </div>
      )}
      {state.status === 'success' &&
        state.data.devices.map((d) => (
          <DeviceCard
            key={d.id}
            d={d}
            alertDays={state.data.alertDays}
            remind={state.data.remind}
            open={state.data.requests.find((r) => r.device_id === d.id && OPEN_SERVICE_STATUSES.includes(r.status))}
            history={state.data.requests.filter((r) => r.device_id === d.id && !OPEN_SERVICE_STATUSES.includes(r.status))}
            img={img(d.product_id)}
            onChange={reload}
          />
        ))}
    </div>
  )
}

const KINDS = Object.keys(DEVICE_KIND_LABELS) as DeviceKind[]

/** «أضف جهازك»: any device the customer already has, from any company. */
function AddDeviceForm({ onDone }: { onDone: (saved: boolean) => void }) {
  const [kind, setKind] = useState<DeviceKind>('under_sink')
  const [brand, setBrand] = useState('')
  const [stages, setStages] = useState('')
  const [known, setKnown] = useState(false)
  const [started, setStarted] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (known && !started) return setError('اختر التاريخ، أو اختر «ما أذكر».')
    setBusy(true)
    setError(null)
    try {
      await addMyDevice({ kind, brand, stages: stages ? Number(stages) : null, startedOn: known ? started : null })
      onDone(true)
    } catch (err) {
      setError(serviceErrorMessage((err as Error).message))
      setBusy(false)
    }
  }

  return (
    <form className="card stack-sm" onSubmit={save}>
      <h2 className="h3">أضف جهازك</h2>
      <span className="muted">نوعه:</span>
      <div className="seg" role="radiogroup" aria-label="نوع الجهاز">
        {KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : undefined} onClick={() => setKind(k)}>
            {DEVICE_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <div className="row wrapr">
        <input className="input grow" aria-label="الشركة أو الماركة (اختياري)" placeholder="الشركة أو الماركة (اختياري)" maxLength={60} value={brand} onChange={(e) => setBrand(e.target.value)} />
        <select className="input" style={{ maxWidth: 170 }} aria-label="عدد المراحل (اختياري)" value={stages} onChange={(e) => setStages(e.target.value)}>
          <option value="">عدد المراحل؟</option>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>
              {n} مراحل
            </option>
          ))}
        </select>
      </div>
      <span className="muted">متى آخر مرة تغيّرت فلاتره (أو ركّبته)؟</span>
      <div className="seg">
        <button type="button" className={!known ? 'on' : undefined} onClick={() => setKnown(false)}>
          ما أذكر
        </button>
        <button type="button" className={known ? 'on' : undefined} onClick={() => setKnown(true)}>
          أذكر التاريخ
        </button>
      </div>
      {known && <input className="input" type="date" aria-label="التاريخ" max={riyadhDate()} value={started} onChange={(e) => setStarted(e.target.value)} />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button className="btn sm" disabled={busy}>
          حفظ الجهاز
        </button>
        <button type="button" className="btn sm ghost" onClick={() => onDone(false)}>
          إلغاء
        </button>
      </div>
    </form>
  )
}
