import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { productPath, sectionShows, type HomeBanner, type HomeSection, type Review } from '@ghaith/shared'
import { BannerSlider } from '../components/BannerSlider'
import { CatalogStatus } from '../components/CatalogStatus'
import { BenefitGlyph, ReviewCard, SmartLink } from '../components/HomeBits'
import { PlaceholderArt, ProductCard } from '../components/ProductCard'
import { fetchBanners, type ProductWithCategory } from '../lib/catalog'
import { fetchFeaturedReviews, fetchHomeSections, homeImageUrl } from '../lib/home'
import { availableHere, useLocationChoice } from '../lib/location'
import { useCatalog } from '../lib/useCatalog'
import { ServiceLinks } from './Maintenance'

/** Used until the sections table answers (or if it fails): the original home page. */
const FALLBACK: HomeSection[] = [
  { key: 'hero', title_ar: 'ماء نقي لبيتك ومطعمك', subtitle_ar: 'أجهزة تحلية وفلاتر أصلية للبيوت والمطاعم، مع التركيب والصيانة داخل مكة والشحن لباقي المدن.', config: { button: 'تصفح المنتجات', link: '/products' } },
  { key: 'featured', title_ar: 'منتجات مميزة', subtitle_ar: '', config: {} },
].map((s, i) => ({ ...s, id: s.key, is_visible: true, sort_order: i, audience: 'all', updated_at: '', updated_by: null }) as HomeSection)

function live(from?: string | null, to?: string | null) {
  const now = Date.now()
  return (!from || Date.parse(from) <= now) && (!to || Date.parse(to) > now)
}

function Head({ s, more }: { s: HomeSection; more?: { to: string; label: string } }) {
  if (!s.title_ar && !more) return null
  return (
    <div className="section-h">
      <div>
        {s.title_ar && <h2 className="h2">{s.title_ar}</h2>}
        {s.subtitle_ar && <p className="muted section-sub">{s.subtitle_ar}</p>}
      </div>
      {more && (
        <Link to={more.to} className="link">
          {more.label} ←
        </Link>
      )}
    </div>
  )
}

function Welcome({ s }: { s: HomeSection }) {
  return (
    <section className="hero">
      <div>
        <h1>{s.title_ar || 'ماء نقي لبيتك ومطعمك'}</h1>
        {s.subtitle_ar && <p>{s.subtitle_ar}</p>}
        <SmartLink to={s.config.link || '/products'} className="btn hero-btn">
          {s.config.button || 'تصفح المنتجات'}
        </SmartLink>
      </div>
      <div className="art" aria-hidden="true">
        <img src="/brand/logo-white.png" alt="" width="400" height="217" />
      </div>
    </section>
  )
}

function PromoBanner({ b }: { b: HomeBanner }) {
  const img = (
    <picture>
      {b.mobile_path && <source media="(max-width: 640px)" srcSet={homeImageUrl(b.mobile_path)} />}
      <img src={homeImageUrl(b.desktop_path)} alt={b.title} loading="lazy" decoding="async" />
    </picture>
  )
  const to = b.link_kind === 'category' ? `/products?cat=${encodeURIComponent(b.link_ref ?? '')}` : b.link_kind === 'product' ? `/products/${encodeURIComponent(b.link_ref ?? '')}` : b.link_kind === 'url' ? b.link_ref : null
  return to ? (
    <SmartLink to={to} className="promo">
      {img}
    </SmartLink>
  ) : (
    <div className="promo">{img}</div>
  )
}

export function Home() {
  const { state, reload } = useCatalog()
  const { inMecca } = useLocationChoice()
  const [sections, setSections] = useState<HomeSection[] | null>(null)
  const [banners, setBanners] = useState<HomeBanner[] | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])

  useEffect(() => {
    fetchHomeSections().then(setSections, () => setSections(FALLBACK))
    // Banners and reviews are optional: without them the sections fall back gracefully.
    fetchBanners().then(setBanners, () => setBanners([]))
    fetchFeaturedReviews().then(setReviews, () => setReviews([]))
  }, [])

  const catalog = state.status === 'success' ? state.data : null
  const products = (catalog?.products ?? []).filter((p) => availableHere(p.type, inMecca))
  const vat = catalog?.settings.vat_rate ?? 0
  const heroBanners = (banners ?? []).filter((b) => (b.placement ?? 'hero') === 'hero')
  const midBanners = (banners ?? []).filter((b) => b.placement === 'mid').slice(0, 2)
  const byId = new Map(products.map((p) => [p.id, p]))

  const grid = (list: ProductWithCategory[]) => (
    <div className="grid">
      {list.map((p) => (
        <ProductCard key={p.id} product={p} vatRate={vat} />
      ))}
    </div>
  )

  const render = (s: HomeSection) => {
    switch (s.key) {
      case 'announcement':
        if (!s.config.text || !live(s.config.starts_at, s.config.ends_at)) return null
        return (
          <div className="announce">
            {s.config.link ? (
              <SmartLink to={s.config.link} className="announce-in">
                {s.config.text} <span aria-hidden="true">←</span>
              </SmartLink>
            ) : (
              <span className="announce-in">{s.config.text}</span>
            )}
          </div>
        )

      case 'hero':
        if (banners === null) return <div className="skeleton hero-skel" aria-hidden="true" />
        return heroBanners.length ? <BannerSlider banners={heroBanners} /> : <Welcome s={s} />

      case 'benefits': {
        const items = (s.config.items ?? []).filter((i) => i.title)
        if (!items.length) return null
        return (
          <section className="benefits" aria-label="مزايا المتجر">
            {items.slice(0, 4).map((i, n) => (
              <div key={n} className="benefit">
                <span className="benefit-ic">
                  <BenefitGlyph icon={i.icon} />
                </span>
                <div>
                  <b>{i.title}</b>
                  {i.text && <span className="muted">{i.text}</span>}
                </div>
              </div>
            ))}
          </section>
        )
      }

      case 'categories': {
        const cats = (catalog?.categories ?? []).filter((c) => !c.parent_id && c.is_visible)
        if (!cats.length) return null
        return (
          <section>
            <Head s={s} />
            <div className="cat-tiles">
              {cats.map((c) => (
                <Link key={c.id} to={`/products?cat=${encodeURIComponent(c.slug)}`} className="cat-tile">
                  <span className="cat-img">
                    {c.image_path ? (
                      <img src={homeImageUrl(c.image_path)} alt="" loading="lazy" />
                    ) : (
                      <PlaceholderArt type={c.slug === 'devices' || c.slug === 'bundles' ? 'device' : 'part'} />
                    )}
                  </span>
                  <b>{c.name_ar}</b>
                </Link>
              ))}
            </div>
          </section>
        )
      }

      case 'featured': {
        const chosen = (s.config.product_ids ?? []).map((id) => byId.get(id)).filter((p): p is ProductWithCategory => !!p)
        const list = chosen.length ? chosen : products.filter((p) => p.is_featured)
        return (
          <section>
            <Head s={s} more={{ to: '/products', label: 'كل المنتجات' }} />
            <CatalogStatus state={state} reload={reload} />
            {catalog && (list.length ? grid(list.slice(0, 8)) : <p className="muted">لا توجد منتجات مميزة حالياً.</p>)}
          </section>
        )
      }

      case 'promos':
        if (!midBanners.length) return null
        return (
          <section className={midBanners.length === 1 ? 'promos one' : 'promos'} aria-label="عروض">
            {midBanners.map((b) => (
              <PromoBanner key={b.id} b={b} />
            ))}
          </section>
        )

      case 'bundles': {
        const list = products.filter((p) => p.type === 'bundle')
        if (!list.length) return null
        return (
          <section>
            <Head s={s} more={{ to: '/products?cat=bundles', label: 'كل الباقات' }} />
            {grid(list.slice(0, 4))}
          </section>
        )
      }

      case 'service':
        return (
          <section className={s.config.image_path ? 'feature-band' : 'feature-band no-img'}>
            {s.config.image_path && <img src={homeImageUrl(s.config.image_path)} alt="" loading="lazy" className="feature-img" />}
            <div className="feature-text">
              {s.title_ar && <h2 className="h2">{s.title_ar}</h2>}
              {s.subtitle_ar && <p>{s.subtitle_ar}</p>}
              {s.config.link && (
                <SmartLink to={s.config.link} className="btn">
                  {s.config.button || 'اطلب الآن'}
                </SmartLink>
              )}
            </div>
          </section>
        )

      case 'reviews': {
        if (!reviews.length) return null
        const name = (id: string) => catalog?.products.find((p) => p.id === id)
        return (
          <section>
            <Head s={s} />
            <div className="reviews-grid">
              {reviews.slice(0, 6).map((r) => {
                const p = name(r.product_id)
                return <ReviewCard key={r.id} review={r} productName={p?.name_ar} productHref={p ? productPath(p) : undefined} />
              })}
            </div>
          </section>
        )
      }

      case 'about':
        return (
          <section className={s.config.image_path ? 'about-band' : 'about-band no-img'}>
            <div className="about-text">
              {s.title_ar && <h2 className="h2">{s.title_ar}</h2>}
              {s.subtitle_ar && <p>{s.subtitle_ar}</p>}
              {s.config.link && (
                <SmartLink to={s.config.link} className="btn ghost">
                  {s.config.button || 'اعرف أكثر'}
                </SmartLink>
              )}
            </div>
            {s.config.image_path ? (
              <img src={homeImageUrl(s.config.image_path)} alt="" loading="lazy" className="about-img" />
            ) : (
              <img src="/brand/logo-color.png" alt="" className="about-logo" width="400" height="222" />
            )}
          </section>
        )
    }
  }

  if (!sections) return <div className="skeleton hero-skel" aria-hidden="true" />

  // The maintenance strip sits right under the main banner (or first block).
  const shown = sections.filter((s) => sectionShows(s, inMecca))
  const stripAfter = shown.find((s) => s.key === 'hero')?.id ?? shown.find((s) => s.key !== 'announcement')?.id

  return (
    <div className="home">
      {shown.map((s) => {
          const node = render(s)
          return node ? (
            <Fragment key={s.id}>
              <div className={`home-sec sec-${s.key}`}>{node}</div>
              {s.id === stripAfter && inMecca && (
                <section className="home-sec svc-strip" aria-label="الصيانة والبلاغات">
                  <ServiceLinks compact />
                </section>
              )}
            </Fragment>
          ) : null
        })}
    </div>
  )
}
