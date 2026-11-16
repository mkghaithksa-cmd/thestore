import { Link, useParams } from 'react-router-dom'
import { BUSINESS, FULFILLMENT_LABELS } from '@ghaith/shared'
import { fetchSettings, formatSar } from '../lib/catalog'
import { qrSvg, zatcaQrPayload } from '../lib/invoice'
import { fetchOrder, formatDate } from '../lib/orders'
import { usePageMeta } from '../lib/seo'
import { useAsync } from '../lib/useAsync'

async function load(id: string) {
  const [data, settings] = await Promise.all([fetchOrder(id), fetchSettings()])
  return data ? { ...data, settings } : null
}

/** Simplified tax invoice for a paid order (printable). */
export function Invoice() {
  const { id = '' } = useParams()
  const { state, reload } = useAsync(() => load(id), [id])
  usePageMeta(state.status === 'success' && state.data ? `فاتورة ${state.data.order.order_number}` : 'الفاتورة')

  if (state.status === 'loading') return <p className="muted">جاري التحميل…</p>
  if (state.status === 'error') {
    return (
      <div className="notice bad" role="alert">
        <b>تعذّر تحميل الفاتورة.</b>
        <button className="btn sm" onClick={reload}>
          إعادة المحاولة
        </button>
      </div>
    )
  }
  const d = state.data
  if (!d || !d.order.paid_at) {
    return (
      <div className="notice">
        <b>الفاتورة تطلع بعد الدفع.</b>
        <Link to={`/orders/${id}`} className="link">
          الرجوع للطلب
        </Link>
      </div>
    )
  }

  const { order: o, items, settings } = d
  const paidAt = d.order.paid_at
  const vatNo = settings.seller_vat_number
  const vatPct = Math.round(Number(o.vat_rate) * 100)
  const qr = vatNo
    ? qrSvg(zatcaQrPayload({ seller: BUSINESS.legalName, vatNumber: vatNo, time: new Date(paidAt).toISOString(), total: Number(o.total), vat: Number(o.vat_amount) }))
    : null

  return (
    <div className="stack narrow invoice">
      <div className="row between wrapr no-print">
        <Link to={`/orders/${o.id}`} className="link">
          الرجوع للطلب
        </Link>
        <button className="btn sm" onClick={() => window.print()}>
          طباعة / حفظ PDF
        </button>
      </div>

      <section className="card stack">
        <div className="row between wrapr">
          <div className="stack-sm">
            <h1 className="page-h">{vatNo ? 'فاتورة ضريبية مبسطة' : 'فاتورة'}</h1>
            <b>{BUSINESS.legalName}</b>
            <span className="muted">{BUSINESS.address}</span>
            <span className="muted">السجل التجاري: {BUSINESS.commercialRegister}</span>
            {vatNo && <span className="muted">الرقم الضريبي: {vatNo}</span>}
          </div>
          {qr && <div className="inv-qr" aria-label="رمز الفاتورة لهيئة الزكاة" dangerouslySetInnerHTML={{ __html: qr }} />}
        </div>

        <dl className="sum">
          <div>
            <dt>رقم الفاتورة</dt>
            <dd dir="ltr">{o.order_number}</dd>
          </div>
          <div>
            <dt>تاريخ الإصدار</dt>
            <dd>{formatDate(paidAt, true)}</dd>
          </div>
          <div>
            <dt>العميل</dt>
            <dd>
              {o.contact_name} · <span dir="ltr">{o.contact_phone.replace('+966', '0')}</span>
            </dd>
          </div>
          <div>
            <dt>الاستلام</dt>
            <dd>{FULFILLMENT_LABELS[o.fulfillment]}</dd>
          </div>
        </dl>

        <div className="tw">
          <table className="inv-table">
            <thead>
              <tr>
                <th>البند</th>
                <th>الكمية</th>
                <th>سعر الوحدة</th>
                <th>المجموع قبل الضريبة</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.name_ar}</td>
                  <td>{i.qty}</td>
                  <td>{formatSar(Number(i.unit_price))}</td>
                  <td>{formatSar(Number(i.line_total))}</td>
                </tr>
              ))}
              {Number(o.install_fee) > 0 && (
                <tr>
                  <td>رسوم التركيب</td>
                  <td>{o.install_units}</td>
                  <td>{formatSar(Number(o.install_fee) / o.install_units)}</td>
                  <td>{formatSar(Number(o.install_fee))}</td>
                </tr>
              )}
              {Number(o.shipping_fee) > 0 && (
                <tr>
                  <td>رسوم الشحن</td>
                  <td>1</td>
                  <td>{formatSar(Number(o.shipping_fee))}</td>
                  <td>{formatSar(Number(o.shipping_fee))}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <dl className="sum">
          <div>
            <dt>الإجمالي قبل الضريبة</dt>
            <dd>{formatSar(Number(o.subtotal) + Number(o.install_fee) + Number(o.shipping_fee))}</dd>
          </div>
          <div>
            <dt>ضريبة القيمة المضافة ({vatPct}٪)</dt>
            <dd>{formatSar(Number(o.vat_amount))}</dd>
          </div>
          <div className="grand">
            <dt>الإجمالي شامل الضريبة</dt>
            <dd>{formatSar(Number(o.total))}</dd>
          </div>
        </dl>
        {o.status === 'cancelled' && <p className="notice warn">هذا الطلب ملغي{o.refund_status === 'done' ? ' وتم إرجاع المبلغ' : ''}.</p>}
      </section>
    </div>
  )
}
