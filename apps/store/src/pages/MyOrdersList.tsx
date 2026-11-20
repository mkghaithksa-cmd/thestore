import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  effectiveStatus,
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  orderGroup,
  orderStages,
  SERVICE_KIND_LABELS,
  SERVICE_STATUS_LABELS,
  WO_CUSTOMER_LABELS,
  type Order,
  type OrderItem,
  type ServiceRequest,
  type WorkOrder,
} from '@ghaith/shared'
import { useCart } from '../lib/cart'
import { formatSar, mainImageUrl } from '../lib/catalog'
import { fetchMyOrders, fetchOrderItems, formatDate } from '../lib/orders'
import { fetchMyRequests, fetchMyWorkOrders } from '../lib/service'
import { usePageMeta } from '../lib/seo'
import { useAsync } from '../lib/useAsync'
import { useCatalog } from '../lib/useCatalog'

async function load() {
  const [orders, requests] = await Promise.all([fetchMyOrders(), fetchMyRequests()])
  const [items, workOrders] = await Promise.all([fetchOrderItems(orders.map((o) => o.id)), fetchMyWorkOrders(requests.slice(0, 30).map((r) => r.id))])
  return { orders, items, requests, workOrders }
}

type Tone = 'warn' | 'ok' | 'off' | ''
interface Entry {
  key: string
  kind: 'order' | 'service'
  at: string
  number: string
  title: string
  sub: string
  status: string
  tone: Tone
  active: boolean
  steps: string[]
  step: number
  thumbs: { src: string | null; alt: string }[]
  more: number
  total: number | null
  to: string
  action: { label: string; to: string; primary: boolean } | null
  reorder: OrderItem[] | null
}

const SERVICE_STEPS = ['تم الطلب', 'تحدد الموعد', 'الفني عندك', 'تمت الزيارة']
const SERVICE_STEP_OF = { new: 0, scheduled: 1, in_progress: 2, done: 3, cancelled: -1 } as const

function orderEntry(o: Order, items: OrderItem[], img: (id: string) => string | null): Entry {
  const status = effectiveStatus(o)
  const stages = orderStages(o.fulfillment)
  const mine = items.filter((i) => i.order_id === o.id)
  const done = status === 'delivered' || status === 'completed'
  const action =
    status === 'pending_payment'
      ? { label: 'ادفع الآن', to: `/orders/${o.id}/pay`, primary: true }
      : status === 'cancelled' || done
        ? null
        : { label: 'تتبّع الطلب', to: `/orders/${o.id}`, primary: false }
  return {
    key: `o-${o.id}`,
    kind: 'order',
    at: o.created_at,
    number: o.order_number,
    title: mine.length === 1 ? mine[0].name_ar : mine.length ? `${mine[0].name_ar} و${mine.length - 1 === 1 ? 'منتج ثاني' : `${mine.length - 1} منتجات`}` : 'طلب من المتجر',
    sub: `${formatDate(o.created_at)} · ${FULFILLMENT_LABELS[o.fulfillment]}`,
    status: ORDER_STATUS_LABELS[status],
    tone: status === 'pending_payment' ? 'warn' : status === 'cancelled' ? 'off' : done ? 'ok' : '',
    active: orderGroup(status) === 'active',
    steps: status === 'cancelled' ? [] : stages.map((s) => ORDER_STATUS_LABELS[s]),
    step: stages.indexOf(status),
    thumbs: mine.slice(0, 3).map((i) => ({ src: img(i.product_id), alt: i.name_ar })),
    more: Math.max(0, mine.length - 3),
    total: Number(o.total),
    to: `/orders/${o.id}`,
    action,
    reorder: status === 'cancelled' || done ? mine : null,
  }
}

function serviceEntry(r: ServiceRequest, wo: WorkOrder | undefined): Entry {
  const step = SERVICE_STEP_OF[r.status]
  const anchor = `/service#sr-${r.id}`
  const action =
    wo?.status === 'quote'
      ? { label: 'شوف عرض السعر', to: anchor, primary: true }
      : wo?.status === 'payment'
        ? { label: `ادفع ${formatSar(Number(wo.amount_due))}`, to: `/service/pay/${wo.id}`, primary: true }
        : r.status === 'done' || r.status === 'cancelled'
          ? null
          : { label: 'التفاصيل', to: anchor, primary: false }
  const when =
    r.scheduled_at && (r.status === 'scheduled' || r.status === 'in_progress')
      ? `الموعد ${formatDate(r.scheduled_at, true)}`
      : formatDate(r.created_at)
  return {
    key: `s-${r.id}`,
    kind: 'service',
    at: r.created_at,
    number: r.request_number,
    title: r.fault_type ? `${SERVICE_KIND_LABELS[r.kind]}: ${r.fault_type}` : SERVICE_KIND_LABELS[r.kind],
    sub: [when, r.neighborhood_name].filter(Boolean).join(' · '),
    status: wo && r.status !== 'cancelled' && !['closed', 'cancelled'].includes(wo.status) ? WO_CUSTOMER_LABELS[wo.status] : SERVICE_STATUS_LABELS[r.status],
    tone: wo?.status === 'quote' || wo?.status === 'payment' || r.status === 'new' ? 'warn' : r.status === 'done' ? 'ok' : r.status === 'cancelled' ? 'off' : '',
    active: r.status !== 'done' && r.status !== 'cancelled',
    steps: r.status === 'cancelled' ? [] : SERVICE_STEPS,
    step,
    thumbs: [],
    more: 0,
    total: wo && Number(wo.total) > 0 && wo.quote_at ? Number(wo.total) : null,
    to: anchor,
    action,
    reorder: null,
  }
}

type Tab = 'active' | 'all' | 'ended'

/** «طلباتي»: store orders and maintenance visits together, newest first. */
export function Orders() {
  usePageMeta('طلباتي')
  const { state, reload } = useAsync(load)
  const catalog = useCatalog()
  const cart = useCart()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab | null>(null)

  const entries = useMemo(() => {
    if (state.status !== 'success') return []
    const products = catalog.state.status === 'success' ? catalog.state.data.products : []
    const img = (id: string) => {
      const p = products.find((x) => x.id === id)
      return p ? mainImageUrl(p) : null
    }
    const { orders, items, requests, workOrders } = state.data
    return [
      ...orders.map((o) => orderEntry(o, items, img)),
      ...requests.map((r) => serviceEntry(r, workOrders.find((w) => w.request_id === r.id))),
    ].sort((a, b) => b.at.localeCompare(a.at))
  }, [state, catalog.state])

  const active = entries.filter((e) => e.active)
  const current: Tab = tab ?? (active.length ? 'active' : 'all')
  const shown = current === 'active' ? active : current === 'ended' ? entries.filter((e) => !e.active) : entries
  const waiting = entries.filter((e) => e.action?.primary).length

  const reorder = (lines: OrderItem[]) => {
    const products = catalog.state.status === 'success' ? catalog.state.data.products : []
    let added = 0
    for (const l of lines) {
      if (products.some((p) => p.id === l.product_id)) {
        cart.add(l.product_id, l.qty)
        added++
      }
    }
    if (added) navigate('/cart')
    else window.alert('المنتجات في هذا الطلب ما عادت متوفرة.')
  }

  return (
    <div className="stack narrow">
      <div className="row between wrapr">
        <h1 className="page-h">طلباتي</h1>
        <div className="row wrapr">
          <Link to="/devices" className="link">
            أجهزتي
          </Link>
          <Link to="/service/new?kind=emergency" className="btn sm ghost">
            بلّغ عن عطل
          </Link>
        </div>
      </div>

      {state.status === 'loading' && (
        <div className="stack" aria-hidden="true">
          <div className="card skel" />
          <div className="card skel" />
        </div>
      )}
      {state.status === 'error' && (
        <div className="notice bad" role="alert">
          <b>تعذّر تحميل طلباتك.</b>
          <button className="btn sm" onClick={reload}>
            إعادة المحاولة
          </button>
        </div>
      )}
      {state.status === 'success' && entries.length === 0 && (
        <div className="card empty-state">
          <b>ما عندك طلبات للحين.</b>
          <span className="muted">لما تطلب من المتجر أو تحجز صيانة، تتابعه من هنا خطوة بخطوة.</span>
          <div className="row wrapr">
            <Link to="/products" className="btn">
              تصفح المنتجات
            </Link>
            <Link to="/service/new?kind=maintenance" className="btn ghost">
              احجز صيانة
            </Link>
          </div>
        </div>
      )}

      {entries.length > 0 && (
        <>
          {waiting > 0 && (
            <p className="notice warn" role="status">
              <b>{waiting === 1 ? 'عندك طلب ينتظر منك خطوة' : `عندك ${waiting} طلبات تنتظر منك خطوة`}</b>
            </p>
          )}
          <div className="seg" role="tablist" aria-label="الطلبات">
            {(
              [
                ['active', 'جارية', active.length],
                ['all', 'الكل', entries.length],
                ['ended', 'منتهية', entries.length - active.length],
              ] as [Tab, string, number][]
            ).map(([k, l, n]) => (
              <button key={k} type="button" role="tab" aria-selected={current === k} className={current === k ? 'on' : undefined} onClick={() => setTab(k)}>
                {l} ({n})
              </button>
            ))}
          </div>
          {shown.length === 0 && <p className="muted">ما في طلبات هنا.</p>}
          <ul className="ord-list">
            {shown.map((e) => (
              <li key={e.key} className={`card ord-card${e.action?.primary ? ' needs' : ''}`}>
                <Link to={e.to} className="ord-main">
                  <div className="ord-thumbs" aria-hidden="true">
                    {e.kind === 'service' ? (
                      <span className="ord-ic">🔧</span>
                    ) : e.thumbs.length ? (
                      e.thumbs.map((t, i) => (t.src ? <img key={i} src={t.src} alt="" loading="lazy" /> : <span key={i} className="ord-ic">📦</span>))
                    ) : (
                      <span className="ord-ic">📦</span>
                    )}
                    {e.more > 0 && <span className="ord-more">+{e.more}</span>}
                  </div>
                  <div className="ord-text">
                    <div className="row between wrapr">
                      <b className="ord-title">{e.title}</b>
                      <span className={`tag ${e.tone}`}>{e.status}</span>
                    </div>
                    <span className="muted">
                      <span dir="ltr">{e.number}</span> · {e.sub}
                    </span>
                  </div>
                </Link>
                {e.steps.length > 0 && (
                  <div className="ord-steps" aria-label={`المرحلة ${e.step + 1} من ${e.steps.length}: ${e.steps[e.step] ?? ''}`}>
                    {e.steps.map((s, i) => (
                      <span key={s} className={i < e.step ? 'done' : i === e.step ? 'now' : undefined} title={s} />
                    ))}
                  </div>
                )}
                <div className="row between wrapr ord-foot">
                  <b>{e.total !== null ? formatSar(e.total) : ''}</b>
                  <div className="row wrapr">
                    {e.reorder && e.reorder.length > 0 && (
                      <button type="button" className="btn sm ghost" onClick={() => reorder(e.reorder!)}>
                        اطلب مرة ثانية
                      </button>
                    )}
                    {e.action && (
                      <Link to={e.action.to} className={`btn sm${e.action.primary ? '' : ' ghost'}`}>
                        {e.action.label}
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
