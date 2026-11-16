import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  PRODUCT_TYPE_FIELDS,
  PRODUCT_TYPE_LABELS,
  priceWithVat,
  type Category,
  type FilterCompatibility,
  type Manufacturer,
  type Product,
  type ProductImage,
  type ProductType,
} from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { ProductImages } from '../components/ProductImages'
import { catalogError, categoryOptions, fetchCategories, fetchManufacturers, fetchSettings } from '../lib/catalog'
import { formatSar, parseAmount } from '../lib/format'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

/** Editable form values (numbers kept as typed text). */
interface Draft {
  type: ProductType
  name_ar: string
  name_en: string
  sku: string
  category_id: string
  manufacturer_id: string
  model: string
  description_ar: string
  specs: string
  price: string
  cost: string
  warranty_months: string
  installable_in_mecca: boolean
  tracks_stock: boolean
  reorder_level: string
  unit: string
  status: Product['status']
  is_featured: boolean
}

type CompatDraft = { device_model: string; stage_number: string; lifetime_months: string }

const EMPTY: Draft = {
  type: 'device',
  name_ar: '',
  name_en: '',
  sku: '',
  category_id: '',
  manufacturer_id: '',
  model: '',
  description_ar: '',
  specs: '',
  price: '',
  cost: '',
  warranty_months: '0',
  installable_in_mecca: false,
  tracks_stock: true,
  reorder_level: '0',
  unit: 'قطعة',
  status: 'draft',
  is_featured: false,
}

function toDraft(p: Product, cost: number | null): Draft {
  return {
    type: p.type,
    name_ar: p.name_ar,
    name_en: p.name_en ?? '',
    sku: p.sku,
    category_id: p.category_id,
    manufacturer_id: p.manufacturer_id ?? '',
    model: p.model ?? '',
    description_ar: p.description_ar ?? '',
    specs: (p.specs ?? []).join('\n'),
    price: String(p.price_before_vat),
    cost: cost === null ? '' : String(cost),
    warranty_months: String(p.warranty_months),
    installable_in_mecca: p.installable_in_mecca,
    tracks_stock: p.tracks_stock,
    reorder_level: String(p.reorder_level),
    unit: p.unit,
    status: p.status,
    is_featured: p.is_featured,
  }
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="muted">{hint}</span>}
    </div>
  )
}

export function ProductForm() {
  const { id } = useParams()
  const isNew = !id
  const navigate = useNavigate()
  const justCreated = (useLocation().state as { created?: boolean } | null)?.created
  const { can } = useStaffAuth()
  const canSave = isNew ? can('catalog', 'add') : can('catalog', 'edit')
  const canSeeCost = can('catalog', 'edit')

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [compat, setCompat] = useState<CompatDraft[]>([])
  const [images, setImages] = useState<ProductImage[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [makers, setMakers] = useState<Manufacturer[]>([])
  const [deviceModels, setDeviceModels] = useState<string[]>([])
  const [vat, setVat] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [cats, mks, settings, devices] = await Promise.all([
        fetchCategories(),
        fetchManufacturers(),
        fetchSettings(),
        supabase.from('products').select('model').eq('type', 'device').not('model', 'is', null),
      ])
      if (cancelled) return
      setCategories(cats)
      setMakers(mks)
      setVat(settings.vat_rate)
      setDeviceModels([...new Set((devices.data ?? []).map((d) => d.model as string))].sort())
      if (!id) return
      const [{ data: product }, costRes, compatRes, imgRes] = await Promise.all([
        supabase.from('products').select('*').eq('id', id).maybeSingle(),
        canSeeCost
          ? supabase.from('product_costs').select('cost').eq('product_id', id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('filter_compatibility').select('*').eq('filter_product_id', id),
        supabase.from('product_images').select('*').eq('product_id', id),
      ])
      if (cancelled) return
      if (!product) throw new Error('not_found')
      setDraft(toDraft(product as Product, (costRes.data as { cost: number } | null)?.cost ?? null))
      setCompat(
        ((compatRes.data ?? []) as FilterCompatibility[]).map((c) => ({
          device_model: c.device_model,
          stage_number: c.stage_number === null ? '' : String(c.stage_number),
          lifetime_months: String(c.lifetime_months),
        })),
      )
      setImages((imgRes.data ?? []) as ProductImage[])
    }
    load()
      .catch((e: Error) => setError(e.message === 'not_found' ? 'المنتج غير موجود.' : 'تعذّر التحميل.'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [id, canSeeCost])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false)
    setDraft((d) => ({ ...d, [key]: value }))
  }
  const fields = PRODUCT_TYPE_FIELDS[draft.type]
  const price = parseAmount(draft.price)
  const cost = parseAmount(draft.cost)
  const margin = price > 0 && cost >= 0 ? ((price - cost) / price) * 100 : null

  function validate(): string | null {
    if (draft.name_ar.trim().length < 2) return 'أدخل اسم المنتج بالعربي.'
    if (!draft.sku.trim()) return 'أدخل رمز SKU.'
    if (!draft.category_id) return 'اختر التصنيف.'
    if (!(price >= 0)) return 'أدخل السعر قبل الضريبة.'
    if (draft.status === 'published' && !(price > 0)) return 'لا يمكن نشر منتج بسعر صفر.'
    if (canSeeCost && draft.cost.trim() && !(cost >= 0)) return 'التكلفة غير صحيحة.'
    for (const c of compat) {
      if (!c.device_model.trim()) return 'اختر موديل الجهاز في كل سطر توافق.'
      if (!(Number(c.lifetime_months) > 0)) return 'عمر الفلتر يجب أن يكون شهراً أو أكثر.'
    }
    return null
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const problem = validate()
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    const payload = {
      type: draft.type,
      name_ar: draft.name_ar.trim(),
      name_en: draft.name_en.trim() || null,
      sku: draft.sku.trim(),
      category_id: draft.category_id,
      manufacturer_id: draft.manufacturer_id || null,
      model: fields.model ? draft.model.trim() || null : null,
      description_ar: draft.description_ar.trim() || null,
      specs: draft.specs.split('\n').map((s) => s.trim()).filter(Boolean),
      price_before_vat: price,
      warranty_months: fields.warranty ? Math.max(0, Math.floor(Number(draft.warranty_months) || 0)) : 0,
      installable_in_mecca: fields.installable && draft.installable_in_mecca,
      tracks_stock: fields.stock && draft.tracks_stock,
      reorder_level: fields.stock && draft.tracks_stock ? Math.max(0, Math.floor(Number(draft.reorder_level) || 0)) : 0,
      unit: draft.unit.trim() || 'قطعة',
      status: draft.status,
      is_featured: draft.is_featured,
    }
    try {
      let productId = id
      if (isNew) {
        const { data, error: insErr } = await supabase.from('products').insert(payload).select('id').single()
        if (insErr) throw new Error(insErr.message)
        productId = data.id as string
      } else {
        const { error: upErr } = await supabase.from('products').update(payload).eq('id', id)
        if (upErr) throw new Error(upErr.message)
      }

      if (canSeeCost && draft.cost.trim()) {
        const { error: costErr } = await supabase
          .from('product_costs')
          .upsert({ product_id: productId, cost }, { onConflict: 'product_id' })
        if (costErr) throw new Error(costErr.message)
      }

      if (fields.compatibility || !isNew) {
        if (!isNew) {
          const { error: delErr } = await supabase.from('filter_compatibility').delete().eq('filter_product_id', productId)
          if (delErr) throw new Error(delErr.message)
        }
        const rows = fields.compatibility
          ? compat.map((c) => ({
              filter_product_id: productId,
              device_model: c.device_model.trim(),
              stage_number: c.stage_number ? Number(c.stage_number) : null,
              lifetime_months: Number(c.lifetime_months),
            }))
          : []
        if (rows.length) {
          const { error: cErr } = await supabase.from('filter_compatibility').insert(rows)
          if (cErr) throw new Error(cErr.message)
        }
      }

      if (isNew) navigate(`/catalog/${productId}`, { replace: true, state: { created: true } })
      else setSaved(true)
    } catch (err) {
      setError(catalogError(err instanceof Error ? err.message : ''))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="center muted">جاري التحميل…</div>

  return (
    <RequirePage page="catalog">
      <div className="ph">
        <div>
          <Link to="/catalog" className="muted">
            → المنتجات
          </Link>
          <h1>{isNew ? 'منتج جديد' : draft.name_ar}</h1>
          {!isNew && (
            <p>
              <span className={`badge ${draft.status === 'published' ? 'b-ok' : 'b-gray'}`}>
                {draft.status === 'published' ? 'منشور' : 'مسودة'}
              </span>{' '}
              {PRODUCT_TYPE_LABELS[draft.type]}
            </p>
          )}
        </div>
      </div>

      <form onSubmit={onSubmit} className="stack">
        <fieldset disabled={!canSave || busy} className="stack plain">
          <section className="card stack">
            <h2 className="h3">نوع المنتج</h2>
            <div className="chips" role="radiogroup" aria-label="نوع المنتج">
              {(Object.keys(PRODUCT_TYPE_LABELS) as ProductType[]).map((t) => (
                  <button
                    type="button"
                    key={t}
                    role="radio"
                    aria-checked={draft.type === t}
                    className={draft.type === t ? 'on' : ''}
                    disabled={!isNew}
                    onClick={() => set('type', t)}
                  >
                    {PRODUCT_TYPE_LABELS[t]}
                  </button>
                ))}
            </div>
            {!isNew && <span className="muted">لا يتغير النوع بعد إنشاء المنتج.</span>}
          </section>

          <section className="card">
            <h2 className="h3">البيانات الأساسية</h2>
            <div className="grid-form">
              <Field label="الاسم بالعربي *" htmlFor="name_ar">
                <input id="name_ar" className="input" value={draft.name_ar} onChange={(e) => set('name_ar', e.target.value)} />
              </Field>
              <Field label="الاسم بالإنجليزي" htmlFor="name_en">
                <input id="name_en" className="input" dir="ltr" value={draft.name_en} onChange={(e) => set('name_en', e.target.value)} />
              </Field>
              <Field label="رمز SKU *" htmlFor="sku" hint="رمز فريد لا يتكرر، مثل DEV-GH500">
                <input
                  id="sku"
                  className="input"
                  dir="ltr"
                  value={draft.sku}
                  onChange={(e) => set('sku', e.target.value.toUpperCase().replace(/\s/g, ''))}
                />
              </Field>
              <Field label="التصنيف *" htmlFor="category">
                <select id="category" className="input" value={draft.category_id} onChange={(e) => set('category_id', e.target.value)}>
                  <option value="">اختر…</option>
                  {categoryOptions(categories).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="الشركة المصنعة" htmlFor="maker">
                <select id="maker" className="input" value={draft.manufacturer_id} onChange={(e) => set('manufacturer_id', e.target.value)}>
                  <option value="">—</option>
                  {makers
                    .filter((m) => m.is_active || m.id === draft.manufacturer_id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </Field>
              {fields.model && (
                <Field label="الموديل" htmlFor="model" hint={draft.type === 'device' ? 'الفلاتر تُربط بالجهاز عن طريق الموديل.' : undefined}>
                  <input id="model" className="input" dir="ltr" value={draft.model} onChange={(e) => set('model', e.target.value)} />
                </Field>
              )}
            </div>
            <Field label="الوصف" htmlFor="desc">
              <textarea id="desc" className="input textarea" rows={3} value={draft.description_ar} onChange={(e) => set('description_ar', e.target.value)} />
            </Field>
            <Field label="المواصفات المختصرة" htmlFor="specs" hint="كل سطر يظهر كنقطة في بطاقة المنتج.">
              <textarea id="specs" className="input textarea" rows={3} value={draft.specs} onChange={(e) => set('specs', e.target.value)} />
            </Field>
          </section>

          <section className="card">
            <h2 className="h3">السعر</h2>
            <div className="grid-form">
              <Field label="السعر قبل الضريبة (ر.س) *" htmlFor="price">
                <input id="price" className="input num" inputMode="decimal" dir="ltr" value={draft.price} onChange={(e) => set('price', e.target.value)} />
              </Field>
              <Field label="السعر للعميل شامل الضريبة">
                <div className="input readonly num">{vat !== null && price >= 0 ? formatSar(priceWithVat(price, vat)) : '—'}</div>
              </Field>
              {canSeeCost && (
                <>
                  <Field label="التكلفة (للإدارة فقط)" htmlFor="cost">
                    <input id="cost" className="input num" inputMode="decimal" dir="ltr" value={draft.cost} onChange={(e) => set('cost', e.target.value)} />
                  </Field>
                  <Field label="الهامش">
                    <div className={`input readonly num${margin !== null && margin < 0 ? ' bad' : ''}`}>
                      {margin === null || !draft.cost.trim() ? '—' : `${formatSar(price - cost)} (${margin.toFixed(1)}٪)`}
                    </div>
                  </Field>
                </>
              )}
            </div>
            {canSeeCost && <span className="muted">التكلفة والهامش لا يظهران للعملاء ولا للموظفين بدون صلاحية تعديل الكتالوج.</span>}
          </section>

          {(fields.warranty || fields.installable || fields.stock) && (
            <section className="card">
              <h2 className="h3">{draft.type === 'device' ? 'الضمان والتركيب والمخزون' : 'تفاصيل إضافية'}</h2>
              <div className="grid-form">
                {fields.warranty && (
                  <Field label="الضمان (بالأشهر)" htmlFor="warranty" hint="0 = بدون ضمان">
                    <input id="warranty" className="input num" inputMode="numeric" dir="ltr" value={draft.warranty_months} onChange={(e) => set('warranty_months', e.target.value.replace(/\D/g, ''))} />
                  </Field>
                )}
                {fields.stock && (
                  <>
                    <Field label="الوحدة" htmlFor="unit">
                      <input id="unit" className="input" value={draft.unit} onChange={(e) => set('unit', e.target.value)} />
                    </Field>
                    {draft.tracks_stock && (
                      <Field label="حد إعادة الطلب" htmlFor="reorder" hint="ننبهك لما يقل المخزون عن هذا العدد.">
                        <input id="reorder" className="input num" inputMode="numeric" dir="ltr" value={draft.reorder_level} onChange={(e) => set('reorder_level', e.target.value.replace(/\D/g, ''))} />
                      </Field>
                    )}
                  </>
                )}
              </div>
              {fields.installable && (
                <label className="check">
                  <input type="checkbox" checked={draft.installable_in_mecca} onChange={(e) => set('installable_in_mecca', e.target.checked)} />
                  يقبل التركيب داخل مكة (يظهر للعميل خيار التركيب)
                </label>
              )}
              {fields.stock && (
                <label className="check">
                  <input type="checkbox" checked={draft.tracks_stock} onChange={(e) => set('tracks_stock', e.target.checked)} />
                  نتابع مخزونه
                </label>
              )}
            </section>
          )}

          {fields.compatibility && (
            <section className="card stack">
              <div>
                <h2 className="h3">العمر والتوافق</h2>
                <span className="muted">على أي جهاز يركب الفلتر، ورقم المرحلة، وكل كم شهر يتغير. منها نحسب موعد الصيانة.</span>
              </div>
              <datalist id="device-models">
                {deviceModels.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {compat.map((c, i) => (
                <div key={i} className="row wrapr align-end">
                  <Field label="موديل الجهاز" htmlFor={`cm-${i}`}>
                    <input id={`cm-${i}`} className="input" dir="ltr" list="device-models" value={c.device_model} onChange={(e) => setCompat((rows) => rows.map((r, j) => (j === i ? { ...r, device_model: e.target.value } : r)))} />
                  </Field>
                  <Field label="المرحلة" htmlFor={`cs-${i}`}>
                    <input id={`cs-${i}`} className="input sm num" inputMode="numeric" dir="ltr" value={c.stage_number} onChange={(e) => setCompat((rows) => rows.map((r, j) => (j === i ? { ...r, stage_number: e.target.value.replace(/\D/g, '') } : r)))} />
                  </Field>
                  <Field label="العمر (أشهر)" htmlFor={`cl-${i}`}>
                    <input id={`cl-${i}`} className="input sm num" inputMode="numeric" dir="ltr" value={c.lifetime_months} onChange={(e) => setCompat((rows) => rows.map((r, j) => (j === i ? { ...r, lifetime_months: e.target.value.replace(/\D/g, '') } : r)))} />
                  </Field>
                  <button type="button" className="btn sm ghost field-btn" onClick={() => setCompat((rows) => rows.filter((_, j) => j !== i))}>
                    حذف
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn sm sec self-start"
                onClick={() => setCompat((rows) => [...rows, { device_model: '', stage_number: '', lifetime_months: rows.at(-1)?.lifetime_months ?? '6' }])}
              >
                + إضافة جهاز متوافق
              </button>
            </section>
          )}

          <section className="card stack">
            <h2 className="h3">النشر</h2>
            <div className="chips" role="radiogroup" aria-label="الحالة">
              <button type="button" role="radio" aria-checked={draft.status === 'draft'} className={draft.status === 'draft' ? 'on' : ''} onClick={() => set('status', 'draft')}>
                مسودة
              </button>
              <button type="button" role="radio" aria-checked={draft.status === 'published'} className={draft.status === 'published' ? 'on' : ''} onClick={() => set('status', 'published')}>
                منشور في المتجر
              </button>
            </div>
            <label className="check">
              <input type="checkbox" checked={draft.is_featured} onChange={(e) => set('is_featured', e.target.checked)} />
              مميز في الصفحة الرئيسية
            </label>
          </section>
        </fieldset>

        {error && <p className="form-error">{error}</p>}
        {justCreated && !saved && <p className="ok-text">تم إنشاء المنتج ✓ أضف صوره من الأسفل.</p>}
        {saved && <p className="ok-text">تم الحفظ ✓</p>}
        {canSave ? (
          <div className="row">
            <button className="btn" disabled={busy}>
              {busy ? 'جاري الحفظ…' : isNew ? 'إنشاء المنتج' : 'حفظ التعديلات'}
            </button>
            <Link to="/catalog" className="btn ghost">
              رجوع
            </Link>
          </div>
        ) : (
          <p className="muted">عرض فقط — لا تملك صلاحية التعديل.</p>
        )}
      </form>

      <section className="card stack">
        <h2 className="h3">الصور</h2>
        {isNew ? (
          <p className="muted">أنشئ المنتج أولاً، بعدها تضيف الصور هنا.</p>
        ) : (
          <ProductImages
            productId={id}
            images={images}
            onChange={setImages}
            canAdd={can('catalog', 'add')}
            canEdit={can('catalog', 'edit')}
          />
        )}
      </section>
    </RequirePage>
  )
}
