import { PRODUCT_TYPE_LABELS, priceWithVat } from '@ghaith/shared'
import { formatSar, type ProductWithCategory } from '../lib/catalog'

function PlaceholderArt({ type }: { type: ProductWithCategory['type'] }) {
  // Water drop for devices/bundles, box for everything else.
  return type === 'device' || type === 'bundle' ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" />
    </svg>
  )
}

export function ProductCard({ product, vatRate }: { product: ProductWithCategory; vatRate: number }) {
  const total = priceWithVat(product.price_before_vat, vatRate)
  return (
    <article className="prod">
      <div className="prod-img">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name_ar} loading="lazy" />
        ) : (
          <PlaceholderArt type={product.type} />
        )}
      </div>
      <span className="tag">{product.category?.name_ar ?? PRODUCT_TYPE_LABELS[product.type]}</span>
      <b>{product.name_ar}</b>
      {product.description_ar && <p className="muted">{product.description_ar}</p>}
      {product.specs.length > 0 && (
        <ul className="specs">
          {product.specs.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
      <div className="price">
        {formatSar(total)} <small>شامل الضريبة</small>
      </div>
    </article>
  )
}
