import { Link } from 'react-router-dom'
import { ProductCard } from '../components/ProductCard'
import { CatalogStatus } from '../components/CatalogStatus'
import { useCatalog } from '../lib/useCatalog'

export function Home() {
  const { state, reload } = useCatalog()
  const featured = state.status === 'success' ? state.data.products.filter((p) => p.is_featured) : []

  return (
    <>
      <section className="hero">
        <div>
          <h1>ماء نقي لبيتك</h1>
          <p>أجهزة تنقية وفلاتر أصلية، مع التركيب والصيانة داخل مكة والشحن لباقي المدن.</p>
          <Link to="/products" className="btn hero-btn">
            تصفح المنتجات
          </Link>
        </div>
        <div className="art" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
          </svg>
        </div>
      </section>

      <section>
        <div className="section-h">
          <h2 className="h2">منتجات مميزة</h2>
          <Link to="/products" className="link">
            كل المنتجات ←
          </Link>
        </div>
        <CatalogStatus state={state} reload={reload} />
        {state.status === 'success' &&
          (featured.length ? (
            <div className="grid">
              {featured.map((p) => (
                <ProductCard key={p.id} product={p} vatRate={state.data.settings.vat_rate} />
              ))}
            </div>
          ) : (
            <p className="muted">لا توجد منتجات مميزة حالياً.</p>
          ))}
      </section>
    </>
  )
}
