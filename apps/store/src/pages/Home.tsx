import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { HomeBanner } from '@ghaith/shared'
import { BannerSlider } from '../components/BannerSlider'
import { fetchBanners } from '../lib/catalog'
import { ProductCard } from '../components/ProductCard'
import { CatalogStatus } from '../components/CatalogStatus'
import { useCatalog } from '../lib/useCatalog'

export function Home() {
  const { state, reload } = useCatalog()
  const [banners, setBanners] = useState<HomeBanner[] | null>(null)
  useEffect(() => {
    // Banners are optional: without them (or on error) the default welcome shows.
    fetchBanners().then(setBanners, () => setBanners([]))
  }, [])
  const featured = state.status === 'success' ? state.data.products.filter((p) => p.is_featured) : []

  return (
    <>
      {banners && banners.length > 0 && <BannerSlider banners={banners} />}
      {banners && banners.length === 0 && (
      <section className="hero">
        <div>
          <h1>ماء نقي لبيتك ومطعمك</h1>
          <p>أجهزة تحلية وفلاتر أصلية للبيوت والمطاعم، مع التركيب والصيانة داخل مكة والشحن لباقي المدن. ماء صافٍ كل يوم، وقوارير بلاستيك أقل.</p>
          <Link to="/products" className="btn hero-btn">
            تصفح المنتجات
          </Link>
        </div>
        <div className="art" aria-hidden="true">
          <img src="/brand/logo-white.png" alt="" width="400" height="217" />
        </div>
      </section>
      )}

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
