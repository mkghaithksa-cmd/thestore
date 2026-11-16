import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ProductCard } from '../components/ProductCard'
import { CatalogStatus } from '../components/CatalogStatus'
import { useCatalog } from '../lib/useCatalog'
import { availableHere, useLocationChoice } from '../lib/location'
import { SORTS, isSortKey, matchesQuery, sortProducts, type SortKey } from '../lib/search'

export function Products() {
  const { state, reload } = useCatalog()
  const { inMecca } = useLocationChoice()
  const [params, setParams] = useSearchParams()
  const active = params.get('cat') ?? 'all'
  const sortParam = params.get('sort')
  const sort: SortKey = isSortKey(sortParam) ? sortParam : 'featured'
  const q = params.get('q') ?? ''
  // The box updates instantly; the URL follows after a short pause.
  const [text, setText] = useState(q)
  useEffect(() => setText(q), [q])

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  useEffect(() => {
    if (text === q) return
    const t = setTimeout(() => update({ q: text.trim() || null }), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  const header = (
    <>
      <h1 className="page-h">المنتجات</h1>
      <p className="sub">كل الأسعار شاملة ضريبة القيمة المضافة.</p>
    </>
  )

  if (state.status !== 'success') {
    return (
      <>
        {header}
        <CatalogStatus state={state} reload={reload} />
      </>
    )
  }

  const { categories, settings } = state.data
  // Outside Mecca, services (installation, maintenance) are not offered.
  const products = state.data.products.filter((p) => availableHere(p.type, inMecca))
  // A category includes its sub-categories.
  const selected = categories.find((c) => c.slug === active)
  const ids = new Set(selected ? [selected.id, ...categories.filter((c) => c.parent_id === selected.id).map((c) => c.id)] : [])
  const inCategory = active === 'all' || !selected ? products : products.filter((p) => ids.has(p.category_id))
  const shown = sortProducts(
    inCategory.filter((p) => matchesQuery(p, text)),
    sort,
    text,
  )
  const topLevel = categories.filter((c) => !c.parent_id)

  return (
    <>
      {header}

      <div className="toolbar">
        <div className="search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <input
            type="search"
            className="input"
            placeholder="ابحث باسم المنتج أو الموديل…"
            aria-label="بحث في المنتجات"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <label className="sort">
          <span>الترتيب</span>
          <select className="input" value={sort} onChange={(e) => update({ sort: e.target.value === 'featured' ? null : e.target.value })}>
            {Object.entries(SORTS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="chips" role="group" aria-label="تصفية حسب القسم">
        {[{ slug: 'all', name_ar: 'الكل' }, ...topLevel].map((c) => (
          <button
            key={c.slug}
            className={c.slug === active || (c.slug === 'all' && !selected) ? 'on' : undefined}
            aria-pressed={c.slug === active}
            onClick={() => update({ cat: c.slug === 'all' ? null : c.slug })}
          >
            {c.name_ar}
          </button>
        ))}
      </div>

      <p className="muted count" aria-live="polite">
        {shown.length ? `عدد المنتجات: ${shown.length}` : ''}
      </p>

      {shown.length ? (
        <div className="grid">
          {shown.map((p) => (
            <ProductCard key={p.id} product={p} vatRate={settings.vat_rate} />
          ))}
        </div>
      ) : (
        <div className="notice">
          <b>{text ? `لا توجد نتائج لـ «${text}».` : 'لا توجد منتجات في هذا القسم.'}</b>
          {(text || selected) && (
            <button className="linkbtn" onClick={() => { setText(''); update({ q: null, cat: null }) }}>
              عرض كل المنتجات
            </button>
          )}
        </div>
      )}
    </>
  )
}
