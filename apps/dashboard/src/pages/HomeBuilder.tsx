import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AUDIENCE_LABELS,
  BANNERS_BUCKET,
  BENEFIT_ICONS,
  HOME_IMAGE_SIZES,
  HOME_SECTION_INFO,
  type Audience,
  type BenefitItem,
  type Category,
  type HomeSection,
  type HomeSectionConfig,
  type HomeSectionKey,
  type Product,
} from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { catalogError, fetchCategories, imageUrl } from '../lib/catalog'
import { imageSize, prepareImage } from '../lib/image'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'
import { Banners } from './Banners'

type MiniProduct = Pick<Product, 'id' | 'name_ar' | 'sku' | 'is_featured' | 'type'>
type Msg = { ok: boolean; text: string } | null

const STORE_URL = import.meta.env.DEV ? 'http://localhost:5173/' : '/'
const homeUrl = (path: string) => imageUrl(path, BANNERS_BUCKET)

/** Which common fields each section shows. */
const USES: Record<HomeSectionKey, { title: boolean; subtitle: boolean; button: boolean }> = {
  announcement: { title: false, subtitle: false, button: false },
  hero: { title: true, subtitle: true, button: true },
  benefits: { title: false, subtitle: false, button: false },
  categories: { title: true, subtitle: true, button: false },
  featured: { title: true, subtitle: true, button: false },
  promos: { title: false, subtitle: false, button: false },
  bundles: { title: true, subtitle: true, button: false },
  service: { title: true, subtitle: true, button: true },
  reviews: { title: true, subtitle: true, button: false },
  about: { title: true, subtitle: true, button: true },
}

const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

/** Shrink + upload one picture to the banners bucket; returns its path. */
async function uploadHomeImage(folder: string, file: File, maxSide: number): Promise<string> {
  const img = await prepareImage(file, maxSide, 0.86)
  const path = `${folder}/${crypto.randomUUID().slice(0, 12)}.${img.ext}`
  const { error } = await supabase.storage.from(BANNERS_BUCKET).upload(path, img.blob, { contentType: img.blob.type, cacheControl: '31536000' })
  if (error) throw new Error(error.message)
  return path
}

async function sizeWarning(file: File, want: { width: number; height: number }): Promise<string | null> {
  const { width, height } = await imageSize(file)
  const r = width / height
  const wr = want.width / want.height
  if (Math.abs(r - wr) / wr > 0.1) return `مقاس الصورة ${width}×${height} يختلف عن المطلوب ${want.width}×${want.height}، فممكن يُقص جزء منها.`
  if (width < want.width * 0.7) return `الصورة صغيرة (${width}×${height}) وممكن تظهر غير واضحة.`
  return null
}

/** One picture spot: preview, choose, remove. */
function ImageSpot({
  label,
  size,
  path,
  folder,
  disabled,
  onChange,
}: {
  label: string
  size: { width: number; height: number }
  path: string | null | undefined
  folder: string
  disabled?: boolean
  onChange: (path: string | null) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [warn, setWarn] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="field">
      <label>{label}</label>
      <span className="muted">
        المقاس المطلوب: <b dir="ltr">{size.width} × {size.height}</b> بكسل. الصورة تتصغّر تلقائياً قبل الرفع.
      </span>
      <div className="spot" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
        {path ? <img src={homeUrl(path)} alt="" /> : <span className="muted">بدون صورة</span>}
      </div>
      <div className="row wrapr">
        <label className={`btn sm sec${disabled || busy ? ' disabled' : ''}`}>
          {busy ? 'جاري الرفع…' : path ? 'تغيير الصورة' : 'اختيار صورة'}
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={disabled || busy}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setBusy(true)
              setErr(null)
              try {
                setWarn(await sizeWarning(file, size))
                const p = await uploadHomeImage(folder, file, Math.max(size.width, size.height))
                const old = path
                await onChange(p)
                if (old) await supabase.storage.from(BANNERS_BUCKET).remove([old])
              } catch (x) {
                setErr(catalogError(x instanceof Error ? x.message : ''))
              } finally {
                setBusy(false)
              }
            }}
          />
        </label>
        {path && (
          <button
            type="button"
            className="btn sm ghost"
            disabled={disabled || busy}
            onClick={async () => {
              const old = path
              await onChange(null)
              await supabase.storage.from(BANNERS_BUCKET).remove([old])
            }}
          >
            حذف الصورة
          </button>
        )}
      </div>
      {warn && <span className="warn-text">{warn}</span>}
      {err && <span className="form-error">{err}</span>}
    </div>
  )
}

function BenefitsEditor({ items, onChange }: { items: BenefitItem[]; onChange: (items: BenefitItem[]) => void }) {
  const rows = [...items, ...Array.from({ length: Math.max(0, 4 - items.length) }, () => ({ icon: 'star' as const, title: '', text: '' }))].slice(0, 4)
  const set = (i: number, patch: Partial<BenefitItem>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="stack">
      {rows.map((r, i) => (
        <div key={i} className="benefit-row">
          <select className="input" aria-label={`أيقونة الميزة ${i + 1}`} value={r.icon} onChange={(e) => set(i, { icon: e.target.value as BenefitItem['icon'] })}>
            {BENEFIT_ICONS.map((ic) => (
              <option key={ic.key} value={ic.key}>
                {ic.label}
              </option>
            ))}
          </select>
          <input className="input" aria-label={`عنوان الميزة ${i + 1}`} placeholder="العنوان" maxLength={40} value={r.title} onChange={(e) => set(i, { title: e.target.value })} />
          <input className="input" aria-label={`وصف الميزة ${i + 1}`} placeholder="وصف قصير" maxLength={60} value={r.text} onChange={(e) => set(i, { text: e.target.value })} />
        </div>
      ))}
      <span className="muted">الميزة اللي عنوانها فاضي ما تظهر.</span>
    </div>
  )
}

function FeaturedEditor({ ids, products, onChange }: { ids: string[]; products: MiniProduct[]; onChange: (ids: string[]) => void }) {
  const [pick, setPick] = useState('')
  const byId = new Map(products.map((p) => [p.id, p]))
  const chosen = ids.filter((id) => byId.has(id))
  const move = (i: number, d: -1 | 1) => {
    const next = [...chosen]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    onChange(next)
  }
  return (
    <div className="stack">
      {chosen.length === 0 ? (
        <p className="muted">
          ما اخترت منتجات، فيُعرض تلقائياً كل منتج معلَّم «مميز» ({products.filter((p) => p.is_featured).length} منتجات). اختر هنا لو تبغى تحدد بنفسك
          وترتّب.
        </p>
      ) : (
        <ol className="pick-list">
          {chosen.map((id, i) => (
            <li key={id}>
              <span>{byId.get(id)!.name_ar}</span>
              <span className="row">
                <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="تقديم">
                  ↑
                </button>
                <button type="button" className="btn sm ghost" disabled={i === chosen.length - 1} onClick={() => move(i, 1)} aria-label="تأخير">
                  ↓
                </button>
                <button type="button" className="btn sm ghost" onClick={() => onChange(chosen.filter((x) => x !== id))}>
                  إزالة
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {chosen.length < 8 && (
        <div className="row wrapr">
          <select className="input grow" aria-label="إضافة منتج" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">اختر منتجاً لإضافته…</option>
            {products
              .filter((p) => !chosen.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name_ar} ({p.sku})
                </option>
              ))}
          </select>
          <button
            type="button"
            className="btn sm sec"
            disabled={!pick}
            onClick={() => {
              onChange([...chosen, pick])
              setPick('')
            }}
          >
            إضافة
          </button>
        </div>
      )}
      <span className="muted">حد أقصى 8 منتجات.</span>
    </div>
  )
}

function CategoryImages({ categories, canEdit, onSaved }: { categories: Category[]; canEdit: boolean; onSaved: () => void }) {
  const top = categories.filter((c) => !c.parent_id)
  return (
    <div className="cat-grid">
      {top.map((c) => (
        <div key={c.id} className="card stack">
          <b>
            {c.name_ar} {!c.is_visible && <span className="badge b-gray">مخفي</span>}
          </b>
          <ImageSpot
            label="صورة التصنيف"
            size={HOME_IMAGE_SIZES.category}
            path={c.image_path}
            folder={`categories/${c.id}`}
            disabled={!canEdit}
            onChange={async (p) => {
              const { error } = await supabase.from('categories').update({ image_path: p }).eq('id', c.id)
              if (error) throw new Error(error.message)
              onSaved()
            }}
          />
        </div>
      ))}
    </div>
  )
}

function SectionEditor({
  section,
  products,
  categories,
  canEdit,
  onSaved,
}: {
  section: HomeSection
  products: MiniProduct[]
  categories: Category[]
  canEdit: boolean
  onSaved: () => void
}) {
  const [title, setTitle] = useState(section.title_ar)
  const [subtitle, setSubtitle] = useState(section.subtitle_ar)
  const [audience, setAudience] = useState<Audience>(section.audience)
  const [config, setConfig] = useState<HomeSectionConfig>(section.config ?? {})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const uses = USES[section.key]
  const info = HOME_SECTION_INFO[section.key]
  const cfg = (patch: Partial<HomeSectionConfig>) => setConfig((c) => ({ ...c, ...patch }))

  async function save(patch?: Partial<HomeSection>) {
    if (config.link && !/^(https:\/\/|\/)/.test(config.link)) return setMsg({ ok: false, text: 'الرابط يبدأ بـ / (صفحة في المتجر) أو https://' })
    if (config.starts_at && config.ends_at && config.ends_at <= config.starts_at) return setMsg({ ok: false, text: 'تاريخ النهاية لازم يكون بعد البداية.' })
    setBusy(true)
    setMsg(null)
    const { error } = await supabase
      .from('home_sections')
      .update({ title_ar: title, subtitle_ar: subtitle, audience, config, ...patch })
      .eq('id', section.id)
    setBusy(false)
    if (error) return setMsg({ ok: false, text: catalogError(error.message) })
    setMsg({ ok: true, text: 'تم الحفظ ✓ يظهر في المتجر الآن.' })
    onSaved()
  }

  return (
    <section className="card stack">
      <div className="row between wrapr">
        <h2 className="h3">{info.label}</h2>
        <span className={`badge ${section.is_visible ? 'b-ok' : 'b-gray'}`}>{section.is_visible ? 'ظاهر' : 'مخفي'}</span>
      </div>
      <p className="muted">{info.hint}</p>

      {section.key === 'hero' && (
        <div className="card inset">
          <Banners placement="hero" embedded />
        </div>
      )}
      {section.key === 'promos' && (
        <div className="card inset">
          <Banners placement="mid" embedded />
        </div>
      )}

      <fieldset className="plain stack" disabled={!canEdit || busy}>
        {section.key === 'hero' && <b className="sub-h">الترحيب (يظهر لما ما فيه بنرات مفعّلة)</b>}
        {(uses.title || uses.subtitle) && (
          <div className="grid-form">
            {uses.title && (
              <div className="field">
                <label htmlFor="s-title">العنوان</label>
                <input id="s-title" className="input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
                <span className="muted">لو تركته فاضي، ما يظهر عنوان للقسم.</span>
              </div>
            )}
            {uses.subtitle && (
              <div className="field">
                <label htmlFor="s-sub">النص</label>
                <textarea id="s-sub" className="input textarea" rows={3} maxLength={400} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
              </div>
            )}
          </div>
        )}

        {section.key === 'announcement' && (
          <div className="grid-form">
            <div className="field">
              <label htmlFor="a-text">نص الإعلان</label>
              <input id="a-text" className="input" maxLength={140} value={config.text ?? ''} onChange={(e) => cfg({ text: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="a-from">يبدأ (اختياري)</label>
              <input id="a-from" type="datetime-local" className="input" value={toLocalInput(config.starts_at)} onChange={(e) => cfg({ starts_at: fromLocalInput(e.target.value) })} />
            </div>
            <div className="field">
              <label htmlFor="a-to">ينتهي (اختياري)</label>
              <input id="a-to" type="datetime-local" className="input" value={toLocalInput(config.ends_at)} onChange={(e) => cfg({ ends_at: fromLocalInput(e.target.value) })} />
            </div>
          </div>
        )}

        {(uses.button || section.key === 'announcement') && (
          <div className="grid-form">
            {uses.button && (
              <div className="field">
                <label htmlFor="s-btn">نص الزر</label>
                <input id="s-btn" className="input" maxLength={30} value={config.button ?? ''} onChange={(e) => cfg({ button: e.target.value })} />
              </div>
            )}
            <div className="field">
              <label htmlFor="s-link">الرابط {section.key === 'announcement' && '(اختياري)'}</label>
              <input id="s-link" className="input" dir="ltr" placeholder="/products" value={config.link ?? ''} onChange={(e) => cfg({ link: e.target.value.trim() })} />
              <span className="muted">صفحة في المتجر مثل /products أو /pages/about، أو رابط يبدأ بـ https://</span>
            </div>
          </div>
        )}

        {section.key === 'benefits' && <BenefitsEditor items={config.items ?? []} onChange={(items) => cfg({ items })} />}
        {section.key === 'featured' && <FeaturedEditor ids={config.product_ids ?? []} products={products} onChange={(product_ids) => cfg({ product_ids })} />}
        {section.key === 'reviews' && (
          <p className="muted">
            يعرض التقييمات المقبولة اللي عليها نجمة «مميز».{' '}
            <Link to="/catalog/reviews" className="link">
              إدارة التقييمات ←
            </Link>
          </p>
        )}

        <div className="field">
          <label htmlFor="s-aud">يظهر لمين؟</label>
          <select id="s-aud" className="input" value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
            {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((a) => (
              <option key={a} value={a}>
                {AUDIENCE_LABELS[a]}
              </option>
            ))}
          </select>
          <span className="muted">حسب الموقع اللي يختاره العميل في المتجر.</span>
        </div>
      </fieldset>

      {(section.key === 'service' || section.key === 'about') && (
        <ImageSpot
          label={HOME_IMAGE_SIZES[section.key].label}
          size={HOME_IMAGE_SIZES[section.key]}
          path={config.image_path}
          folder={`sections/${section.key}`}
          disabled={!canEdit}
          onChange={async (p) => {
            const next = { ...config, image_path: p }
            setConfig(next)
            const { error } = await supabase.from('home_sections').update({ config: next }).eq('id', section.id)
            if (error) throw new Error(error.message)
            onSaved()
          }}
        />
      )}

      {section.key === 'categories' && <CategoryImages categories={categories} canEdit={canEdit} onSaved={onSaved} />}

      {msg && <p className={msg.ok ? 'ok-text' : 'form-error'}>{msg.text}</p>}
      {canEdit && (
        <button className="btn self-start" disabled={busy} onClick={() => save()}>
          {busy ? 'جاري الحفظ…' : 'حفظ القسم'}
        </button>
      )}
    </section>
  )
}

export function HomeBuilder() {
  const { can } = useStaffAuth()
  const canEdit = can('catalog', 'edit')
  const [sections, setSections] = useState<HomeSection[] | null>(null)
  const [products, setProducts] = useState<MiniProduct[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewKey, setPreviewKey] = useState(0)
  const [device, setDevice] = useState<'mobile' | 'desktop'>('mobile')

  const load = useCallback(async () => {
    const [s, p, c] = await Promise.all([
      supabase.from('home_sections').select('*').order('sort_order'),
      supabase.from('products').select('id, name_ar, sku, is_featured, type').eq('status', 'published').order('name_ar'),
      fetchCategories(),
    ])
    if (s.error) throw new Error(s.error.message)
    setSections(s.data as HomeSection[])
    setProducts((p.data ?? []) as MiniProduct[])
    setCategories(c)
    setPreviewKey((k) => k + 1)
  }, [])

  useEffect(() => {
    load().catch(() => setError('تعذّر تحميل أقسام الرئيسية.'))
  }, [load])

  const current = useMemo(() => sections?.find((s) => s.id === selected) ?? null, [sections, selected])

  async function patch(s: HomeSection, values: Partial<HomeSection>) {
    setError(null)
    const { error: e } = await supabase.from('home_sections').update(values).eq('id', s.id)
    if (e) setError(catalogError(e.message))
    await load()
  }

  async function move(i: number, dir: -1 | 1) {
    const list = sections ?? []
    const a = list[i]
    const b = list[i + dir]
    if (!a || !b) return
    setError(null)
    const [r1, r2] = await Promise.all([
      supabase.from('home_sections').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('home_sections').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
    if (r1.error || r2.error) setError(catalogError((r1.error ?? r2.error)!.message))
    await load()
  }

  return (
    <RequirePage page="catalog">
      <div className="ph">
        <div>
          <h1>الصفحة الرئيسية</h1>
          <p>رتّب أقسام رئيسية المتجر، وأظهرها أو أخفها، وعدّل صورها ونصوصها. التعديل يظهر للعملاء فوراً، وكل تغيير يُسجَّل في سجل التدقيق.</p>
        </div>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!sections ? (
        !error && <p className="muted">جاري التحميل…</p>
      ) : (
        <div className="builder">
          <nav className="card builder-list" aria-label="أقسام الرئيسية">
            <b className="sub-h">الأقسام بالترتيب</b>
            <ol>
              {sections.map((s, i) => (
                <li key={s.id} className={s.id === selected ? 'on' : undefined}>
                  <button type="button" className="builder-name" aria-current={s.id === selected ? 'true' : undefined} onClick={() => setSelected(s.id)}>
                    <span className={s.is_visible ? undefined : 'off'}>{HOME_SECTION_INFO[s.key].label}</span>
                    {s.audience !== 'all' && <small className="muted">{AUDIENCE_LABELS[s.audience]}</small>}
                  </button>
                  {canEdit && (
                    <span className="builder-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={s.is_visible ? `إخفاء ${HOME_SECTION_INFO[s.key].label}` : `إظهار ${HOME_SECTION_INFO[s.key].label}`}
                        title={s.is_visible ? 'إخفاء' : 'إظهار'}
                        onClick={() => patch(s, { is_visible: !s.is_visible })}
                      >
                        {s.is_visible ? '👁' : '🚫'}
                      </button>
                      <button type="button" className="icon-btn" disabled={i === 0} aria-label="تقديم" onClick={() => move(i, -1)}>
                        ↑
                      </button>
                      <button type="button" className="icon-btn" disabled={i === sections.length - 1} aria-label="تأخير" onClick={() => move(i, 1)}>
                        ↓
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </nav>

          <div className="builder-edit">
            {current ? (
              <SectionEditor key={current.id} section={current} products={products} categories={categories} canEdit={canEdit} onSaved={() => load()} />
            ) : (
              <div className="notice">
                <b>اختر قسماً من القائمة لتعديله.</b>
                <span className="muted">👁 يظهر أو يخفي القسم، والأسهم تغيّر ترتيبه.</span>
              </div>
            )}
          </div>

          <aside className="card builder-preview" aria-label="معاينة">
            <div className="row between">
              <b className="sub-h">معاينة المتجر</b>
              <div className="chips">
                <button type="button" className={device === 'mobile' ? 'on' : ''} onClick={() => setDevice('mobile')}>
                  جوال
                </button>
                <button type="button" className={device === 'desktop' ? 'on' : ''} onClick={() => setDevice('desktop')}>
                  لابتوب
                </button>
              </div>
            </div>
            <div className={`preview-frame ${device}`}>
              <iframe key={previewKey} src={STORE_URL} title="معاينة رئيسية المتجر" loading="lazy" />
            </div>
            <div className="row between">
              <button type="button" className="linkbtn" onClick={() => setPreviewKey((k) => k + 1)}>
                تحديث المعاينة
              </button>
              <a className="link" href={STORE_URL} target="_blank" rel="noreferrer">
                فتح المتجر ↗
              </a>
            </div>
          </aside>
        </div>
      )}
    </RequirePage>
  )
}
