import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { priceWithVat, productPath } from '@ghaith/shared'
import { CatalogStatus } from '../components/CatalogStatus'
import { PlaceholderArt } from '../components/ProductCard'
import { QtyStepper } from '../components/QtyStepper'
import { useCart } from '../lib/cart'
import { formatSar, mainImageUrl } from '../lib/catalog'
import { useCatalog } from '../lib/useCatalog'
import { availableHere, useLocationChoice } from '../lib/location'

export function Cart() {
  const cart = useCart()
  const { location, inMecca, openDialog } = useLocationChoice()
  const { state, reload } = useCatalog()

  useEffect(() => {
    document.title = 'السلة | غيث لتنقية المياه'
    return () => {
      document.title = 'غيث لتنقية المياه'
    }
  }, [])

  if (!cart.lines.length) {
    return (
      <>
        <h1 className="page-h">السلة</h1>
        <div className="notice empty-cart">
          <b>سلتك فاضية.</b>
          <span className="muted">أضف المنتجات اللي تحتاجها وارجع هنا لإتمام الطلب.</span>
          <Link to="/products" className="btn sm">
            تصفح المنتجات
          </Link>
        </div>
      </>
    )
  }

  if (state.status !== 'success') {
    return (
      <>
        <h1 className="page-h">السلة</h1>
        <CatalogStatus state={state} reload={reload} />
      </>
    )
  }

  const { products, settings } = state.data
  const vat = Number(settings.vat_rate)
  const rows = cart.lines.map((l) => ({ line: l, product: products.find((p) => p.id === l.productId) }))
  // Services cannot be booked outside Mecca: they stay in the cart but are not counted.
  const available = rows.filter((r) => r.product && availableHere(r.product.type, inMecca))
  const notHere = rows.filter((r) => r.product && !availableHere(r.product.type, inMecca))
  const missing = rows.filter((r) => !r.product)

  const subtotal = available.reduce((s, r) => s + Number(r.product!.price_before_vat) * r.line.qty, 0)
  // Outside Mecca the order ships; the fee is per order and VAT applies to it too.
  const shipping = !inMecca && available.length ? Number(settings.shipping_fee) : 0
  const vatAmount = Math.round((subtotal + shipping) * vat * 100) / 100
  const total = Math.round((subtotal + shipping + vatAmount) * 100) / 100

  return (
    <>
      <h1 className="page-h">السلة</h1>
      <p className="sub">الأسعار تُحدَّث من المتجر مباشرة، وتُراجع مرة ثانية عند إتمام الطلب.</p>

      <div className="cart">
        <div className="cart-lines">
          {available.map(({ line, product: p }) => {
            const img = mainImageUrl(p!)
            const unit = priceWithVat(p!.price_before_vat, vat)
            return (
              <article key={line.productId} className="cart-line">
                <Link to={productPath(p!)} className="cart-img" tabIndex={-1} aria-hidden="true">
                  {img ? <img src={img} alt="" loading="lazy" /> : <PlaceholderArt type={p!.type} />}
                </Link>
                <div className="cart-main">
                  <Link to={productPath(p!)} className="cart-name">
                    {p!.name_ar}
                  </Link>
                  <span className="muted">{formatSar(unit)} للقطعة شامل الضريبة</span>
                  <div className="row wrapr cart-actions">
                    <QtyStepper value={line.qty} onChange={(n) => cart.setQty(line.productId, n)} label={`كمية ${p!.name_ar}`} />
                    <button className="linkbtn danger" onClick={() => cart.remove(line.productId)}>
                      حذف
                    </button>
                  </div>
                </div>
                <div className="cart-total">{formatSar(Math.round(unit * line.qty * 100) / 100)}</div>
              </article>
            )
          })}

          {notHere.length > 0 && (
            <div className="notice warn" role="status">
              <b>
                {notHere.map((r) => r.product!.name_ar).join('، ')}: متاحة داخل مكة المكرمة فقط، ولن تُحسب في طلب الشحن إلى {location?.city}.
              </b>
              <div className="row wrapr">
                <button className="linkbtn" onClick={() => notHere.forEach((r) => cart.remove(r.line.productId))}>
                  إزالتها من السلة
                </button>
                <button className="linkbtn" onClick={() => openDialog()}>
                  تغيير الموقع
                </button>
              </div>
            </div>
          )}

          {missing.length > 0 && (
            <div className="notice warn" role="status">
              <b>
                {missing.length === 1 ? 'منتج في سلتك لم يعد متوفراً' : `${missing.length} منتجات في سلتك لم تعد متوفرة`}، ولن
                يُحسب في الطلب.
              </b>
              <button className="linkbtn" onClick={() => missing.forEach((r) => cart.remove(r.line.productId))}>
                {missing.length === 1 ? "إزالته من السلة" : "إزالتها من السلة"}
              </button>
            </div>
          )}
        </div>

        <aside className="card cart-summary" aria-label="ملخص السلة">
          <h2 className="h3">الملخص</h2>
          <dl>
            <div>
              <dt>المجموع قبل الضريبة</dt>
              <dd>{formatSar(subtotal)}</dd>
            </div>
            {shipping > 0 && (
              <div>
                <dt>الشحن إلى {location?.city}</dt>
                <dd>{formatSar(shipping)}</dd>
              </div>
            )}
            <div>
              <dt>ضريبة القيمة المضافة ({Math.round(vat * 100)}٪)</dt>
              <dd>{formatSar(vatAmount)}</dd>
            </div>
            <div className="grand">
              <dt>الإجمالي</dt>
              <dd>{formatSar(total)}</dd>
            </div>
          </dl>
          <div className="delivery">
            <b>{!location ? 'حدد موقعك' : inMecca ? 'التوصيل داخل مكة المكرمة' : 'الشحن إلى ' + location.city}</b>
            <span className="muted">
              {!location
                ? 'التركيب داخل مكة فقط، وباقي المدن نشحن لها برسوم شحن.'
                : inMecca
                  ? 'تقدر تختار التركيب عند إتمام الطلب، ورسومه تُحسب هناك.'
                  : 'العنوان الكامل تكتبه عند إتمام الطلب.'}
            </span>
            <button type="button" className="linkbtn" onClick={() => openDialog()}>
              {location ? 'تغيير الموقع' : 'حدد موقعك'}
            </button>
          </div>
          <button className="btn block" disabled title="يُفعَّل مع صفحة الدفع">
            إتمام الطلب (قريباً)
          </button>
          <Link to="/products" className="link center">
            متابعة التسوق
          </Link>
        </aside>
      </div>
    </>
  )
}
