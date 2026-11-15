import { useSearchParams } from 'react-router-dom'
import { ProductCard } from '../components/ProductCard'
import { CatalogStatus } from '../components/CatalogStatus'
import { useCatalog } from '../lib/useCatalog'

export function Products() {
  const { state, reload } = useCatalog()
  const [params, setParams] = useSearchParams()
  const active = params.get('cat') ?? 'all'

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
  const shown = active === 'all' ? products : products.filter((p) => p.category?.slug === active)

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
