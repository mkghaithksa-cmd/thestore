import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { BANNERS_BUCKET, bannerHref, publicStorageUrl, type HomeBanner } from '@ghaith/shared'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
const url = (path: string) => publicStorageUrl(SUPABASE_URL, BANNERS_BUCKET, path)
const ROTATE_MS = 6000

/** One banner: phones get the tall image, laptops the wide one (art direction). */
function Slide({ banner, eager }: { banner: HomeBanner; eager: boolean }) {
  const picture = (
    <picture>
      {banner.mobile_path && <source media="(max-width: 640px)" srcSet={url(banner.mobile_path)} />}
      <img
        src={url(banner.desktop_path)}
        alt={banner.title}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : 'auto'}
        decoding="async"
      />
    </picture>
  )
  const href = bannerHref(banner)
  if (!href) return picture
  return /^https:\/\//.test(href) ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {picture}
    </a>
  ) : (
    <Link to={href}>{picture}</Link>
  )
}

/** Auto-rotating banner slider with dots and swipe. */
export function BannerSlider({ banners }: { banners: HomeBanner[] }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const startX = useRef<number | null>(null)
  const swiped = useRef(false)
  const count = banners.length
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (count < 2 || paused || reduceMotion) return
    const t = setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS)
    return () => clearInterval(t)
  }, [count, paused, reduceMotion])

  if (count === 0) return null
  const go = (i: number) => setIndex(((i % count) + count) % count)

  return (
    <section
      className={`banners${banners.some((b) => b.mobile_path) ? ' has-mobile' : ''}`}
      aria-roledescription="carousel"
      aria-label="العروض"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onPointerDown={(e) => (startX.current = e.clientX)}
      onPointerUp={(e) => {
        if (startX.current === null) return
        const dx = e.clientX - startX.current
        startX.current = null
        swiped.current = Math.abs(dx) > 40
        // RTL: swiping left shows the next slide.
        if (swiped.current) go(index + (dx < 0 ? 1 : -1))
      }}
      onClickCapture={(e) => {
        // A swipe must not also open the banner's link.
        if (swiped.current) e.preventDefault()
        swiped.current = false
      }}
    >
      <div className="banner-track" style={{ transform: `translateX(${index * 100}%)` }}>
        {banners.map((b, i) => (
          <div
            key={b.id}
            className={`banner-slide${b.mobile_path ? ' has-mobile' : ''}`}
            aria-roledescription="slide"
            aria-label={`${i + 1} من ${count}`}
            aria-hidden={i !== index}
            inert={i !== index}
          >
            <Slide banner={b} eager={i === 0} />
          </div>
        ))}
      </div>
      {count > 1 && (
        <div className="banner-dots">
          {banners.map((b, i) => (
            <button
              key={b.id}
              className={i === index ? 'on' : ''}
              aria-label={`عرض ${i + 1}`}
              aria-current={i === index}
              onClick={() => go(i)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
