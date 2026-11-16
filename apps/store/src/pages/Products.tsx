import { Link, useSearchParams } from 'react-router-dom'
import { ProductCard } from '../components/ProductCard'
import { CatalogStatus } from '../components/CatalogStatus'
import { useCatalog } from '../lib/useCatalog'

export function Products() {
  const { state, reload } = useCatalog()
  const [params, setParams] = useSearchParams()
  const active = params.get('cat') ?? 'all'
  const productId = params.get('product')

  const setCat = (slug: string) => setParams(slug === 'all' ? {} : { cat: slug }, { replace: true })

  if (state.status !== 'success') {
    return (
      <>
        <h1 className="page-h">المنتجات</h1>
        <p className="sub">كل الأسعار شاملة ضريبة القيمة المضافة.</p>
        <CatalogStatus state={state} reload={reload} />
      </>
    )
  }

  const { products, categories, settings } = state.data
  // A category includes its sub-categories.
  const selected = categories.find((c) => c.slug === active)
  const ids = new Set(selected ? [selected.id, ...categories.filter((c) => c.parent_id === selected.id).map((c) => c.id)] : [])
  const shown = productId
    ? products.filter((p) => p.id === productId)
    : active === 'all'
      ? products
      : products.filter((p) => ids.has(p.category_id))

  return (
    <>
      <h1 className="page-h">المنتجات</h1>
      <p className="sub">كل الأسعار شاملة ضريبة القيمة المضافة.</p>

      <div className="chips" role="group" aria-label="تصفية حسب القسم">
        {[{ slug: 'all', name_ar: 'الكل' }, ...categories].map((c) => (
          <button
            key={c.slug}
            className={c.slug === active ? 'on' : undefined}
            aria-pressed={c.slug === active}
            onClick={() => setCat(c.slug)}
          >
            {c.name_ar}
          </button>
        ))}
      </div>

      {productId && (
        <p>
          <Link to="/products" className="link">
            ← عرض كل المنتجات
          </Link>
        </p>
      )}

      {shown.length ? (
        <div className="grid">
          {shown.map((p) => (
            <ProductCard key={p.id} product={p} vatRate={settings.vat_rate} />
          ))}
        </div>
      ) : (
        <p className="muted">لا توجد منتجات في هذا القسم.</p>
      )}
    </>
  )
}
