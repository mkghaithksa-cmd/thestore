import { Link, useParams, useSearchParams } from 'react-router-dom'
import { effectiveStatus, FULFILLMENT_LABELS, ORDER_STATUS_LABELS, type OrderStatus } from '@ghaith/shared'
import { formatSar } from '../lib/catalog'
import { fetchMyOrders, fetchOrder, formatDate } from '../lib/orders'
import { usePageMeta } from '../lib/seo'
import { useAsync } from '../lib/useAsync'

const STATUS_CLS: Partial<Record<OrderStatus, string>> = { pending_payment: 'warn', cancelled: 'off', paid: 'ok', completed: 'ok', delivered: 'ok' }

function StatusTag({ status }: { status: OrderStatus }) {
  return <span className={`tag ${STATUS_CLS[status] ?? ''}`}>{ORDER_STATUS_LABELS[status]}</span>
}

export function Orders() {
  usePageMeta('طلباتي')
  const { state, reload } = useAsync(fetchMyOrders)

  return (
    <div className="stack narrow">
      <h1 className="page-h">طلباتي</h1>
      {state.status === 'loading' && <p className="muted">جاري التحميل…</p>}
      {state.status === 'error' && (
        <div className="notice bad" role="alert">
          <b>تعذّر تحميل طلباتك.</b>
          <button className="btn sm" onClick={reload}>
            إعادة المحاولة
          </button>
        </div>
      )}
      {state.status === 'success' && state.data.length === 0 && (
        <div className="notice">
          <b>لا توجد طلبات بعد.</b>
          <span className="muted">عند إتمام أول طلب سيظهر هنا مع حالته.</span>
          <Link to="/products" className="btn sm">
            تصفح المنتجات
          </Link>
        </div>
      )}
      {state.status === 'success' &&
        state.data.map((o) => (
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
    </div>
  )
}

export function OrderPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const isNew = params.get('new') === '1'
  const { state, reload } = useAsync(() => fetchOrder(id), [id])
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

  const { order: o, items } = state.data
  const status = effectiveStatus(o)
  const vatPct = Math.round(Number(o.vat_rate) * 100)

  return (
    <div className="stack narrow">
      {isNew && status === 'pending_payment' && (
        <div className="notice ok" role="status">
          <b>تم استلام طلبك رقم {o.order_number}.</b>
          <span>
            طلبك محجوز لك وبانتظار الدفع لين {formatDate(o.expires_at, true)}. الدفع الإلكتروني (مدى والبطاقات) يتفعّل قريباً، وبنتواصل معك على جوالك
            لتأكيد الطلب.
          </span>
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
      </section>

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

      <Link to="/orders" className="link">
        كل طلباتي
      </Link>
    </div>
  )
}
