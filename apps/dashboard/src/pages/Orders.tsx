import { Fragment, useCallback, useEffect, useState } from 'react'
import { effectiveStatus, FULFILLMENT_LABELS, ORDER_STATUS_LABELS, type Order, type OrderItem, type OrderStatus } from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { supabase } from '../lib/supabase'

type Row = Order & { items: Pick<OrderItem, 'id' | 'name_ar' | 'sku' | 'qty' | 'line_total'>[] }
type Filter = 'all' | 'pending_payment' | 'paid' | 'cancelled'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'pending_payment', label: 'بانتظار الدفع' },
  { key: 'paid', label: 'مدفوعة' },
  { key: 'cancelled', label: 'ملغية' },
]
const STATUS_CLS: Partial<Record<OrderStatus, string>> = { pending_payment: 'b-warn', paid: 'b-ok', completed: 'b-ok', cancelled: 'b-gray' }

const sar = (n: number) => `${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`
const date = (iso: string, time = true) =>
  new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso).toLocaleString('ar-SA-u-ca-gregory-nu-latn', {
    day: 'numeric',
    month: 'short',
    ...(time ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: 'Asia/Riyadh',
  })

/** First version of the orders page: what came in, for whom, and where. Full order handling comes on Day 7. */
export function Orders() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
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

  useEffect(() => {
    load().catch(() => setError('تعذّر تحميل الطلبات.'))
  }, [load])

  const st = (o: Row) => effectiveStatus(o)
  const shown = (rows ?? []).filter((o) => filter === 'all' || st(o) === filter)
  const count = (f: Filter) => (rows ?? []).filter((o) => f === 'all' || st(o) === f).length

  return (
    <RequirePage page="orders">
      <div className="ph">
        <div>
          <h1>الطلبات</h1>
          <p>
            الطلبات اللي سواها العملاء من المتجر. الطلب يبقى «بانتظار الدفع» 24 ساعة ثم ينلغي تلقائياً. الدفع الإلكتروني يتفعّل مع ربط ميسر، وإدارة
            الحالات (تجهيز، شحن، تركيب) في اليوم 7.
          </p>
        </div>
        <button className="btn ghost" onClick={() => load().catch(() => setError('تعذّر تحميل الطلبات.'))}>
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
                const s = st(o)
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
                      </td>
                    </tr>
                    {open === o.id && (
                      <tr className="detail">
                        <td colSpan={8}>
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
                            <p>
                              <a className="link" href={`https://www.google.com/maps?q=${o.lat},${o.lng}`} target="_blank" rel="noreferrer">
                                فتح الموقع على الخريطة
                              </a>
                              {s === 'pending_payment' && <span className="muted"> · ينلغي إذا ما اندفع قبل {date(o.expires_at)}</span>}
                            </p>
                          </div>
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
