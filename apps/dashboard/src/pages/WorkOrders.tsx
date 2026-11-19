import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { WO_STATUS_LABELS, serviceErrorMessage, type WorkOrder, type WorkOrderPart, type WorkOrderStatus } from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { STORE_ORIGIN, localPhone, sar, waLink, when, woPhotoUrl } from '../lib/service'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

interface Req {
  id: string
  request_number: string
  kind: 'emergency' | 'maintenance'
  contact_name: string
  contact_phone: string
  neighborhood_name: string | null
  fault_type: string | null
  customer_id: string | null
  technician: { full_name: string; phone: string } | null
}
type Row = WorkOrder & { parts: WorkOrderPart[]; request: Req }

type Tab = 'action' | WorkOrderStatus | 'done' | 'all'
const TABS: { key: Tab; label: string; test: (s: WorkOrderStatus) => boolean }[] = [
  { key: 'action', label: 'تحتاج إجراء', test: (s) => ['report', 'payment', 'paid'].includes(s) },
  { key: 'visit', label: 'بانتظار الفني', test: (s) => s === 'visit' },
  { key: 'approval', label: 'موافقة المدير', test: (s) => s === 'approval' },
  { key: 'quote', label: 'بانتظار العميل', test: (s) => s === 'quote' },
  { key: 'done', label: 'مغلقة', test: (s) => s === 'closed' || s === 'cancelled' },
  { key: 'all', label: 'الكل', test: () => true },
]

const PART_TYPES = ['filter', 'part']

/** «أوامر العمل»: from the technician's report to the quote, payment and closing. */
export function WorkOrders() {
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [tab, setTab] = useState<Tab>(params.get('wo') ? 'all' : 'action')
  const [error, setError] = useState<string | null>(null)
  const open = params.get('wo')

  const reload = useCallback(() => {
    setError(null)
    supabase
      .from('work_orders')
      .select(
        '*, parts:work_order_parts(*), request:service_requests(id, request_number, kind, contact_name, contact_phone, neighborhood_name, fault_type, customer_id, technician:technicians(full_name, phone))',
      )
      .order('created_at', { ascending: false })
      .limit(300)
      .then(({ data, error: e }) => {
        if (e) return setError('تعذّر تحميل أوامر العمل.')
        setRows((data ?? []) as unknown as Row[])
      })
  }, [])
  useEffect(reload, [reload])

  const t = TABS.find((x) => x.key === tab)!
  const list = (rows ?? []).filter((r) => t.test(r.status))
  const toggle = (id: string) => setParams(open === id ? {} : { wo: id }, { replace: true })

  return (
    <RequirePage page="work_orders">
      <div className="ph">
        <div>
          <h1>أوامر العمل</h1>
          <p>
            ينفتح أمر العمل لما ترسل رابط الزيارة للفني من «المواعيد والبلاغات». بعد تقرير الفني: جهّز العرض، وينتظر رد العميل، ثم الدفع (ميسر أو نقد
            للفني فتنفتح عهدة)، ثم الإغلاق وصرف القطع.
          </p>
        </div>
      </div>
      <div className="row between wrapr">
        <div className="chips" role="tablist">
          {TABS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={tab === x.key} className={tab === x.key ? 'on' : undefined} onClick={() => setTab(x.key)}>
              {x.label} ({(rows ?? []).filter((r) => x.test(r.status)).length})
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
      ) : list.length === 0 ? (
        <div className="notice ok">
          <b>ما في أوامر عمل هنا.</b>
        </div>
      ) : (
        <div className="card tw">
          <table>
            <thead>
              <tr>
                <th>الرقم</th>
                <th>البلاغ</th>
                <th>العميل</th>
                <th>الفني</th>
                <th>المبلغ</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {list.map((w) => (
                <Fragment key={w.id}>
                  <tr className={open === w.id ? 'sel' : undefined}>
                    <td>
                      <button className="linkbtn" aria-expanded={open === w.id} onClick={() => toggle(w.id)} dir="ltr">
                        {w.number}
                      </button>
                    </td>
                    <td>
                      <span dir="ltr">{w.request.request_number}</span>
                      <div className="muted">{w.request.kind === 'emergency' ? `عطل: ${w.request.fault_type ?? '—'}` : 'صيانة دورية'}</div>
                    </td>
                    <td>
                      {w.request.contact_name}
                      <div className="muted" dir="ltr">
                        {localPhone(w.request.contact_phone)}
                      </div>
                    </td>
                    <td>{w.request.technician?.full_name ?? '—'}</td>
                    <td>{Number(w.amount_due) > 0 ? sar(w.amount_due) : Number(w.total) > 0 ? sar(w.total) : '—'}</td>
                    <td>
                      <span className={`badge ${['report', 'payment', 'paid'].includes(w.status) ? 'b-warn' : w.status === 'closed' ? 'b-ok' : ''}`}>
                        {WO_STATUS_LABELS[w.status]}
                      </span>
                      {w.customer_absent && <div className="warn-text">العميل غير موجود</div>}
                    </td>
                  </tr>
                  {open === w.id && (
                    <tr className="detail">
                      <td colSpan={6}>
                        <WoDetail w={w} onChanged={reload} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </RequirePage>
  )
}

function WoDetail({ w, onChanged }: { w: Row; onChanged: () => void }) {
  const { can } = useStaffAuth()
  const editable = can('work_orders', 'edit')
  const [photos, setPhotos] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelWhy, setCancelWhy] = useState('')

  useEffect(() => {
    Promise.all(w.photos.map(woPhotoUrl)).then((u) => setPhotos(u.filter((x): x is string => !!x)))
  }, [w.photos])

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    setError(null)
    const { error: e } = await fn()
    setBusy(false)
    if (e) return setError(serviceErrorMessage(e.message))
    onChanged()
  }

  const r = w.request
  const payText = `السلام عليكم ${r.contact_name}، معك تنقية غيث بخصوص ${r.request_number}. المبلغ المستحق ${sar(w.amount_due)} شامل الضريبة. تقدر تدفع من «طلبات الصيانة» في حسابك: ${STORE_ORIGIN}/service`
  const quoteText = `السلام عليكم ${r.contact_name}، معك تنقية غيث. عرض السعر لطلبك ${r.request_number} جاهز: ${sar(w.total)} شامل الضريبة. تقدر توافق أو ترفض من «طلبات الصيانة» في حسابك: ${STORE_ORIGIN}/service`

  return (
    <div className="stack">
      <div className="grid-form">
        <div className="stack-sm">
          <b>البلاغ</b>
          <Link to="/p/appointments" className="link" dir="ltr">
            {r.request_number}
          </Link>
          <span className="muted">{r.neighborhood_name ?? '—'}</span>
        </div>
        <div className="stack-sm">
          <b>العميل</b>
          <div className="row wrapr">
            <a className="btn sm sec" href={`tel:${r.contact_phone}`} dir="ltr">
              {localPhone(r.contact_phone)}
            </a>
          </div>
        </div>
        <div className="stack-sm">
          <b>الفني</b>
          <span>{r.technician ? `${r.technician.full_name} · ${localPhone(r.technician.phone)}` : '—'}</span>
          {w.arrived_at && <span className="muted">وصل {when(w.arrived_at)}</span>}
        </div>
      </div>

      {w.report_at ? (
        <div className="card inset stack-sm">
          <b>
            تقرير الفحص <span className="muted">· {when(w.report_at)}{w.report_by ? ' · سجّله موظف' : ''}</span>
          </b>
          {w.customer_absent ? <span className="warn-text">العميل غير موجود وقت الزيارة.</span> : <span>{w.finding}</span>}
          {w.tech_note && <span className="muted">{w.tech_note}</span>}
          {w.parts.length > 0 && <span>القطع: {w.parts.map((p) => `${p.name_ar} × ${p.qty}`).join('، ')}</span>}
          {photos.length > 0 && (
            <div className="row wrapr">
              {photos.map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer">
                  <img src={u} alt="صورة من الفني" className="sr-photo" />
                </a>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="notice">بانتظار تقرير الفني من الرابط.</p>
      )}

      {w.status === 'visit' && editable && <StaffReport w={w} onDone={onChanged} />}
      {(w.status === 'report' || (w.status === 'quote' && !w.decision)) && editable && <QuoteForm w={w} onDone={onChanged} />}
      {w.status === 'approval' && (
        <p className="notice warn">
          خصم {sar(w.discount)} ({w.discount_reason}) بانتظار موافقة المدير في{' '}
          <Link to="/approvals" className="link">
            الموافقات
          </Link>
          .
        </p>
      )}

      {Number(w.total) > 0 && w.status !== 'report' && <QuoteSummary w={w} />}

      {w.status === 'quote' && editable && (
        <div className="act card inset stack-sm">
          <b>بانتظار رد العميل</b>
          <span className="muted">العميل يشوف العرض في «طلبات الصيانة» ويوافق أو يرفض. أو اتصل فيه وسجّل رده هنا.</span>
          <div className="row wrapr">
            <a className="btn sm sec" href={waLink(r.contact_phone, quoteText)} target="_blank" rel="noreferrer">
              أرسل العرض واتساب
            </a>
            <button className="btn sm" disabled={busy} onClick={() => run(() => supabase.rpc('wo_decide_staff', { p_work_order_id: w.id, p_decision: 'approved', p_note: null }))}>
              وافق بالهاتف
            </button>
            <button className="btn sm ghost danger" disabled={busy} onClick={() => run(() => supabase.rpc('wo_decide_staff', { p_work_order_id: w.id, p_decision: 'rejected', p_note: null }))}>
              رفض بالهاتف
            </button>
          </div>
        </div>
      )}

      {w.status === 'payment' && (editable || can('payments', 'edit')) && (
        <div className="act card inset stack-sm">
          <b>
            المستحق: {sar(w.amount_due)}{' '}
            <span className="muted">
              {w.customer_absent ? '(رسوم الفحص: العميل غير موجود)' : w.decision === 'rejected' ? '(رسوم الفحص: رفض العميل العرض)' : '(شامل الضريبة)'}
            </span>
          </b>
          <div className="row wrapr">
            <button
              className="btn sm"
              disabled={busy}
              onClick={() =>
                window.confirm(`الفني استلم ${sar(w.amount_due)} نقداً؟ تنفتح عليه عهدة بالمبلغ.`) &&
                run(() => supabase.rpc('wo_pay_cash', { p_work_order_id: w.id }))
              }
            >
              استلم الفني نقداً
            </button>
            {r.customer_id && (
              <a className="btn sm sec" href={waLink(r.contact_phone, payText)} target="_blank" rel="noreferrer">
                أرسل للعميل رابط الدفع
              </a>
            )}
          </div>
          {!r.customer_id && <span className="muted">العميل ما عنده حساب في المتجر، فالدفع نقداً للفني.</span>}
        </div>
      )}

      {w.status === 'paid' && editable && (
        <div className="act card inset stack-sm">
          <b>
            انحصّل {sar(w.amount_due)} {w.payment_method === 'cash' ? 'نقداً (عهدة على الفني)' : 'عن طريق ميسر'}
          </b>
          <span className="muted">
            {w.decision === 'approved' && w.parts.length > 0 ? 'الإغلاق يصرف القطع من المخزون وينهي البلاغ.' : 'الإغلاق ينهي البلاغ.'}
          </span>
          <button className="btn sm self-start" disabled={busy} onClick={() => run(() => supabase.rpc('wo_close', { p_work_order_id: w.id, p_note: null }))}>
            إغلاق أمر العمل
          </button>
        </div>
      )}

      {editable && ['visit', 'report', 'approval', 'quote', 'payment'].includes(w.status) && (
        <details className="sv-more">
          <summary>إلغاء أمر العمل</summary>
          <div className="row wrapr align-end">
            <div className="field grow">
              <label htmlFor={`cw-${w.id}`}>السبب</label>
              <input id={`cw-${w.id}`} className="input" maxLength={300} value={cancelWhy} onChange={(e) => setCancelWhy(e.target.value)} />
            </div>
            <button
              className="btn sm ghost danger field-btn"
              disabled={busy || !cancelWhy.trim()}
              onClick={() => run(() => supabase.rpc('wo_cancel', { p_work_order_id: w.id, p_reason: cancelWhy.trim() }))}
            >
              إلغاء أمر العمل
            </button>
          </div>
          <span className="muted">البلاغ يرجع «تم تحديد الموعد» وتقدر ترسل رابط جديد.</span>
        </details>
      )}
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}

function QuoteSummary({ w }: { w: Row }) {
  return (
    <table className="mini">
      <tbody>
        {w.parts.map((p) => (
          <tr key={p.id}>
            <td>
              {p.name_ar} × {p.qty}
            </td>
            <td>{p.unit_price !== null ? sar(Number(p.unit_price) * p.qty) : '—'}</td>
          </tr>
        ))}
        {Number(w.labor_fee) > 0 && (
          <tr>
            <td>أجرة اليد</td>
            <td>{sar(w.labor_fee)}</td>
          </tr>
        )}
        {Number(w.inspection_fee) > 0 && (
          <tr>
            <td>رسوم الفحص</td>
            <td>{sar(w.inspection_fee)}</td>
          </tr>
        )}
        {Number(w.discount) > 0 && (
          <tr>
            <td>خصم ({w.discount_reason})</td>
            <td>− {sar(w.discount)}</td>
          </tr>
        )}
        <tr>
          <td>الضريبة ({Math.round(Number(w.vat_rate) * 100)}٪)</td>
          <td>{sar(w.vat)}</td>
        </tr>
        <tr>
          <th>الإجمالي</th>
          <th>{sar(w.total)}</th>
        </tr>
      </tbody>
    </table>
  )
}

/** Staff price the report. */
function QuoteForm({ w, onDone }: { w: Row; onDone: () => void }) {
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [cfg, setCfg] = useState<{ vat_rate: number; discount_approval_limit: number } | null>(null)
  const [labor, setLabor] = useState(String(Number(w.labor_fee) || ''))
  const [discount, setDiscount] = useState(String(Number(w.discount) || ''))
  const [why, setWhy] = useState(w.discount_reason ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ids = w.parts.map((p) => p.product_id)
    Promise.all([
      ids.length ? supabase.from('products').select('id, price_before_vat').in('id', ids) : Promise.resolve({ data: [] }),
      supabase.from('settings').select('vat_rate, discount_approval_limit').eq('id', 1).maybeSingle(),
    ]).then(([p, s]) => {
      setPrices(Object.fromEntries(((p.data ?? []) as { id: string; price_before_vat: number }[]).map((x) => [x.id, Number(x.price_before_vat)])))
      setCfg(s.data ? { vat_rate: Number(s.data.vat_rate), discount_approval_limit: Number(s.data.discount_approval_limit) } : null)
    })
  }, [w.parts])

  const sum = useMemo(() => {
    const parts = w.parts.reduce((a, p) => a + (prices[p.product_id] ?? 0) * p.qty, 0)
    const base = Math.max(0, parts + (Number(labor) || 0) + Number(w.inspection_fee) - (Number(discount) || 0))
    const vat = Math.round(base * (cfg?.vat_rate ?? 0) * 100) / 100
    return { parts, base, vat, total: base + vat }
  }, [w.parts, w.inspection_fee, prices, labor, discount, cfg])
  const needsOk = cfg !== null && (Number(discount) || 0) > cfg.discount_approval_limit

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('wo_quote', {
      p_work_order_id: w.id,
      p_labor_fee: Number(labor) || 0,
      p_discount: Number(discount) || 0,
      p_discount_reason: why.trim() || null,
    })
    setBusy(false)
    if (err) return setError(serviceErrorMessage(err.message))
    onDone()
  }

  if (w.customer_absent) return null
  return (
    <form className="act card inset stack-sm" onSubmit={save}>
      <b>{w.status === 'quote' ? 'تعديل العرض' : 'جهّز عرض السعر'}</b>
      {w.parts.length > 0 && (
        <table className="mini">
          <tbody>
            {w.parts.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.name_ar} × {p.qty}
                </td>
                <td>{prices[p.product_id] !== undefined ? sar(prices[p.product_id] * p.qty) : '…'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <span className="muted">أسعار القطع من المنتجات (قبل الضريبة).</span>
      <div className="row wrapr align-end">
        <div className="field">
          <label htmlFor={`lab-${w.id}`}>أجرة اليد (ر.س قبل الضريبة)</label>
          <input id={`lab-${w.id}`} className="input num" inputMode="decimal" dir="ltr" style={{ width: 120 }} value={labor} onChange={(e) => setLabor(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
        <div className="field">
          <label htmlFor={`dis-${w.id}`}>خصم (اختياري)</label>
          <input id={`dis-${w.id}`} className="input num" inputMode="decimal" dir="ltr" style={{ width: 120 }} value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^0-9.]/g, ''))} />
        </div>
        {(Number(discount) || 0) > 0 && (
          <div className="field grow">
            <label htmlFor={`why-${w.id}`}>سبب الخصم</label>
            <input id={`why-${w.id}`} className="input" maxLength={300} value={why} onChange={(e) => setWhy(e.target.value)} />
          </div>
        )}
      </div>
      <p className="inset-box">
        القطع {sar(sum.parts)} + أجرة اليد {sar(Number(labor) || 0)}
        {Number(w.inspection_fee) > 0 && <> + رسوم الفحص {sar(w.inspection_fee)}</>}
        {(Number(discount) || 0) > 0 && <> − خصم {sar(Number(discount))}</>} + الضريبة {sar(sum.vat)} = <b>{sar(sum.total)}</b>
      </p>
      {needsOk && <span className="warn-text">الخصم فوق الحد ({sar(cfg!.discount_approval_limit)}): يروح لموافقة المدير قبل ما يوصل العميل.</span>}
      {error && <p className="form-error">{error}</p>}
      <button className="btn sm self-start" disabled={busy}>
        {needsOk ? 'أرسل للمدير' : 'أرسل العرض للعميل'}
      </button>
    </form>
  )
}

/** «أسجل نيابة عن الفني» */
function StaffReport({ w, onDone }: { w: Row; onDone: () => void }) {
  const [openForm, setOpenForm] = useState(false)
  const [absent, setAbsent] = useState(false)
  const [finding, setFinding] = useState('')
  const [note, setNote] = useState('')
  const [catalog, setCatalog] = useState<{ id: string; name_ar: string }[]>([])
  const [lines, setLines] = useState<{ product_id: string; qty: number }[]>([])
  const [pick, setPick] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!openForm) return
    supabase
      .from('products')
      .select('id, name_ar')
      .eq('status', 'published')
      .in('type', PART_TYPES)
      .order('name_ar')
      .then(({ data }) => setCatalog((data ?? []) as { id: string; name_ar: string }[]))
  }, [openForm])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('wo_report_staff', {
      p_work_order_id: w.id,
      p_absent: absent,
      p_finding: absent ? null : finding.trim() || null,
      p_note: note.trim() || null,
      p_parts: absent ? [] : lines,
    })
    setBusy(false)
    if (err) return setError(serviceErrorMessage(err.message))
    onDone()
  }

  if (!openForm) {
    return (
      <button className="btn sm ghost self-start" onClick={() => setOpenForm(true)}>
        أسجل نيابة عن الفني
      </button>
    )
  }
  return (
    <form className="act card inset stack-sm" onSubmit={save}>
      <b>تقرير الفحص (نيابة عن الفني)</b>
      <div className="chips">
        <button type="button" className={!absent ? 'on' : undefined} onClick={() => setAbsent(false)}>
          فحص الجهاز
        </button>
        <button type="button" className={absent ? 'on' : undefined} onClick={() => setAbsent(true)}>
          العميل غير موجود
        </button>
      </div>
      {!absent && (
        <>
          <div className="field">
            <label htmlFor={`f-${w.id}`}>نتيجة الفحص</label>
            <textarea id={`f-${w.id}`} className="input" rows={2} maxLength={1000} value={finding} onChange={(e) => setFinding(e.target.value)} />
          </div>
          <div className="row wrapr align-end">
            <div className="field grow">
              <label htmlFor={`p-${w.id}`}>القطع</label>
              <select id={`p-${w.id}`} className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">اختر…</option>
                {catalog.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_ar}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn sm field-btn"
              disabled={!pick}
              onClick={() => {
                setLines((l) => (l.some((x) => x.product_id === pick) ? l.map((x) => (x.product_id === pick ? { ...x, qty: x.qty + 1 } : x)) : [...l, { product_id: pick, qty: 1 }]))
                setPick('')
              }}
            >
              إضافة
            </button>
          </div>
          {lines.length > 0 && (
            <span>
              {lines.map((l) => `${catalog.find((c) => c.id === l.product_id)?.name_ar} × ${l.qty}`).join('، ')}{' '}
              <button type="button" className="linkbtn" onClick={() => setLines([])}>
                مسح
              </button>
            </span>
          )}
        </>
      )}
      <div className="field">
        <label htmlFor={`n-${w.id}`}>ملاحظة</label>
        <input id={`n-${w.id}`} className="input" maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="row">
        <button className="btn sm" disabled={busy}>
          حفظ التقرير
        </button>
        <button type="button" className="btn sm ghost" onClick={() => setOpenForm(false)}>
          إلغاء
        </button>
      </div>
    </form>
  )
}
