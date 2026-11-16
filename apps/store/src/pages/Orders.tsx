import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  effectiveStatus,
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  orderErrorMessage,
  orderGroup,
  orderStages,
  type OrderEvent,
  type OrderItem,
  type OrderStatus,
} from '@ghaith/shared'
import { formatSar } from '../lib/catalog'
import { cancelMyOrder, fetchMyOrders, fetchMyReviews, fetchOrder, fetchOrderEvents, formatDate, submitReview, type MyReview } from '../lib/orders'
import { usePageMeta } from '../lib/seo'
import { useAsync } from '../lib/useAsync'

const STATUS_CLS: Partial<Record<OrderStatus, string>> = { pending_payment: 'warn', cancelled: 'off', completed: 'ok', delivered: 'ok' }

function StatusTag({ status }: { status: OrderStatus }) {
  return <span className={`tag ${STATUS_CLS[status] ?? ''}`}>{ORDER_STATUS_LABELS[status]}</span>
}

type Tab = 'active' | 'done' | 'cancelled'
const TABS: { key: Tab; label: string }[] = [
  { key: 'active', label: 'جارية' },
  { key: 'done', label: 'مكتملة' },
  { key: 'cancelled', label: 'ملغاة' },
]

export function Orders() {
  usePageMeta('طلباتي')
  const { state, reload } = useAsync(fetchMyOrders)
  const [tab, setTab] = useState<Tab>('active')

  const list = state.status === 'success' ? state.data : []
  const inTab = (t: Tab) => list.filter((o) => orderGroup(effectiveStatus(o)) === t)

  return (
    <div className="stack narrow">
      <div className="row between wrapr">
        <h1 className="page-h">طلباتي</h1>
        <Link to="/devices" className="link">
          أجهزتي
        </Link>
      </div>
      {state.status === 'loading' && <p className="muted">جاري التحميل…</p>}
      {state.status === 'error' && (
        <div className="notice bad" role="alert">
          <b>تعذّر تحميل طلباتك.</b>
          <button className="btn sm" onClick={reload}>
            إعادة المحاولة
          </button>
        </div>
      )}
      {state.status === 'success' && list.length === 0 && (
        <div className="notice">
          <b>لا توجد طلبات بعد.</b>
          <span className="muted">عند إتمام أول طلب سيظهر هنا مع حالته.</span>
          <Link to="/products" className="btn sm">
            تصفح المنتجات
          </Link>
        </div>
      )}
      {list.length > 0 && (
        <>
          <div className="seg" role="tablist" aria-label="حالة الطلبات">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'on' : undefined} onClick={() => setTab(t.key)}>
                {t.label} ({inTab(t.key).length})
              </button>
            ))}
          </div>
          {inTab(tab).length === 0 && <p className="muted">ما في طلبات هنا.</p>}
          {inTab(tab).map((o) => (
            <Link key={o.id} to={`/orders/${o.id}`} className="card order-row">
              <div className="stack-sm">
                <b dir="ltr">{o.order_number}</b>
                <span className="muted">
                  {formatDate(o.created_at)} · {FULFILLMENT_LABELS[o.fulfillment]}
                </span>
              </div>
              <div className="stack-sm end">
                <StatusTag status={effectiveStatus(o)} />
                <b>{formatSar(Number(o.total))}</b>
              </div>
            </Link>
          ))}
        </>
      )}
    </div>
  )
}

async function loadOrder(id: string) {
  const [data, events, reviews] = await Promise.all([fetchOrder(id), fetchOrderEvents(id), fetchMyReviews()])
  return data ? { ...data, events, reviews } : null
}

export function OrderPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const isNew = params.get('new') === '1'
  const justPaid = params.get('paid') === '1'
  const { state, reload } = useAsync(() => loadOrder(id), [id])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  usePageMeta(state.status === 'success' && state.data ? `الطلب ${state.data.order.order_number}` : 'الطلب')

  if (state.status === 'loading') return <p className="muted">جاري التحميل…</p>
  if (state.status === 'error') {
    return (
      <div className="notice bad" role="alert">
        <b>تعذّر تحميل الطلب.</b>
        <button className="btn sm" onClick={reload}>
          إعادة المحاولة
        </button>
      </div>
    )
  }
  if (!state.data) {
    return (
      <div className="notice">
        <b>ما لقينا هذا الطلب.</b>
        <Link to="/orders" className="link">
          طلباتي
        </Link>
      </div>
    )
  }

  const { order: o, items, events, reviews } = state.data
  const status = effectiveStatus(o)
  const vatPct = Math.round(Number(o.vat_rate) * 100)
  const canCancel = (status === 'pending_payment' || status === 'paid') && !o.stock_issued_at
  const received = status === 'delivered' || status === 'completed'

  async function cancel() {
    if (!window.confirm(`إلغاء الطلب ${o.order_number}؟${o.paid_at ? ' ونرجّع لك المبلغ كامل.' : ''}`)) return
    setBusy(true)
    setError(null)
    try {
      await cancelMyOrder(o.id)
      reload()
    } catch (e) {
      setError(orderErrorMessage(e instanceof Error ? e.message : null))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack narrow">
      {isNew && status === 'pending_payment' && (
        <div className="notice ok" role="status">
          <b>تم استلام طلبك رقم {o.order_number}.</b>
          <span>طلبك محجوز لك لين {formatDate(o.expires_at, true)}. ادفع الحين عشان نبدأ تجهيزه.</span>
        </div>
      )}
      {justPaid && o.paid_at && (
        <div className="notice ok" role="status">
          <b>تم الدفع ✓ شكراً لك.</b>
          <span>بنبدأ تجهيز طلبك، وتقدر تتابعه من هنا.</span>
        </div>
      )}
      {status === 'pending_payment' && (
        <div className="card stack-sm">
          <div className="row between wrapr">
            <b>المبلغ المطلوب: {formatSar(Number(o.total))}</b>
            <Link to={`/orders/${o.id}/pay`} className="btn">
              ادفع الآن
            </Link>
          </div>
          <span className="muted">مدى، فيزا، ماستركارد. الطلب ينلغي إذا ما اندفع قبل {formatDate(o.expires_at, true)}.</span>
        </div>
      )}

      <div className="row wrapr between">
        <h1 className="page-h" dir="ltr">
          {o.order_number}
        </h1>
        <StatusTag status={status} />
      </div>
      <p className="muted">
        {formatDate(o.created_at, true)} · {FULFILLMENT_LABELS[o.fulfillment]}
      </p>
      {status === 'cancelled' && (o.status === 'pending_payment' || o.cancel_reason === 'expired') && (
        <p className="notice warn">انتهت مهلة الدفع (24 ساعة) وانلغى الطلب. تقدر تطلب من جديد.</p>
      )}
      {o.status === 'cancelled' && o.cancel_reason && o.cancel_reason !== 'expired' && <p className="notice warn">انلغى الطلب: {o.cancel_reason}</p>}
      {o.refund_status === 'due' && <p className="notice">نرجّع لك المبلغ {formatSar(Number(o.total))} خلال أيام العمل القادمة.</p>}
      {o.refund_status === 'done' && <p className="notice ok">تم إرجاع المبلغ {formatSar(Number(o.total))}.</p>}

      {status !== 'cancelled' && <Tracking fulfillment={o.fulfillment} status={status} events={events} />}
      {o.tracking_number && (
        <p className="notice">
          <span>
            رقم تتبع الشحنة{o.shipping_carrier ? ` (${o.shipping_carrier})` : ''}: <b dir="ltr">{o.tracking_number}</b>
          </span>
        </p>
      )}

      <section className="card">
        <h2 className="h3">المنتجات</h2>
        <ul className="co-items">
          {items.map((i) => (
            <li key={i.id}>
              <span>
                {i.name_ar} {i.qty > 1 && <span className="muted">× {i.qty}</span>}
              </span>
              <span>{formatSar(Number(i.line_total))}</span>
            </li>
          ))}
        </ul>
        <dl className="sum">
          <div>
            <dt>المجموع قبل الضريبة</dt>
            <dd>{formatSar(Number(o.subtotal))}</dd>
          </div>
          {Number(o.install_fee) > 0 && (
            <div>
              <dt>التركيب ({o.install_units === 1 ? 'جهاز واحد' : `${o.install_units} أجهزة`})</dt>
              <dd>{formatSar(Number(o.install_fee))}</dd>
            </div>
          )}
          {Number(o.shipping_fee) > 0 && (
            <div>
              <dt>الشحن</dt>
              <dd>{formatSar(Number(o.shipping_fee))}</dd>
            </div>
          )}
          <div>
            <dt>ضريبة القيمة المضافة ({vatPct}٪)</dt>
            <dd>{formatSar(Number(o.vat_amount))}</dd>
          </div>
          <div className="grand">
            <dt>الإجمالي</dt>
            <dd>{formatSar(Number(o.total))}</dd>
          </div>
        </dl>
        {o.paid_at && (
          <Link to={`/orders/${o.id}/invoice`} className="link">
            عرض الفاتورة وطباعتها
          </Link>
        )}
      </section>

      {received && (
        <section className="card stack">
          <h2 className="h3">قيّم مشترياتك</h2>
          {items.map((i) => (
            <ReviewForm key={i.id} item={i} existing={reviews.find((r) => r.product_id === i.product_id)} />
          ))}
        </section>
      )}

      <section className="card">
        <h2 className="h3">التوصيل</h2>
        <dl className="sum">
          <div>
            <dt>الاسم</dt>
            <dd>{o.contact_name}</dd>
          </div>
          <div>
            <dt>العنوان</dt>
            <dd>{[o.city, o.neighborhood_name, o.street].filter(Boolean).join('، ')}</dd>
          </div>
          {o.address_notes && (
            <div>
              <dt>وصف</dt>
              <dd>{o.address_notes}</dd>
            </div>
          )}
          {o.preferred_visit_date && (
            <div>
              <dt>{o.fulfillment === 'delivery_install' ? 'اليوم المفضل للتركيب' : 'اليوم المفضل للزيارة'}</dt>
              <dd>{formatDate(o.preferred_visit_date)}</dd>
            </div>
          )}
          {o.customer_notes && (
            <div>
              <dt>ملاحظاتك</dt>
              <dd>{o.customer_notes}</dd>
            </div>
          )}
        </dl>
      </section>

      {canCancel && (
        <section className="card stack-sm">
          <span className="muted">تقدر تلغي الطلب قبل ما نبدأ تجهيزه{o.paid_at ? '، ونرجّع لك المبلغ كامل' : ''}.</span>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn sm ghost danger self-start" disabled={busy} onClick={cancel}>
            {busy ? 'جاري الإلغاء…' : 'إلغاء الطلب'}
          </button>
        </section>
      )}
      {!canCancel && ['preparing', 'shipped', 'installing'].includes(status) && (
        <p className="muted">بدأنا تجهيز طلبك. لأي تعديل أو إلغاء تواصل معنا.</p>
      )}

      <Link to="/orders" className="link">
        كل طلباتي
      </Link>
    </div>
  )
}

/** The order's stages with the date each was reached. */
function Tracking({ fulfillment, status, events }: { fulfillment: Parameters<typeof orderStages>[0]; status: OrderStatus; events: OrderEvent[] }) {
  const stages = orderStages(fulfillment)
  const at = stages.indexOf(status)
  const last = (s: OrderStatus) => [...events].reverse().find((e) => e.status === s)
  return (
    <ol className="track" aria-label="تتبع الطلب">
      {stages.map((s, i) => {
        const e = last(s)
        return (
          <li key={s} className={i < at ? 'done' : i === at ? 'now' : undefined} aria-current={i === at ? 'step' : undefined}>
            <b>{ORDER_STATUS_LABELS[s]}</b>
            {e && i <= at && <span className="muted">{formatDate(e.created_at, true)}</span>}
            {e?.note && i <= at && <span>{e.note}</span>}
          </li>
        )
      })}
    </ol>
  )
}

function ReviewForm({ item, existing }: { item: OrderItem; existing?: MyReview }) {
  const [rating, setRating] = useState(existing?.rating ?? 0)
  const [body, setBody] = useState(existing?.body ?? '')
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)

  if (item.type === 'service' && !existing) return null

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (rating < 1) return setError('اختر عدد النجوم.')
    setState('busy')
    setError(null)
    try {
      await submitReview(item.product_id, rating, body.trim())
      setState('sent')
    } catch (err) {
      setError(orderErrorMessage(err instanceof Error ? err.message : null))
      setState('idle')
    }
  }

  const status = state === 'sent' ? 'pending' : existing?.status
  return (
    <form className="review-form" onSubmit={send}>
      <b>{item.name_ar}</b>
      <div className="stars-input" role="radiogroup" aria-label="التقييم">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} من 5`} className={n <= rating ? 'on' : undefined} onClick={() => setRating(n)}>
            ★
          </button>
        ))}
      </div>
      <textarea className="input area" rows={2} placeholder="اكتب رأيك (اختياري)" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="row wrapr">
        <button className="btn sm" disabled={state === 'busy'}>
          {existing || state === 'sent' ? 'تحديث التقييم' : 'إرسال التقييم'}
        </button>
        {status === 'pending' && <span className="muted">وصلنا تقييمك، ويظهر في المتجر بعد المراجعة. شكراً لك.</span>}
        {status === 'approved' && <span className="muted">تقييمك منشور في المتجر ✓</span>}
      </div>
    </form>
  )
}
