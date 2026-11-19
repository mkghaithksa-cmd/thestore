import { Fragment, useCallback, useEffect, useState } from 'react'
import {
  DEVICE_KIND_LABELS,
  OUTCOME_LABELS,
  PERIOD_LABELS,
  SERVICE_KIND_LABELS,
  SERVICE_STATUS_LABELS,
  serviceErrorMessage,
  type ContactOutcome,
  type DeviceKind,
  type ServiceKind,
  type ServicePeriod,
  type ServiceRequest,
  type ServiceRequestEvent,
  type ServiceStatus,
} from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import {
  fetchFaultTypes,
  fetchTechnicians,
  fromRiyadhInput,
  localPhone,
  lookupPhone,
  normalizePhone,
  photoUrl,
  riyadhDate,
  toRiyadhInput,
  waLink,
  when,
  type PhoneLookup,
  type Technician,
} from '../lib/service'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

type Row = ServiceRequest & { device: { name_ar: string; model: string | null; product_id: string | null; brand: string | null } | null }
type Tab = 'requests' | 'due' | 'phone'
type Filter = 'open' | 'new' | 'today' | 'done' | 'cancelled' | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'مفتوحة' },
  { key: 'new', label: 'بانتظار موعد' },
  { key: 'today', label: 'مواعيد اليوم' },
  { key: 'done', label: 'تمت' },
  { key: 'cancelled', label: 'ملغية' },
  { key: 'all', label: 'الكل' },
]
const STATUS_CLS: Record<ServiceStatus, string> = {
  new: 'b-warn',
  scheduled: 'b-info',
  in_progress: 'b-info',
  done: 'b-ok',
  cancelled: 'b-gray',
}
const OPEN: ServiceStatus[] = ['new', 'scheduled', 'in_progress']

function matches(r: Row, f: Filter): boolean {
  if (f === 'all') return true
  if (f === 'open') return OPEN.includes(r.status)
  if (f === 'today') return OPEN.includes(r.status) && !!r.scheduled_at && toRiyadhInput(r.scheduled_at).slice(0, 10) === riyadhDate()
  return r.status === f
}

/** Emergencies first, then the earliest visit. */
function order(a: Row, b: Row): number {
  const open = Number(OPEN.includes(b.status)) - Number(OPEN.includes(a.status))
  if (open) return open
  if (!OPEN.includes(a.status)) return b.created_at.localeCompare(a.created_at)
  const em = Number(b.kind === 'emergency') - Number(a.kind === 'emergency')
  if (em) return em
  const at = (r: Row) => r.scheduled_at ?? `${r.preferred_date}T${r.preferred_period === 'morning' ? '06' : '14'}:00:00Z`
  return at(a).localeCompare(at(b))
}

/** «المواعيد والبلاغات»: fault reports and maintenance visits, the due list, and phone reports. */
export function Appointments() {
  const [tab, setTab] = useState<Tab>('requests')
  const { can } = useStaffAuth()
  return (
    <RequirePage page="appointments">
      <div className="ph">
        <div>
          <h1>المواعيد والبلاغات</h1>
          <p>البلاغات الطارئة أولاً. حدّد الساعة والفني ثم اتصل بالعميل وأكّد. تغيير موعد محدد يحتاج سبب، وكل تغيير ينحفظ.</p>
        </div>
      </div>
      <div className="chips" role="tablist" aria-label="الأقسام">
        <button type="button" role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'on' : undefined} onClick={() => setTab('requests')}>
          البلاغات والمواعيد
        </button>
        <button type="button" role="tab" aria-selected={tab === 'due'} className={tab === 'due' ? 'on' : undefined} onClick={() => setTab('due')}>
          الصيانة المستحقة
        </button>
        {can('appointments', 'add') && (
          <button type="button" role="tab" aria-selected={tab === 'phone'} className={tab === 'phone' ? 'on' : undefined} onClick={() => setTab('phone')}>
            + بلاغ هاتفي
          </button>
        )}
      </div>
      {tab === 'requests' && <Requests />}
      {tab === 'due' && <DueList />}
      {tab === 'phone' && <PhoneReport onDone={() => setTab('requests')} />}
    </RequirePage>
  )
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------
function Requests() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [techs, setTechs] = useState<Technician[]>([])
  const [filter, setFilter] = useState<Filter>('open')
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [r, t] = await Promise.all([
      supabase.from('service_requests').select('*, device:customer_devices(name_ar, model, product_id, brand)').order('created_at', { ascending: false }).limit(300),
      fetchTechnicians(),
    ])
    if (r.error) throw new Error(r.error.message)
    setRows((r.data ?? []) as Row[])
    setTechs(t)
  }, [])
  const reload = useCallback(() => {
    setError(null)
    load().catch(() => setError('تعذّر تحميل البلاغات.'))
  }, [load])
  useEffect(reload, [reload])

  const shown = (rows ?? []).filter((r) => matches(r, filter)).sort(order)
  const count = (f: Filter) => (rows ?? []).filter((r) => matches(r, f)).length
  const techName = (id: string | null) => techs.find((t) => t.user_id === id)?.full_name

  return (
    <>
      <div className="row between wrapr">
        <div className="chips" role="tablist" aria-label="تصفية">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? 'on' : undefined} onClick={() => setFilter(f.key)}>
              {f.label} ({count(f.key)})
            </button>
          ))}
        </div>
        <button className="btn ghost sm" onClick={reload}>
          تحديث
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!rows ? (
        !error && <p className="muted">جاري التحميل…</p>
      ) : shown.length === 0 ? (
        <div className="notice">
          <b>لا توجد طلبات هنا.</b>
        </div>
      ) : (
        <div className="card tw">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>النوع</th>
                <th>العميل</th>
                <th>الجهاز / العطل</th>
                <th>الحي</th>
                <th>الموعد</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Fragment key={r.id}>
                  <tr className={open === r.id ? 'sel' : undefined}>
                    <td>
                      <button className="linkbtn" dir="ltr" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                        {r.request_number}
                      </button>
                      <div className="muted">{r.source === 'phone' ? 'هاتفي' : 'من الموقع'}</div>
                    </td>
                    <td>
                      <span className={`badge ${r.kind === 'emergency' ? 'b-bad' : 'b-info'}`}>{SERVICE_KIND_LABELS[r.kind]}</span>
                    </td>
                    <td>
                      {r.contact_name}
                      <div className="muted" dir="ltr">
                        {localPhone(r.contact_phone)}
                      </div>
                    </td>
                    <td>
                      {r.device ? (
                        <>
                          {r.device.name_ar}
                          <span className={`badge ms ${r.device.product_id ? 'b-ok' : 'b-gray'}`}>{r.device.product_id ? 'غيث' : 'شركة أخرى'}</span>
                        </>
                      ) : (
                        <span className="muted">الجهاز غير معروف</span>
                      )}
                      {r.fault_type && <div className="muted">{r.fault_type}</div>}
                    </td>
                    <td>{r.neighborhood_name ?? '—'}</td>
                    <td>
                      {r.scheduled_at ? (
                        <>
                          <b>{when(r.scheduled_at)}</b>
                          {techName(r.technician_id) && <div className="muted">{techName(r.technician_id)}</div>}
                        </>
                      ) : (
                        <span className="muted">
                          يفضّل {when(r.preferred_date)} {PERIOD_LABELS[r.preferred_period]}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_CLS[r.status]}`}>{SERVICE_STATUS_LABELS[r.status]}</span>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr className="detail">
                      <td colSpan={7}>
                        <RequestDetail r={r} techs={techs} onChanged={reload} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function RequestDetail({ r, techs, onChanged }: { r: Row; techs: Technician[]; onChanged: () => void }) {
  const { can } = useStaffAuth()
  const [events, setEvents] = useState<ServiceRequestEvent[]>([])
  const [photo, setPhoto] = useState<string | null>(null)
  const defaultAt = `${r.preferred_date}T${r.preferred_period === 'morning' ? '10:00' : '17:00'}`
  const [at, setAt] = useState(r.scheduled_at ? toRiyadhInput(r.scheduled_at) : defaultAt)
  const [tech, setTech] = useState(r.technician_id ?? '')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('service_request_events')
      .select('*')
      .eq('request_id', r.id)
      .order('created_at')
      .then(({ data }) => setEvents((data ?? []) as ServiceRequestEvent[]))
    if (r.photo_path) photoUrl(r.photo_path).then(setPhoto)
  }, [r.id, r.photo_path])

  const editable = can('appointments', 'edit')
  const canSchedule = editable && (r.status === 'new' || r.status === 'scheduled')
  const changing = r.status === 'scheduled' && !!r.scheduled_at && fromRiyadhInput(at) !== fromRiyadhInput(toRiyadhInput(r.scheduled_at))

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    setError(null)
    const { error: e } = await fn()
    setBusy(false)
    if (e) return setError(serviceErrorMessage(e.message))
    onChanged()
  }
  const schedule = () =>
    run(() =>
      supabase.rpc('request_schedule', {
        p_request_id: r.id,
        p_scheduled_at: fromRiyadhInput(at),
        p_technician_id: tech || null,
        p_reason: reason.trim() || null,
      }),
    )
  const setStatus = (s: ServiceStatus) => {
    if (s === 'cancelled' && !note.trim()) return setError('اكتب سبب الإلغاء في الملاحظة.')
    return run(() => supabase.rpc('request_set_status', { p_request_id: r.id, p_status: s, p_note: note.trim() || null }))
  }

  const map = r.lat !== null && r.lng !== null ? `https://www.google.com/maps?q=${r.lat},${r.lng}` : null
  const confirmText = r.scheduled_at
    ? `السلام عليكم ${r.contact_name}، معك تنقية غيث. موعد زيارة الفني ${when(r.scheduled_at)} بخصوص طلبك ${r.request_number}. يناسبك؟`
    : `السلام عليكم ${r.contact_name}، معك تنقية غيث بخصوص طلبك ${r.request_number}.`

  return (
    <div className="stack">
      <div className="grid-form">
        <div className="stack-sm">
          <b>التواصل</b>
          <div className="row wrapr">
            <a className="btn sm sec" href={`tel:${r.contact_phone}`} dir="ltr">
              {localPhone(r.contact_phone)}
            </a>
            <a className="btn sm ghost" href={waLink(r.contact_phone, confirmText)} target="_blank" rel="noreferrer">
              واتساب
            </a>
          </div>
        </div>
        <div className="stack-sm">
          <b>العنوان</b>
          <span>{[r.neighborhood_name, r.street].filter(Boolean).join('، ') || '—'}</span>
          {map && (
            <a className="link" href={map} target="_blank" rel="noreferrer">
              افتح الموقع في الخريطة
            </a>
          )}
        </div>
        <div className="stack-sm">
          <b>الطلب</b>
          <span>
            {r.device ? `${r.device.name_ar}${r.device.model ? ` (${r.device.model})` : ''} · ${r.device.product_id ? 'جهاز غيث' : 'جهاز شركة أخرى'}` : 'الجهاز غير معروف'}
            {r.fault_type ? ` · ${r.fault_type}` : ''}
          </span>
          {r.kind === 'emergency' && <span className="muted">رسوم الفحص {Number(r.inspection_fee)} ر.س قبل الضريبة، تنحصّل عند الزيارة.</span>}
        </div>
      </div>
      {r.description && <p className="page-body">{r.description}</p>}
      {photo && (
        <a href={photo} target="_blank" rel="noreferrer">
          <img src={photo} alt="صورة العطل من العميل" className="sr-photo" />
        </a>
      )}

      {canSchedule && (
        <div className="act card inset">
          <b>{r.status === 'new' ? 'تحديد الموعد' : 'تغيير الموعد'}</b>
          <div className="row wrapr align-end">
            <div className="field">
              <label htmlFor={`at-${r.id}`}>اليوم والساعة</label>
              <input id={`at-${r.id}`} type="datetime-local" className="input" value={at} onChange={(e) => setAt(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor={`tech-${r.id}`}>الفني</label>
              <select id={`tech-${r.id}`} className="input" value={tech} onChange={(e) => setTech(e.target.value)}>
                <option value="">بدون تحديد</option>
                {techs.map((t) => (
                  <option key={t.user_id} value={t.user_id}>
                    {t.full_name}
                  </option>
                ))}
              </select>
            </div>
            {changing && (
              <div className="field grow">
                <label htmlFor={`why-${r.id}`}>سبب تغيير الموعد</label>
                <input id={`why-${r.id}`} className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            )}
            <button className="btn sm field-btn" disabled={busy || (changing && !reason.trim())} onClick={schedule}>
              {r.status === 'new' ? 'حفظ الموعد' : 'حفظ التغيير'}
            </button>
          </div>
          <span className="muted">العميل طلب {when(r.preferred_date)} {PERIOD_LABELS[r.preferred_period]}. بعد الحفظ اتصل فيه وأكّد الساعة.</span>
        </div>
      )}

      {editable && OPEN.includes(r.status) && (
        <div className="act card inset">
          <div className="field">
            <label htmlFor={`note-${r.id}`}>ملاحظة (مطلوبة للإلغاء)</label>
            <input id={`note-${r.id}`} className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="row wrapr">
            {r.status === 'scheduled' && (
              <button className="btn sm sec" disabled={busy} onClick={() => setStatus('in_progress')}>
                خرج الفني
              </button>
            )}
            {(r.status === 'scheduled' || r.status === 'in_progress') && (
              <button className="btn sm" disabled={busy} onClick={() => setStatus('done')}>
                {r.kind === 'maintenance' ? 'تمت الصيانة (يصفّر الفلاتر المستحقة)' : 'تمت الزيارة'}
              </button>
            )}
            <button className="btn sm ghost danger" disabled={busy} onClick={() => setStatus('cancelled')}>
              إلغاء الطلب
            </button>
          </div>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}

      {events.length > 0 && (
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <b>
                {e.from_status === 'scheduled' && e.to_status === 'scheduled' ? 'تغيّر الموعد' : SERVICE_STATUS_LABELS[e.to_status]}
                {e.scheduled_at ? `: ${when(e.scheduled_at)}` : ''}
              </b>
              <span className="muted">
                {when(e.created_at)}
                {e.note ? ` · ${e.note}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Due maintenance
// ---------------------------------------------------------------------------
interface Due {
  device_id: string
  device_name: string
  model: string | null
  customer_id: string | null
  customer_name: string | null
  phone: string
  next_due_on: string
  due_filters: string[] | null
  date_uncertain: boolean
  last_outcome: ContactOutcome | null
  last_contact_at: string | null
  no_answer_count: number
}

function DueList() {
  const [rows, setRows] = useState<Due[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [alertDays, setAlertDays] = useState<number | null>(null)

  const reload = useCallback(() => {
    setError(null)
    Promise.all([supabase.rpc('maintenance_due'), supabase.from('settings').select('maintenance_alert_days').eq('id', 1).maybeSingle()]).then(([d, s]) => {
      if (d.error) return setError('تعذّر تحميل القائمة.')
      setRows((d.data ?? []) as Due[])
      setAlertDays((s.data?.maintenance_alert_days as number | undefined) ?? null)
    })
  }, [])
  useEffect(reload, [reload])
  const today = riyadhDate()

  return (
    <>
      <div className="row between wrapr">
        <p className="muted">
          الأجهزة اللي موعد تغيير فلاترها خلال {alertDays ?? '…'} يوم أو فات. أرسل للعميل واتساب أو اتصل، وسجّل رده. اللي عليه طلب مفتوح أو مؤجَّل ما
          يظهر هنا.
        </p>
        <button className="btn ghost sm" onClick={reload}>
          تحديث
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!rows ? (
        !error && <p className="muted">جاري التحميل…</p>
      ) : rows.length === 0 ? (
        <div className="notice ok">
          <b>ما في صيانة مستحقة الحين.</b>
        </div>
      ) : (
        <div className="card tw">
          <table>
            <thead>
              <tr>
                <th>العميل</th>
                <th>الجهاز</th>
                <th>الفلاتر المستحقة</th>
                <th>الموعد</th>
                <th>آخر تواصل</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => {
                const late = d.next_due_on < today
                const text = `السلام عليكم${d.customer_name ? ` ${d.customer_name}` : ''}، معك تنقية غيث. حان موعد تغيير فلاتر جهازك (${d.device_name}). متى يناسبك نزورك؟ الصباح أو المساء؟`
                return (
                  <Fragment key={d.device_id}>
                    <tr>
                      <td>
                        {d.customer_name ?? <span className="muted">بدون حساب</span>}
                        <div className="muted" dir="ltr">
                          {localPhone(d.phone)}
                        </div>
                      </td>
                      <td>
                        {d.device_name}
                        {d.date_uncertain && <div className="warn-text">تاريخ غير مؤكد</div>}
                      </td>
                      <td>{(d.due_filters ?? []).join('، ')}</td>
                      <td className={late ? 'low' : undefined}>
                        {when(d.next_due_on)}
                        {late && <div className="muted">متأخر</div>}
                      </td>
                      <td>
                        {d.last_outcome ? (
                          <>
                            {OUTCOME_LABELS[d.last_outcome]} · {when(d.last_contact_at!, false)}
                          </>
                        ) : (
                          <span className="muted">ما تواصلنا</span>
                        )}
                        {d.no_answer_count > 0 && <div className="muted">ما رد {d.no_answer_count} مرة</div>}
                      </td>
                      <td>
                        <div className="row">
                          <a className="btn sm sec" href={waLink(d.phone, text)} target="_blank" rel="noreferrer">
                            واتساب
                          </a>
                          <button className="btn sm ghost" aria-expanded={open === d.device_id} onClick={() => setOpen(open === d.device_id ? null : d.device_id)}>
                            سجّل الرد
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open === d.device_id && (
                      <tr className="detail">
                        <td colSpan={6}>
                          <OutcomeForm
                            due={d}
                            onDone={() => {
                              setOpen(null)
                              reload()
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function OutcomeForm({ due, onDone }: { due: Due; onDone: () => void }) {
  const { can } = useStaffAuth()
  const [outcome, setOutcome] = useState<ContactOutcome>('agreed')
  const [day, setDay] = useState(riyadhDate(1))
  const [period, setPeriod] = useState<ServicePeriod>('morning')
  const [until, setUntil] = useState(riyadhDate(14))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  if (!can('appointments', 'edit')) return <p className="muted">ما عندك صلاحية تسجيل الرد.</p>
  if (done) {
    return (
      <div className="notice ok">
        <b>انحفظ. طلب الصيانة {done} صار في «البلاغات والمواعيد»، حدّد له الساعة والفني.</b>
        <button className="linkbtn" onClick={onDone}>
          تمام
        </button>
      </div>
    )
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('maintenance_log_contact', {
      p_device_id: due.device_id,
      p_outcome: outcome,
      p_postpone_to: outcome === 'postponed' ? until : null,
      p_preferred_date: outcome === 'agreed' ? day : null,
      p_preferred_period: outcome === 'agreed' ? period : null,
      p_note: note.trim() || null,
    })
    setBusy(false)
    if (err) return setError(serviceErrorMessage(err.message))
    const num = (data as { request_number: string | null } | null)?.request_number
    if (num) setDone(num)
    else onDone()
  }

  return (
    <form className="act card inset" onSubmit={save}>
      <div className="chips" role="radiogroup" aria-label="رد العميل">
        {(Object.keys(OUTCOME_LABELS) as ContactOutcome[]).map((o) => (
          <button key={o} type="button" role="radio" aria-checked={outcome === o} className={outcome === o ? 'on' : undefined} onClick={() => setOutcome(o)}>
            {OUTCOME_LABELS[o]}
          </button>
        ))}
      </div>
      {outcome === 'agreed' && (
        <div className="row wrapr align-end">
          <div className="field">
            <label htmlFor={`d-${due.device_id}`}>اليوم اللي يناسبه</label>
            <input id={`d-${due.device_id}`} type="date" className="input" min={riyadhDate()} max={riyadhDate(30)} value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
          <div className="field">
            <span>الفترة</span>
            <div className="chips">
              {(['morning', 'evening'] as ServicePeriod[]).map((p) => (
                <button key={p} type="button" className={period === p ? 'on' : undefined} onClick={() => setPeriod(p)}>
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {outcome === 'postponed' && (
        <div className="field">
          <label htmlFor={`u-${due.device_id}`}>نذكّره من جديد في</label>
          <input id={`u-${due.device_id}`} type="date" className="input" min={riyadhDate(1)} max={riyadhDate(180)} value={until} onChange={(e) => setUntil(e.target.value)} />
        </div>
      )}
      {outcome === 'declined' && <p className="muted">ينشال من القائمة 90 يوم.</p>}
      {outcome === 'no_answer' && <p className="muted">يبقى في القائمة، وينحسب عدد مرات عدم الرد.</p>}
      <div className="field">
        <label htmlFor={`n-${due.device_id}`}>ملاحظة (اختياري)</label>
        <input id={`n-${due.device_id}`} className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="btn sm self-start" disabled={busy}>
        حفظ الرد
      </button>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Phone report
// ---------------------------------------------------------------------------
function PhoneReport({ onDone }: { onDone: () => void }) {
  const [phoneInput, setPhoneInput] = useState('')
  const [found, setFound] = useState<PhoneLookup | null>(null)
  const [faults, setFaults] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const [kind, setKind] = useState<ServiceKind>('emergency')
  const [name, setName] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [otherKind, setOtherKind] = useState<DeviceKind>('under_sink')
  const [otherBrand, setOtherBrand] = useState('')
  const [fault, setFault] = useState('')
  const [description, setDescription] = useState('')
  const [day, setDay] = useState(riyadhDate())
  const [period, setPeriod] = useState<ServicePeriod>('morning')
  const [addressId, setAddressId] = useState('')
  const [hood, setHood] = useState('')
  const [street, setStreet] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)

  useEffect(() => {
    fetchFaultTypes().then(setFaults, () => setFaults([]))
  }, [])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const phone = normalizePhone(phoneInput)
    if (!phone) return setError('رقم الجوال غير صحيح. اكتبه بالشكل 05xxxxxxxx.')
    setSearching(true)
    try {
      const r = await lookupPhone(phone)
      setFound(r)
      setName(r.customer?.full_name ?? '')
      setDeviceId(r.devices.find((d) => d.is_active)?.id ?? '')
      setAddressId(r.addresses.find((a) => a.in_service_area)?.id ?? '')
    } catch {
      setError('تعذّر البحث.')
    } finally {
      setSearching(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!found) return
    setError(null)
    if (kind === 'emergency' && !fault) return setError('اختر نوع العطل.')
    if (kind === 'maintenance' && !deviceId) return setError('اختر الجهاز أو «جهاز شركة أخرى».')
    if (!addressId && !hood.trim()) return setError('اختر عنوان محفوظ أو اكتب الحي.')
    setBusy(true)
    const { data, error: err } = await supabase.rpc('staff_request_service', {
      p_phone: found.phone,
      p_contact_name: name.trim() || null,
      p_kind: kind,
      p_preferred_date: day,
      p_preferred_period: period,
      p_device_id: deviceId && deviceId !== 'other' ? deviceId : null,
      p_fault_type: kind === 'emergency' ? fault : null,
      p_description: description.trim() || null,
      p_address_id: addressId || null,
      p_neighborhood_name: addressId ? null : hood.trim(),
      p_street: addressId ? null : street.trim() || null,
      p_device_kind: deviceId === 'other' ? otherKind : null,
      p_brand: deviceId === 'other' ? otherBrand.trim() || null : null,
    })
    setBusy(false)
    if (err) return setError(serviceErrorMessage(err.message))
    setCreated((data as { request_number: string }).request_number)
  }

  if (created) {
    return (
      <div className="notice ok">
        <b>انحفظ البلاغ {created}.</b>
        <span>حدّد له الساعة والفني من «البلاغات والمواعيد».</span>
        <button className="btn sm" onClick={onDone}>
          عرض البلاغات
        </button>
      </div>
    )
  }

  const meccaAddresses = (found?.addresses ?? []).filter((a) => a.in_service_area)
  const devices = (found?.devices ?? []).filter((d) => d.is_active)

  return (
    <div className="stack">
      <form className="card row wrapr align-end" onSubmit={search}>
        <div className="field grow">
          <label htmlFor="ph-phone">جوال المتصل</label>
          <input id="ph-phone" className="input" dir="ltr" inputMode="tel" placeholder="05xxxxxxxx" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} />
        </div>
        <button className="btn field-btn" disabled={searching}>
          بحث
        </button>
      </form>
      {error && !found && <p className="form-error">{error}</p>}

      {found && (
        <form className="card stack" onSubmit={submit}>
          <p className={found.customer ? 'notice ok' : 'notice'}>
            {found.customer ? (
              <b>عميل مسجل: {found.customer.full_name ?? 'بدون اسم'}</b>
            ) : (
              <b>رقم بدون حساب. ينحفظ البلاغ على الرقم، ولما يسجّل العميل ينتقل لحسابه.</b>
            )}
            <span className="muted">
              {devices.length ? `${devices.length} جهاز مسجل` : 'ما عنده أجهزة مسجلة'} · أضف أجهزته القديمة من «العملاء والأجهزة».
            </span>
          </p>
          <div className="chips" role="radiogroup" aria-label="النوع">
            {(['emergency', 'maintenance'] as ServiceKind[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : undefined} onClick={() => setKind(k)}>
                {SERVICE_KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <div className="grid-form">
            <div className="field">
              <label htmlFor="ph-name">الاسم</label>
              <input id="ph-name" className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ph-dev">الجهاز</label>
              <select id="ph-dev" className="input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
                <option value="">{kind === 'emergency' ? 'ما يعرف / بدون تحديد' : 'اختر'}</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name_ar} · {when(d.started_on)}
                  </option>
                ))}
                <option value="other">جهاز شركة أخرى (جديد)</option>
              </select>
            </div>
            {deviceId === 'other' && (
              <>
                <div className="field">
                  <label htmlFor="ph-kind">نوع الجهاز</label>
                  <select id="ph-kind" className="input" value={otherKind} onChange={(e) => setOtherKind(e.target.value as DeviceKind)}>
                    {(Object.keys(DEVICE_KIND_LABELS) as DeviceKind[]).map((k) => (
                      <option key={k} value={k}>
                        {DEVICE_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="ph-brand">الشركة / الماركة</label>
                  <input id="ph-brand" className="input" maxLength={60} value={otherBrand} onChange={(e) => setOtherBrand(e.target.value)} />
                </div>
              </>
            )}
            {kind === 'emergency' && (
              <div className="field">
                <label htmlFor="ph-fault">نوع العطل</label>
                <select id="ph-fault" className="input" value={fault} onChange={(e) => setFault(e.target.value)}>
                  <option value="">اختر</option>
                  {faults.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="ph-day">اليوم المفضل</label>
              <input id="ph-day" type="date" className="input" min={riyadhDate()} max={riyadhDate(30)} value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div className="field">
              <span>الفترة</span>
              <div className="chips">
                {(['morning', 'evening'] as ServicePeriod[]).map((p) => (
                  <button key={p} type="button" className={period === p ? 'on' : undefined} onClick={() => setPeriod(p)}>
                    {PERIOD_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="field">
            <label htmlFor="ph-desc">وصف المشكلة</label>
            <textarea id="ph-desc" className="input textarea" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ph-addr">العنوان</label>
            <select id="ph-addr" className="input" value={addressId} onChange={(e) => setAddressId(e.target.value)}>
              {meccaAddresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {[a.label, a.neighborhood_name ?? a.neighborhood?.name_ar, a.street].filter(Boolean).join('، ') || 'عنوان محفوظ'}
                </option>
              ))}
              <option value="">عنوان جديد (اكتب الحي)</option>
            </select>
          </div>
          {!addressId && (
            <div className="grid-form">
              <div className="field">
                <label htmlFor="ph-hood">الحي (داخل مكة)</label>
                <input id="ph-hood" className="input" maxLength={80} value={hood} onChange={(e) => setHood(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ph-street">الشارع / وصف المكان</label>
                <input id="ph-street" className="input" maxLength={300} value={street} onChange={(e) => setStreet(e.target.value)} />
              </div>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <button className="btn self-start" disabled={busy}>
            حفظ البلاغ
          </button>
        </form>
      )}
    </div>
  )
}
