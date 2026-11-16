import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { Category, Manufacturer } from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { catalogError, fetchCategories, fetchManufacturers } from '../lib/catalog'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

function CategoryRow({
  cat,
  products,
  canEdit,
  onSaved,
  child,
}: {
  cat: Category
  products: number
  canEdit: boolean
  onSaved: () => void
  child?: boolean
}) {
  const [name, setName] = useState(cat.name_ar)
  const [error, setError] = useState<string | null>(null)
  const changed = name.trim() !== cat.name_ar

  async function save(patch: Partial<Category>) {
    setError(null)
    const { error: e } = await supabase.from('categories').update(patch).eq('id', cat.id)
    if (e) setError(catalogError(e.message))
    else onSaved()
  }

  return (
    <tr className={cat.is_visible ? '' : 'dim'}>
      <td>
        <div className={`row${child ? ' indent' : ''}`}>
          {child && <span className="muted">↳</span>}
          <input className="input sm grow" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} aria-label="اسم التصنيف" />
          {changed && (
            <button className="btn sm" onClick={() => save({ name_ar: name.trim() })}>
              حفظ
            </button>
          )}
        </div>
        {error && <p className="form-error">{error}</p>}
      </td>
      <td className="num">{products}</td>
      <td>
        <input
          className="input sm num"
          style={{ width: 70 }}
          type="number"
          defaultValue={cat.sort_order}
          disabled={!canEdit}
          onBlur={(e) => Number(e.target.value) !== cat.sort_order && save({ sort_order: Number(e.target.value) || 0 })}
          aria-label="الترتيب"
        />
      </td>
      <td>
        <span className={`badge ${cat.is_visible ? 'b-ok' : 'b-gray'}`}>{cat.is_visible ? 'ظاهر' : 'مخفي'}</span>
      </td>
      <td>
        {canEdit && (
          <button className="btn sm ghost" onClick={() => save({ is_visible: !cat.is_visible })}>
            {cat.is_visible ? 'إخفاء' : 'إظهار'}
          </button>
        )}
      </td>
    </tr>
  )
}

function ManufacturerRow({ m, canEdit, onSaved }: { m: Manufacturer; canEdit: boolean; onSaved: () => void }) {
  const [name, setName] = useState(m.name)
  const [country, setCountry] = useState(m.country ?? '')
  const [error, setError] = useState<string | null>(null)
  const changed = name.trim() !== m.name || country.trim() !== (m.country ?? '')

  async function save(patch: Partial<Manufacturer>) {
    setError(null)
    const { error: e } = await supabase.from('manufacturers').update(patch).eq('id', m.id)
    if (e) setError(e.message.includes('duplicate') ? 'الاسم مستخدم.' : catalogError(e.message))
    else onSaved()
  }

  return (
    <tr className={m.is_active ? '' : 'dim'}>
      <td>
        <input className="input sm" value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} aria-label="اسم الشركة" />
        {error && <p className="form-error">{error}</p>}
      </td>
      <td>
        <input className="input sm" value={country} disabled={!canEdit} onChange={(e) => setCountry(e.target.value)} aria-label="الدولة" />
      </td>
      <td>
        <div className="row">
          {canEdit && changed && (
            <button className="btn sm" onClick={() => save({ name: name.trim(), country: country.trim() || null })}>
              حفظ
            </button>
          )}
          {canEdit && (
            <button className="btn sm ghost" onClick={() => save({ is_active: !m.is_active })}>
              {m.is_active ? 'إيقاف' : 'تفعيل'}
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

export function Categories() {
  const { can } = useStaffAuth()
  const canAdd = can('catalog', 'add')
  const canEdit = can('catalog', 'edit')
  const [cats, setCats] = useState<Category[] | null>(null)
  const [makers, setMakers] = useState<Manufacturer[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [newCat, setNewCat] = useState('')
  const [newParent, setNewParent] = useState('')
  const [newMaker, setNewMaker] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [c, m, p] = await Promise.all([fetchCategories(), fetchManufacturers(), supabase.from('products').select('category_id')])
    setCats(c)
    setMakers(m)
    const n: Record<string, number> = {}
    for (const row of (p.data ?? []) as { category_id: string }[]) n[row.category_id] = (n[row.category_id] ?? 0) + 1
    setCounts(n)
  }, [])

  useEffect(() => {
    load().catch(() => setError('تعذّر التحميل.'))
  }, [load])

  async function addCategory(e: FormEvent) {
    e.preventDefault()
    if (newCat.trim().length < 2) return setError('أدخل اسم التصنيف.')
    setError(null)
    const siblings = (cats ?? []).filter((c) => (c.parent_id ?? '') === newParent)
    const { error: err } = await supabase.from('categories').insert({
      name_ar: newCat.trim(),
      parent_id: newParent || null,
      sort_order: Math.max(0, ...siblings.map((c) => c.sort_order)) + 1,
    })
    if (err) return setError(catalogError(err.message))
    setNewCat('')
    load()
  }

  async function addMaker(e: FormEvent) {
    e.preventDefault()
    if (newMaker.trim().length < 2) return setError('أدخل اسم الشركة.')
    setError(null)
    const { error: err } = await supabase.from('manufacturers').insert({ name: newMaker.trim() })
    if (err) return setError(err.message.includes('duplicate') ? 'الشركة موجودة.' : catalogError(err.message))
    setNewMaker('')
    load()
  }

  const tops = (cats ?? []).filter((c) => !c.parent_id)
  const total = (c: Category) =>
    (counts[c.id] ?? 0) + (cats ?? []).filter((k) => k.parent_id === c.id).reduce((s, k) => s + (counts[k.id] ?? 0), 0)

  return (
    <RequirePage page="catalog">
      <div className="ph">
        <div>
          <h1>التصنيفات والشركات</h1>
          <p>التصنيف بمستويين: رئيسي وفرعي. لا يُحذف تصنيف، بل يُخفى، فتختفي منتجاته من المتجر.</p>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}

      <section className="card stack">
        <h2 className="h3">التصنيفات</h2>
        {canAdd && (
          <form className="row wrapr align-end" onSubmit={addCategory}>
            <div className="field grow">
              <label htmlFor="nc">تصنيف جديد</label>
              <input id="nc" className="input" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="np">تحت</label>
              <select id="np" className="input" value={newParent} onChange={(e) => setNewParent(e.target.value)}>
                <option value="">— تصنيف رئيسي —</option>
                {tops.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name_ar}
                  </option>
                ))}
              </select>
            </div>
            <button className="btn field-btn">إضافة</button>
          </form>
        )}
        {!cats ? (
          <p className="muted">جاري التحميل…</p>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>الاسم</th>
                  <th>المنتجات</th>
                  <th>الترتيب</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tops.flatMap((top) => [
                  <CategoryRow key={top.id} cat={top} products={total(top)} canEdit={canEdit} onSaved={load} />,
                  ...cats
                    .filter((c) => c.parent_id === top.id)
                    .map((c) => <CategoryRow key={c.id} cat={c} products={counts[c.id] ?? 0} canEdit={canEdit} onSaved={load} child />),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack">
        <h2 className="h3">الشركات المصنعة</h2>
        {canAdd && (
          <form className="row wrapr align-end" onSubmit={addMaker}>
            <div className="field grow">
              <label htmlFor="nm">شركة جديدة</label>
              <input id="nm" className="input" value={newMaker} onChange={(e) => setNewMaker(e.target.value)} />
            </div>
            <button className="btn field-btn">إضافة</button>
          </form>
        )}
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الدولة</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {makers.map((m) => (
                <ManufacturerRow key={m.id} m={m} canEdit={canEdit} onSaved={load} />
              ))}
              {makers.length === 0 && (
                <tr>
                  <td colSpan={3} className="center-cell muted">
                    لا توجد شركات بعد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </RequirePage>
  )
}
