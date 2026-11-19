import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  OPEN_SERVICE_STATUSES,
  PERIOD_LABELS,
  SERVICE_KIND_LABELS,
  SERVICE_STATUS_LABELS,
  WO_CUSTOMER_LABELS,
  serviceErrorMessage,
  type WorkOrder,
} from '@ghaith/shared'
import { formatSar } from '../lib/catalog'
import { formatDate } from '../lib/orders'
import { cancelMyRequest, decideMyQuote, fetchMyRequests, fetchMyWorkOrders, fetchRequestEvents } from '../lib/service'
import { usePageMeta } from '../lib/seo'
import { useAsync } from '../lib/useAsync'

export { ServiceNew } from './ServiceNew'

async function loadList() {
  const requests = await fetchMyRequests()
  const [events, workOrders] = await Promise.all([
    fetchRequestEvents(requests.filter((r) => OPEN_SERVICE_STATUSES.includes(r.status)).map((r) => r.id)),
    fetchMyWorkOrders(requests.slice(0, 20).map((r) => r.id)),
  ])
  return { requests, events, workOrders }
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
          const wo = state.data.workOrders.find((w) => w.request_id === r.id)
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
              {r.kind === 'emergency' && Number(r.inspection_fee) > 0 && r.status !== 'cancelled' && !wo?.quote_at && (
                <span className="muted">رسوم الفحص {formatSar(Number(r.inspection_fee))} قبل الضريبة، تندفع عند الزيارة.</span>
              )}
              {r.status === 'cancelled' && r.cancel_reason && <span className="muted">سبب الإلغاء: {r.cancel_reason}</span>}
              {wo && <QuoteBox w={wo} onChange={reload} />}
              {(r.status === 'new' || r.status === 'scheduled') && !wo && (
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

/** The work order as the customer sees it: the quote, approve / reject, pay. */
function QuoteBox({ w, onChange }: { w: WorkOrder; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(d: 'approved' | 'rejected') {
    const msg =
      d === 'approved'
        ? `موافق على العرض بمبلغ ${formatSar(Number(w.total))} شامل الضريبة؟`
        : Number(w.inspection_fee) > 0
          ? `رفض العرض؟ تبقى عليك رسوم الفحص ${formatSar(Number(w.inspection_fee) * (1 + Number(w.vat_rate)))} شامل الضريبة.`
          : 'رفض العرض؟'
    if (!window.confirm(msg)) return
    setBusy(true)
    setError(null)
    try {
      await decideMyQuote(w.id, d)
      onChange()
    } catch (e) {
      setError(serviceErrorMessage((e as Error).message))
      setBusy(false)
    }
  }

  const showQuote = w.quote_at && !w.customer_absent
  return (
    <div className="inset-box stack-sm">
      <span>
        <b>{WO_CUSTOMER_LABELS[w.status]}</b>
        {w.customer_absent && <span className="muted"> · زارك الفني وما كان فيه أحد</span>}
      </span>
      {w.finding && <span>نتيجة الفحص: {w.finding}</span>}
      {showQuote && (
        <table className="mini">
          <tbody>
            {(w.parts ?? []).map((p) => (
              <tr key={p.id}>
                <td>
                  {p.name_ar} × {p.qty}
                </td>
                <td>{formatSar(Number(p.unit_price ?? 0) * p.qty)}</td>
              </tr>
            ))}
            {Number(w.labor_fee) > 0 && (
              <tr>
                <td>أجرة اليد</td>
                <td>{formatSar(Number(w.labor_fee))}</td>
              </tr>
            )}
            {Number(w.inspection_fee) > 0 && (
              <tr>
                <td>رسوم الفحص</td>
                <td>{formatSar(Number(w.inspection_fee))}</td>
              </tr>
            )}
            {Number(w.discount) > 0 && (
              <tr>
                <td>خصم</td>
                <td>− {formatSar(Number(w.discount))}</td>
              </tr>
            )}
            <tr>
              <td>الضريبة</td>
              <td>{formatSar(Number(w.vat))}</td>
            </tr>
            <tr>
              <th>الإجمالي</th>
              <th>{formatSar(Number(w.total))}</th>
            </tr>
          </tbody>
        </table>
      )}
      {w.status === 'quote' && (
        <div className="row wrapr">
          <button className="btn sm" disabled={busy} onClick={() => decide('approved')}>
            موافق على العرض
          </button>
          <button className="btn sm ghost" disabled={busy} onClick={() => decide('rejected')}>
            ما أبغى الإصلاح
          </button>
        </div>
      )}
      {w.status === 'payment' && (
        <div className="row wrapr">
          <b>المطلوب: {formatSar(Number(w.amount_due))}</b>
          <Link to={`/service/pay/${w.id}`} className="btn sm">
            ادفع بالبطاقة
          </Link>
          <span className="muted">أو ادفع نقداً للفني.</span>
        </div>
      )}
      {(w.status === 'paid' || w.status === 'closed') && Number(w.amount_due) > 0 && (
        <span className="muted">
          دفعت {formatSar(Number(w.amount_due))} {w.payment_method === 'moyasar' ? 'بالبطاقة' : 'نقداً'}. شكراً لك.
        </span>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
