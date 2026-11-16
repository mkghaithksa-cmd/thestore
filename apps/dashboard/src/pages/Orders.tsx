import { Fragment, useCallback, useEffect, useState } from 'react'
import {
  effectiveStatus,
  FULFILLMENT_LABELS,
  nextStage,
  ORDER_STATUS_LABELS,
  orderErrorMessage,
  type Order,
  type OrderEvent,
  type OrderItem,
  type OrderStatus,
} from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

type Row = Order & { items: Pick<OrderItem, 'id' | 'name_ar' | 'sku' | 'qty' | 'line_total'>[] }
type Filter = 'all' | 'pending_payment' | 'active' | 'done' | 'cancelled' | 'refund'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'active', label: 'تحتاج متابعة' },
  { key: 'pending_payment', label: 'بانتظار الدفع' },
  { key: 'done', label: 'مكتملة' },
  { key: 'cancelled', label: 'ملغية' },
  { key: 'refund', label: 'استرداد مستحق' },
  { key: 'all', label: 'الكل' },
]
const STATUS_CLS: Partial<Record<OrderStatus, string>> = {
  pending_payment: 'b-warn',
  paid: 'b-info',
  preparing: 'b-info',
  shipped: 'b-info',
  installing: 'b-info',
  delivered: 'b-ok',
  completed: 'b-ok',
  cancelled: 'b-gray',
}
/** What the staff button says for each next stage. */
const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  preparing: 'بدء التجهيز (يصرف من المخزون)',
  shipped: 'تم الشحن',
  installing: 'خرج الفني للتركيب',
  delivered: 'تم التسليم',
  completed: 'إكمال الطلب',
}

const sar = (n: number) => `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`
const date = (iso: string, time = true) =>
  new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleString('ar-SA-u-ca-gregory-nu-latn', {
    day: 'numeric',
    month: 'short',
    ...(time ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: 'Asia/Riyadh',
  })

function matches(o: Row, f: Filter): boolean {
  const s = effectiveStatus(o)
  if (f === 'all') return true
  if (f === 'refund') return o.refund_status === 'due'
  if (f === 'active') return ['paid', 'preparing', 'shipped', 'installing', 'delivered'].includes(s)
  if (f === 'done') return s === 'completed'
  return s === f
}

/** Orders: what came in, and moving each order through its stages. */
export function Orders() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [filter, setFilter] = useState<Filter>('active')
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('orders')
      .select('*, items:order_items(id, name_ar, sku, qty, line_total)')
      .order('created_at', { ascending: false })
      .limit(300)
    if (e) throw new Error(e.message)
    setRows((data ?? []) as Row[])
  }, [])

  const reload = useCallback(() => {
    setError(null)
    load().catch(() => setError('تعذّر تحميل الطلبات.'))
  }, [load])

  useEffect(reload, [reload])

  const shown = (rows ?? []).filter((o) => matches(o, filter))
  const count = (f: Filter) => (rows ?? []).filter((o) => matches(o, f)).length

  return (
    <RequirePage page="orders">
      <div className="ph">
        <div>
          <h1>الطلبات</h1>
          <p>
            المراحل: مدفوع ← تجهيز (يصرف من المخزون) ← شحن أو تركيب أو توصيل ← مكتمل. كل خطوة تنحفظ وتظهر للعميل في تتبع طلبه. الطلب غير المدفوع ينلغي
            بعد 24 ساعة.
          </p>
        </div>
        <button className="btn ghost" onClick={reload}>
          تحديث
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}

      <div className="chips" role="tablist" aria-label="تصفية">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? 'on' : undefined} onClick={() => setFilter(f.key)}>
            {f.label} ({count(f.key)})
          </button>
        ))}
      </div>

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
                <th>رقم الطلب</th>
                <th>التاريخ</th>
                <th>العميل</th>
                <th>العنوان</th>
                <th>الاستلام</th>
                <th>اليوم المفضل</th>
                <th>الإجمالي</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((o) => {
                const s = effectiveStatus(o)
                return (
                  <Fragment key={o.id}>
                    <tr className="clickable" onClick={() => setOpen(open === o.id ? null : o.id)} aria-expanded={open === o.id}>
                      <td dir="ltr">
                        <b>{o.order_number}</b>
                      </td>
                      <td>{date(o.created_at)}</td>
                      <td>
                        {o.contact_name}
                        <div className="muted" dir="ltr">
                          {o.contact_phone.replace('+966', '0')}
                        </div>
                      </td>
                      <td>{[o.city, o.neighborhood_name].filter(Boolean).join('، ')}</td>
                      <td>{FULFILLMENT_LABELS[o.fulfillment]}</td>
                      <td>{o.preferred_visit_date ? date(o.preferred_visit_date, false) : '—'}</td>
                      <td>{sar(o.total)}</td>
                      <td>
                        <span className={`badge ${STATUS_CLS[s] ?? ''}`}>{ORDER_STATUS_LABELS[s]}</span>
                        {o.refund_status === 'due' && <span className="badge b-warn">استرداد مستحق</span>}
                      </td>
                    </tr>
                    {open === o.id && (
                      <tr className="detail">
                        <td colSpan={8}>
                          <OrderDetail o={o} onChanged={reload} />
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
    </RequirePage>
  )
}

function OrderDetail({ o, onChanged }: { o: Row; onChanged: () => void }) {
  const { can } = useStaffAuth()
  const s = effectiveStatus(o)
  const next = nextStage({ status: s, fulfillment: o.fulfillment })
  const [events, setEvents] = useState<OrderEvent[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [tracking, setTracking] = useState('')
  const [carrier, setCarrier] = useState('')
  const [method, setMethod] = useState<'bank_transfer' | 'cash'>('bank_transfer')
  const [payRef, setPayRef] = useState('')
  const [reason, setReason] = useState('')
  const [refundRef, setRefundRef] = useState('')

  useEffect(() => {
    supabase
      .from('order_events')
      .select('*')
      .eq('order_id', o.id)
      .order('id')
      .then(({ data }) => setEvents((data ?? []) as OrderEvent[]))
  }, [o.id, o.status, o.refund_status])

  async function run(fn: string, args: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setError(null)
    const { error: e } = await supabase.rpc(fn, args)
    setBusy(false)
    if (e) return setError(orderErrorMessage(e.message))
    setNote('')
    setReason('')
    onChanged()
  }

  const canCancel = can('orders', 'approve') && ['pending_payment', 'paid', 'preparing', 'shipped', 'installing'].includes(s)

  return (
    <div className="order-detail">
      <ul>
        {o.items.map((i) => (
          <li key={i.id}>
            {i.name_ar} <span className="muted">({i.sku})</span> × {i.qty} = {sar(i.line_total)}
          </li>
        ))}
      </ul>
      <p>
        المنتجات {sar(o.subtotal)}
        {Number(o.install_fee) > 0 && ` + التركيب ${sar(o.install_fee)} (${o.install_units})`}
        {Number(o.shipping_fee) > 0 && ` + الشحن ${sar(o.shipping_fee)}`} + الضريبة {sar(o.vat_amount)} = <b>{sar(o.total)}</b>
      </p>
      {o.street && <p>العنوان: {o.street}</p>}
      {o.address_notes && <p>وصف: {o.address_notes}</p>}
      {o.customer_notes && <p>ملاحظات العميل: {o.customer_notes}</p>}
      {o.tracking_number && (
        <p>
          رقم التتبع: <b dir="ltr">{o.tracking_number}</b> {o.shipping_carrier && `(${o.shipping_carrier})`}
        </p>
      )}
      <p>
        <a className="link" href={`https://www.google.com/maps?q=${o.lat},${o.lng}`} target="_blank" rel="noreferrer">
          فتح الموقع على الخريطة
        </a>
        {s === 'pending_payment' && <span className="muted"> · ينلغي إذا ما اندفع قبل {date(o.expires_at)}</span>}
        {o.stock_issued_at && <span className="muted"> · انصرف من المخزون {date(o.stock_issued_at)}</span>}
      </p>

      {events && events.length > 0 && (
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <b>{ORDER_STATUS_LABELS[e.status]}</b> <span className="muted">{date(e.created_at)}</span>
              {e.note && <span> · {e.note}</span>}
            </li>
          ))}
        </ol>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {next && can('orders', 'edit') && (
        <div className="act card inset">
          {next === 'shipped' && (
            <div className="row wrapr">
              <input className="input sm" placeholder="رقم التتبع" dir="ltr" value={tracking} onChange={(e) => setTracking(e.target.value)} maxLength={60} />
              <input className="input sm" placeholder="شركة الشحن (اختياري)" value={carrier} onChange={(e) => setCarrier(e.target.value)} maxLength={40} />
            </div>
          )}
          <div className="row wrapr">
            <input className="input sm grow" placeholder="ملاحظة تظهر للعميل (اختياري)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            <button
              className="btn sm"
              disabled={busy}
              onClick={() =>
                run('order_advance', {
                  p_order_id: o.id,
                  p_to: next,
                  p_tracking_number: next === 'shipped' ? tracking : null,
                  p_carrier: next === 'shipped' ? carrier : null,
                  p_note: note.trim() || null,
                })
              }
            >
              {ACTION_LABELS[next] ?? ORDER_STATUS_LABELS[next]}
            </button>
          </div>
        </div>
      )}

      {s === 'pending_payment' && can('payments', 'approve') && (
        <div className="act card inset">
          <b>تسجيل دفع يدوي</b>
          <span className="muted">للتحويل البنكي أو الدفع النقدي. تأكد من وصول المبلغ {sar(o.total)} قبل التسجيل.</span>
          <div className="row wrapr">
            <select className="input sm" value={method} onChange={(e) => setMethod(e.target.value as 'bank_transfer' | 'cash')}>
              <option value="bank_transfer">تحويل بنكي</option>
              <option value="cash">نقدي</option>
            </select>
            <input className="input sm grow" placeholder="رقم المرجع (رقم الحوالة أو السند)" value={payRef} onChange={(e) => setPayRef(e.target.value)} maxLength={60} />
            <button
              className="btn sm"
              disabled={busy}
              onClick={() =>
                run('order_mark_paid', { p_order_id: o.id, p_method: method, p_reference: payRef }, `تسجيل دفع ${sar(o.total)} للطلب ${o.order_number}؟`)
              }
            >
              تسجيل الدفع
            </button>
          </div>
        </div>
      )}

      {o.refund_status === 'due' && can('payments', 'approve') && (
        <div className="act card inset">
          <b>استرداد مستحق: {sar(o.total)}</b>
          <span className="muted">رجّع المبلغ للعميل ثم سجّل رقم المرجع هنا.</span>
          <div className="row wrapr">
            <input className="input sm grow" placeholder="رقم مرجع الاسترداد" value={refundRef} onChange={(e) => setRefundRef(e.target.value)} maxLength={60} />
            <button className="btn sm" disabled={busy} onClick={() => run('order_mark_refunded', { p_order_id: o.id, p_reference: refundRef })}>
              تم الاسترداد
            </button>
          </div>
        </div>
      )}

      {canCancel && (
        <div className="act card inset">
          <div className="row wrapr">
            <input className="input sm grow" placeholder="سبب الإلغاء (يظهر للعميل)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            <button
              className="btn sm ghost danger"
              disabled={busy}
              onClick={() =>
                run(
                  'order_cancel_staff',
                  { p_order_id: o.id, p_reason: reason },
                  `إلغاء الطلب ${o.order_number}؟${o.stock_issued_at ? ' المنتجات المصروفة ترجع للمخزون.' : ''}${o.paid_at ? ' والمبلغ يصير استرداد مستحق.' : ''}`,
                )
              }
            >
              إلغاء الطلب
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
