import { Link } from 'react-router-dom'
import type { BenefitIcon, Review } from '@ghaith/shared'

/** Simple line icons for the benefits strip. */
export function BenefitGlyph({ icon }: { icon: BenefitIcon }) {
  const paths: Record<BenefitIcon, React.ReactNode> = {
    tools: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.8-.7-.7-2.8z" />,
    shield: <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    truck: (
      <>
        <path d="M2 6h11v10H2zM13 9h4l4 4v3h-8" />
        <circle cx="6.5" cy="17.5" r="1.8" />
        <circle cx="17" cy="17.5" r="1.8" />
      </>
    ),
    drop: <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />,
    phone: <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z" />,
    star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[icon]}
    </svg>
  )
}

export function Stars({ value, label }: { value: number; label?: string }) {
  const full = Math.round(value)
  return (
    <span className="stars" role="img" aria-label={label ?? `${value} من 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg key={n} viewBox="0 0 24 24" className={n <= full ? 'on' : undefined} aria-hidden="true">
          <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
        </svg>
      ))}
    </span>
  )
}

export function ReviewCard({ review, productName, productHref }: { review: Review; productName?: string; productHref?: string }) {
  return (
    <figure className="review">
      <div className="review-top">
        <Stars value={review.rating} />
        {review.is_sample && <span className="tag sample">تقييم تجريبي</span>}
      </div>
      {review.body && <blockquote>{review.body}</blockquote>}
      <figcaption>
        <b>{review.author_name}</b>
        {review.city && <span className="muted"> · {review.city}</span>}
        {productName && productHref && (
          <Link to={productHref} className="review-prod">
            {productName}
          </Link>
        )}
      </figcaption>
    </figure>
  )
}

/** Internal links go through the router; https links open in a new tab. */
export function SmartLink({ to, className, children }: { to: string; className?: string; children: React.ReactNode }) {
  if (/^https:\/\//.test(to)) {
    return (
      <a href={to} className={className} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
  return (
    <Link to={to.startsWith('/') ? to : '/'} className={className}>
      {children}
    </Link>
  )
}
