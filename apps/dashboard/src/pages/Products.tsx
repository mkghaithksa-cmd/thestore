import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PRODUCT_TYPE_LABELS, priceWithVat, type Category, type ProductType } from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { categoryOptions, fetchCategories, fetchProducts, fetchSettings, mainImage, type ProductRow } from '../lib/catalog'
import { formatSar } from '../lib/format'
import { useStaffAuth } from '../lib/staffAuth'

type Filter = 'all' | ProductType

export function Products() {
  const { can } = useStaffAuth()
  const [products, setProducts] = useState<ProductRow[] | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [vat, setVat] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [type, setType] = useState<Filter>('all')
  const [status, setStatus] = useState<'all' | 'draft' | 'published'>('all')

  useEffect(() => {
    Promise.all([fetchProducts(), fetchCategories(), fetchSettings()])
      .then(([p, c, s]) => {
        setProducts(p)
        setCategories(c)
        setVat(s.vat_rate)
      })
      .catch(() => setError('تعذّر تحميل المنتجات.'))
  }, [])

  const catLabel = useMemo(() => new Map(categoryOptions(categories).map((o) => [o.id, o.label])), [categories])

  const shown = (products ?? []).filter((p) => {
    if (type !== 'all' && p.type !== type) return false
    if (status !== 'all' && p.status !== status) return false
    const term = q.trim().toLowerCase()
    if (!term) return true
    return [p.name_ar, p.name_en, p.sku, p.model].some((v) => v?.toLowerCase().includes(term))
  })

  return (
    <RequirePage page="catalog">
      <div className="ph">
        <div>
          <h1>المنتجات</h1>
          <p>كل ما يظهر في المتجر. المسودة لا تظهر للعملاء حتى تنشرها.</p>
        </div>
        {can('catalog', 'add') && (
          <Link to="/catalog/new" className="btn">
            + منتج جديد
          </Link>
        )}
      </div>

      <div className="card stack">
        <div className="row wrapr">
          <input
            className="input grow"
            placeholder="ابحث بالاسم أو SKU أو الموديل"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="بحث"
          />
          <select className="input sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="الحالة">
            <option value="all">كل الحالات</option>
            <option value="published">منشور</option>
            <option value="draft">مسودة</option>
          </select>
        </div>
        <div className="chips" role="group" aria-label="النوع">
          {(['all', 'device', 'filter', 'part', 'service', 'bundle'] as Filter[]).map((t) => (
            <button key={t} className={type === t ? 'on' : ''} onClick={() => setType(t)}>
              {t === 'all' ? 'الكل' : PRODUCT_TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      {!products && !error && <p className="muted">جاري التحميل…</p>}

      {products && (
        <div className="card tw">
          <table>
            <thead>
              <tr>
                <th />
                <th>المنتج</th>
                <th>SKU</th>
                <th>النوع</th>
                <th>التصنيف</th>
                <th>السعر شامل الضريبة</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const img = mainImage(p)
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="thumb">{img ? <img src={img} alt="" loading="lazy" /> : null}</div>
                    </td>
                    <td>
                      <Link to={`/catalog/${p.id}`} className="strong-link">
                        {p.name_ar}
                      </Link>
                      {p.is_featured && <span className="badge b-warn ms">مميز</span>}
                    </td>
                    <td dir="ltr" className="num">
                      {p.sku}
                    </td>
                    <td>{PRODUCT_TYPE_LABELS[p.type]}</td>
                    <td>{catLabel.get(p.category_id) ?? '—'}</td>
                    <td className="num">{vat === null ? '—' : formatSar(priceWithVat(p.price_before_vat, vat))}</td>
                    <td>
                      <span className={`badge ${p.status === 'published' ? 'b-ok' : 'b-gray'}`}>
                        {p.status === 'published' ? 'منشور' : 'مسودة'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="center-cell muted">
                    لا توجد منتجات مطابقة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </RequirePage>
  )
}
