import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { PRODUCT_TYPE_LABELS, priceWithVat, productPath } from '@ghaith/shared'
import { CatalogStatus } from '../components/CatalogStatus'
import { PlaceholderArt, ProductCard } from '../components/ProductCard'
import { QtyStepper } from '../components/QtyStepper'
import { MAX_QTY, useCart } from '../lib/cart'
import { bundleComponentsTotal, formatSar, imageUrls, type ProductWithCategory } from '../lib/catalog'
import { useCatalog } from '../lib/useCatalog'
import { availableHere, useLocationChoice } from '../lib/location'
import type { StoreSettings } from '@ghaith/shared'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function Gallery({ product }: { product: ProductWithCategory }) {
  const urls = imageUrls(product)
  const [i, setI] = useState(0)
  useEffect(() => setI(0), [product.id])
  if (!urls.length) {
    return (
      <div className="gallery">
        <div className="gallery-main placeholder">
          <PlaceholderArt type={product.type} />
        </div>
      </div>
    )
  }
  return (
    <div className="gallery">
      <div className="gallery-main">
        <img src={urls[i]} alt={product.name_ar} />
      </div>
      {urls.length > 1 && (
        <div className="thumbs" role="group" aria-label="صور المنتج">
          {urls.map((u, n) => (
            <button key={u} className={n === i ? 'on' : undefined} aria-label={`الصورة ${n + 1}`} aria-pressed={n === i} onClick={() => setI(n)}>
              <img src={u} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AddToCart({ product }: { product: ProductWithCategory }) {
  const cart = useCart()
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  useEffect(() => {
    setQty(1)
    setAdded(false)
  }, [product.id])
  const inCart = cart.qtyOf(product.id)
  const room = MAX_QTY - inCart
  return (
    <div className="buy">
      <div className="row wrapr">
        <QtyStepper value={Math.min(qty, Math.max(room, 1))} onChange={setQty} label="الكمية" />
        <button
          className="btn buy-btn"
          disabled={room <= 0}
          onClick={() => {
            cart.add(product.id, Math.min(qty, room))
            setAdded(true)
          }}
        >
          أضف للسلة
        </button>
      </div>
      <p className="muted" role="status">
        {room <= 0
          ? `وصلت للحد الأعلى (${MAX_QTY}) من هذا المنتج في السلة.`
          : added || inCart
            ? <>في سلتك {inCart} — <Link to="/cart" className="link">عرض السلة</Link></>
            : ''}
      </p>
    </div>
  )
}

/** How the product reaches this customer, based on their chosen location. */
function Delivery({ product, settings }: { product: ProductWithCategory; settings: StoreSettings }) {
  const { location, inMecca, openDialog } = useLocationChoice()
  const vat = settings.vat_rate
  const change = (
    <button type="button" className="linkbtn" onClick={() => openDialog()}>
      {location ? 'تغيير الموقع' : 'حدد موقعك'}
    </button>
  )
  if (!inMecca && product.type === 'service') {
    return (
      <div className="delivery off" role="status">
        <b>هذه الخدمة متاحة داخل مكة المكرمة فقط.</b>
        <span>موقعك الحالي: {location?.city}</span>
        {change}
      </div>
    )
  }
  if (!inMecca) {
    return (
      <div className="delivery">
        <b>الشحن إلى {location?.city}</b>
        <span>رسوم الشحن {formatSar(priceWithVat(settings.shipping_fee, vat))} للطلب شامل الضريبة.</span>
        {product.installable_in_mecca && <span className="muted">خدمة التركيب متاحة داخل مكة المكرمة فقط.</span>}
        {change}
      </div>
    )
  }
  return (
    <div className="delivery">
      <b>{location ? 'التوصيل داخل مكة المكرمة' : 'التوصيل داخل مكة والشحن لباقي المدن'}</b>
      {product.installable_in_mecca && (
        <span>
          التركيب متاح داخل مكة برسوم {formatSar(priceWithVat(settings.install_fee, vat))} شامل الضريبة، وتختاره عند إتمام الطلب.
        </span>
      )}
      {change}
    </div>
  )
}

function months(n: number) {
  if (n === 1) return 'شهر واحد'
  if (n === 2) return 'شهران'
  if (n >= 3 && n <= 10) return `${n} أشهر`
  return `${n} شهراً`
}

export function ProductPage() {
  const { key = '' } = useParams()
  const { state, reload } = useCatalog()
  const { inMecca } = useLocationChoice()

  const product =
    state.status === 'success'
      ? state.data.products.find((p) => (UUID.test(key) ? p.id === key : p.sku.toLowerCase() === key.toLowerCase()))
      : undefined

  useEffect(() => {
    if (product) document.title = `${product.name_ar} | غيث لتنقية المياه`
    return () => {
      document.title = 'غيث لتنقية المياه'
    }
  }, [product])

  if (state.status !== 'success') return <CatalogStatus state={state} reload={reload} />

  if (!product) {
    return (
      <div className="notice">
        <b>هذا المنتج غير متوفر حالياً.</b>
        <Link to="/products" className="link">
          تصفح كل المنتجات
        </Link>
      </div>
    )
  }

  const { settings, products, categories } = state.data
  const vat = settings.vat_rate
  const total = priceWithVat(product.price_before_vat, vat)
  const separate = bundleComponentsTotal(product)
  const saving = separate !== null && separate > product.price_before_vat ? priceWithVat(separate - product.price_before_vat, vat) : 0
  const category = categories.find((c) => c.id === product.category_id)
  const related = products.filter((p) => p.category_id === product.category_id && p.id !== product.id && availableHere(p.type, inMecca)).slice(0, 4)
  const parts = product.type === 'bundle' ? product.components.filter((c) => c.product) : []

  const details: [string, string][] = []
  if (product.manufacturer) details.push(['الشركة المصنّعة', product.manufacturer.name])
  if (product.model) details.push(['الموديل', product.model])
  if (product.warranty_months > 0) details.push(['الضمان', months(product.warranty_months)])
  details.push(['رمز المنتج', product.sku])

  return (
    <>
      <nav className="crumbs" aria-label="مسار الصفحة">
        <Link to="/products">المنتجات</Link>
        {category && (
          <>
            <span aria-hidden="true">›</span>
            <Link to={`/products?cat=${encodeURIComponent(category.slug)}`}>{category.name_ar}</Link>
          </>
        )}
        <span aria-hidden="true">›</span>
        <span aria-current="page">{product.name_ar}</span>
      </nav>

      <article className="pdp">
        <Gallery product={product} />

        <div className="pdp-info">
          <div className="tags">
            <span className={product.type === 'bundle' ? 'tag bundle' : 'tag'}>{PRODUCT_TYPE_LABELS[product.type]}</span>
            {product.installable_in_mecca && inMecca && <span className="tag ok">التركيب متاح داخل مكة</span>}
          </div>
          <h1 className="pdp-name">{product.name_ar}</h1>
          {product.name_en && (
            <p className="muted" dir="ltr">
              {product.name_en}
            </p>
          )}

          <div className="pdp-price">
            {formatSar(total)} <small>شامل الضريبة</small>
          </div>
          <p className="muted">
            السعر قبل الضريبة {formatSar(Number(product.price_before_vat))}
          </p>
          {saving > 0 && <span className="saving">وفّر {formatSar(saving)} مقارنة بشراء المكونات منفصلة</span>}

          {availableHere(product.type, inMecca) && <AddToCart product={product} />}

          <Delivery product={product} settings={settings} />

          {product.description_ar && <p className="pdp-desc">{product.description_ar}</p>}

          {parts.length > 0 && (
            <section className="pdp-block">
              <h2 className="h3">تشمل الباقة</h2>
              <ul className="parts">
                {parts.map((c) => (
                  <li key={c.product!.id}>
                    <Link to={productPath(c.product!)} className="link">
                      {c.product!.name_ar}
                    </Link>
                    {c.qty > 1 && <span className="muted"> × {c.qty}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {product.specs.length > 0 && (
            <section className="pdp-block">
              <h2 className="h3">المواصفات</h2>
              <ul className="specs">
                {product.specs.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </section>
          )}

          <dl className="details">
            {details.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          {product.type === 'filter' && product.compat.length > 0 && (
            <section className="pdp-block">
              <h2 className="h3">يناسب الأجهزة</h2>
              <table className="compat">
                <thead>
                  <tr>
                    <th>الجهاز</th>
                    <th>المرحلة</th>
                    <th>يُغيَّر كل</th>
                  </tr>
                </thead>
                <tbody>
                  {product.compat.map((c) => (
                    <tr key={c.device_model + c.stage_number}>
                      <td dir="ltr">{c.device_model}</td>
                      <td>{c.stage_number ?? '—'}</td>
                      <td>{months(c.lifetime_months)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </article>

      {related.length > 0 && (
        <section className="related">
          <h2 className="h2">منتجات مشابهة</h2>
          <div className="grid">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} vatRate={vat} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
