import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  OPEN_SERVICE_STATUSES,
  PERIOD_LABELS,
  SERVICE_KIND_LABELS,
  SERVICE_STATUS_LABELS,
  serviceErrorMessage,
} from '@ghaith/shared'
import { formatSar } from '../lib/catalog'
import { formatDate } from '../lib/orders'
import { cancelMyRequest, fetchMyRequests, fetchRequestEvents } from '../lib/service'
import { usePageMeta } from '../lib/seo'
import { useAsync } from '../lib/useAsync'

export { ServiceNew } from './ServiceNew'

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
