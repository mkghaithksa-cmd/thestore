import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  BANNERS_BUCKET,
  BANNER_SIZES,
  MAX_ACTIVE_BANNERS,
  MAX_MID_BANNERS,
  type BannerLinkKind,
  type Category,
  type HomeBanner,
  type Product,
} from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { catalogError, fetchCategories, imageUrl } from '../lib/catalog'
import { imageSize, prepareImage } from '../lib/image'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

type Slot = 'desktop' | 'mobile'
type Picked = { file: File; preview: string; warning: string | null }
export type Placement = 'hero' | 'mid'
type Sizes = Record<Slot, { width: number; height: number; ratio: number; label: string }>

/** Slider banners are wide; the two mid-page banners are 2:1. */
const SIZES: Record<Placement, Sizes> = {
  hero: BANNER_SIZES,
  mid: {
    desktop: { width: 1200, height: 600, ratio: 2, label: 'لابتوب' },
    mobile: { width: 1080, height: 540, ratio: 2, label: 'جوال' },
  },
}
const MAX: Record<Placement, number> = { hero: MAX_ACTIVE_BANNERS, mid: MAX_MID_BANNERS }

const bannerUrl = (path: string) => imageUrl(path, BANNERS_BUCKET)

/** Warns when the picked image is far from the recommended ratio or too small. */
async function checkImage(file: File, slot: Slot, sizes: Sizes): Promise<string | null> {
  const want = sizes[slot]
  const { width, height } = await imageSize(file)
  const ratio = width / height
  if (Math.abs(ratio - want.ratio) / want.ratio > 0.08) {
    return `مقاس الصورة ${width}×${height} لا يطابق نسبة ${want.label} (${want.width}×${want.height}). قد يُقص جزء منها.`
  }
  if (width < want.width * 0.75) return `الصورة صغيرة (${width}×${height})، قد تظهر غير واضحة. المطلوب ${want.width}×${want.height}.`
  return null
}

/** ISO time → value for <input type=datetime-local> in the browser's time zone. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

function ImagePick({
  slot,
  picked,
  current,
  onPick,
  required,
  sizes,
}: {
  sizes: Sizes
  slot: Slot
  picked: Picked | null
  current: string | null
  onPick: (p: Picked | null) => void
  required?: boolean
}) {
  const size = sizes[slot]
  const src = picked?.preview ?? (current ? bannerUrl(current) : null)
  return (
    <div className="field">
      <label>
        صورة {size.label} {required ? '*' : '(اختيارية)'}
      </label>
      <span className="muted">
        المقاس المطلوب: <b dir="ltr">{size.width} × {size.height}</b> بكسل
        {slot === 'mobile' && ' — بدونها نعرض صورة اللابتوب على الجوال.'}
      </span>
      <div className={`banner-pick ${slot}`}>
        {src ? <img src={src} alt="" /> : <span className="muted">لا توجد صورة</span>}
        <div className="safe-area" aria-hidden="true" />
      </div>
      <div className="row">
        <label className="btn sm sec">
          {src ? 'تغيير الصورة' : 'اختيار صورة'}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              onPick({ file, preview: URL.createObjectURL(file), warning: await checkImage(file, slot, sizes) })
            }}
          />
        </label>
        {picked && (
          <button type="button" className="btn sm ghost" onClick={() => onPick(null)}>
            تراجع
          </button>
        )}
      </div>
      {picked?.warning && <span className="warn-text">{picked.warning}</span>}
    </div>
  )
}

function BannerForm({
  banner,
  categories,
  products,
  nextOrder,
  onDone,
  placement,
}: {
  placement: Placement
  banner: HomeBanner | null
  nextOrder: number
  categories: Category[]
  products: Pick<Product, 'id' | 'name_ar' | 'sku'>[]
  onDone: () => void
}) {
  const [title, setTitle] = useState(banner?.title ?? '')
  const [linkKind, setLinkKind] = useState<BannerLinkKind>(banner?.link_kind ?? 'none')
  const [linkRef, setLinkRef] = useState(banner?.link_ref ?? '')
  const [startsAt, setStartsAt] = useState(toLocalInput(banner?.starts_at ?? null))
  const [endsAt, setEndsAt] = useState(toLocalInput(banner?.ends_at ?? null))
  const [desktop, setDesktop] = useState<Picked | null>(null)
  const [mobile, setMobile] = useState<Picked | null>(null)
  const [removeMobile, setRemoveMobile] = useState(false)
  const [preview, setPreview] = useState<Slot>('desktop')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const desktopSrc = desktop?.preview ?? (banner ? bannerUrl(banner.desktop_path) : null)
  const mobileSrc = removeMobile ? null : (mobile?.preview ?? (banner?.mobile_path ? bannerUrl(banner.mobile_path) : null))

  async function upload(id: string, slot: Slot, file: File): Promise<string> {
    const size = SIZES[placement][slot]
    const img = await prepareImage(file, Math.max(size.width, size.height), 0.88)
    const path = `${id}/${slot}-${crypto.randomUUID().slice(0, 8)}.${img.ext}`
    const { error: e } = await supabase.storage.from(BANNERS_BUCKET).upload(path, img.blob, {
      contentType: img.blob.type,
      cacheControl: '31536000',
    })
    if (e) throw new Error(e.message)
    return path
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError('أدخل عنواناً للبنر (يُقرأ لمن يستخدم قارئ الشاشة).')
    if (!banner && !desktop) return setError('صورة اللابتوب مطلوبة.')
    if (linkKind !== 'none' && !linkRef.trim()) return setError('اختر وجهة الرابط.')
    if (linkKind === 'url' && !/^(https:\/\/|\/)/.test(linkRef.trim())) return setError('الرابط يبدأ بـ https:// أو /')
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) return setError('تاريخ النهاية يجب أن يكون بعد البداية.')
    setBusy(true)
    setError(null)
    const id = banner?.id ?? crypto.randomUUID()
    const uploaded: string[] = []
    try {
      const desktopPath = desktop ? await upload(id, 'desktop', desktop.file) : banner!.desktop_path
      if (desktop) uploaded.push(desktopPath)
      let mobilePath = removeMobile ? null : (banner?.mobile_path ?? null)
      if (mobile) {
        mobilePath = await upload(id, 'mobile', mobile.file)
        uploaded.push(mobilePath)
      }
      const row = {
        title: title.trim(),
        desktop_path: desktopPath,
        mobile_path: mobilePath,
        link_kind: linkKind,
        link_ref: linkKind === 'none' ? null : linkRef.trim(),
        starts_at: fromLocalInput(startsAt),
        ends_at: fromLocalInput(endsAt),
      }
      const res = banner
        ? await supabase.from('home_banners').update(row).eq('id', id)
        : await supabase.from('home_banners').insert({ id, ...row, placement, sort_order: nextOrder })
      if (res.error) throw new Error(res.error.message)
      // Remove replaced files.
      const old = [desktop && banner?.desktop_path, (mobile || removeMobile) && banner?.mobile_path].filter(Boolean) as string[]
      if (old.length) await supabase.storage.from(BANNERS_BUCKET).remove(old)
      onDone()
    } catch (err) {
      if (uploaded.length) await supabase.storage.from(BANNERS_BUCKET).remove(uploaded)
      const msg = err instanceof Error ? err.message : ''
      setError(msg.includes('too_many_banners') ? `الحد الأقصى ${MAX[placement]} بنرات مفعّلة هنا. أوقف بنراً أولاً.` : catalogError(msg))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit}>
      <h2 className="h3">{banner ? 'تعديل البنر' : 'بنر جديد'}</h2>
      <fieldset className="stack plain" disabled={busy}>
        <div className="field">
          <label htmlFor="bt">العنوان *</label>
          <input id="bt" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: عرض الصيف على الأجهزة" />
          <span className="muted">لا يظهر فوق الصورة، لكن يقرؤه قارئ الشاشة ومحركات البحث.</span>
        </div>

        <div className="notice">
          <b>نصيحة للتصميم</b>
          <span className="muted">
            خلّ الكلام والشعار في منتصف الصورة (المنطقة المحددة بالخط المتقطع)، لأن الأطراف ممكن تنقص قليلاً على بعض الشاشات.
          </span>
        </div>

        <div className="grid-form">
          <ImagePick sizes={SIZES[placement]} slot="desktop" picked={desktop} current={banner?.desktop_path ?? null} onPick={setDesktop} required />
          <div className="stack">
            <ImagePick
              sizes={SIZES[placement]}
              slot="mobile"
              picked={mobile}
              current={removeMobile ? null : (banner?.mobile_path ?? null)}
              onPick={(p) => {
                setMobile(p)
                if (p) setRemoveMobile(false)
              }}
            />
            {banner?.mobile_path && !removeMobile && !mobile && (
              <button type="button" className="btn sm ghost self-start" onClick={() => setRemoveMobile(true)}>
                حذف صورة الجوال
              </button>
            )}
          </div>
        </div>

        <div className="stack">
          <div className="row wrapr">
            <b>معاينة:</b>
            <div className="chips">
              <button type="button" className={preview === 'desktop' ? 'on' : ''} onClick={() => setPreview('desktop')}>
                لابتوب
              </button>
              <button type="button" className={preview === 'mobile' ? 'on' : ''} onClick={() => setPreview('mobile')}>
                جوال
              </button>
            </div>
          </div>
          <div className={`banner-preview ${preview}`}>
            <div className="frame">
              {preview === 'mobile' && mobileSrc ? (
                <img src={mobileSrc} alt="" className="fill" />
              ) : desktopSrc ? (
                <img src={desktopSrc} alt="" className={preview === 'mobile' ? 'contain' : 'fill'} />
              ) : (
                <span className="muted">اختر صورة اللابتوب</span>
              )}
            </div>
          </div>
        </div>

        <div className="grid-form">
          <div className="field">
            <label htmlFor="lk">عند الضغط على البنر</label>
            <select
              id="lk"
              className="input"
              value={linkKind}
              onChange={(e) => {
                setLinkKind(e.target.value as BannerLinkKind)
                setLinkRef('')
              }}
            >
              <option value="none">لا شيء</option>
              <option value="category">يفتح تصنيف</option>
              <option value="product">يفتح منتج</option>
              <option value="url">رابط</option>
            </select>
          </div>
          {linkKind === 'category' && (
            <div className="field">
              <label htmlFor="lr">التصنيف</label>
              <select id="lr" className="input" value={linkRef} onChange={(e) => setLinkRef(e.target.value)}>
                <option value="">اختر…</option>
                {categories.filter((c) => c.is_visible || c.slug === linkRef).map((c) => (
                  <option key={c.id} value={c.slug}>
                    {c.name_ar}
                  </option>
                ))}
              </select>
            </div>
          )}
          {linkKind === 'product' && (
            <div className="field">
              <label htmlFor="lr">المنتج</label>
              <select id="lr" className="input" value={linkRef} onChange={(e) => setLinkRef(e.target.value)}>
                <option value="">اختر…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name_ar} ({p.sku})
                  </option>
                ))}
              </select>
            </div>
          )}
          {linkKind === 'url' && (
            <div className="field">
              <label htmlFor="lr">الرابط</label>
              <input id="lr" className="input" dir="ltr" value={linkRef} onChange={(e) => setLinkRef(e.target.value)} placeholder="https://… أو /products" />
            </div>
          )}
          <div className="field">
            <label htmlFor="sa">يبدأ (اختياري)</label>
            <input id="sa" type="datetime-local" className="input" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="ea">ينتهي (اختياري)</label>
            <input id="ea" type="datetime-local" className="input" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        </div>
      </fieldset>
      {error && <p className="form-error">{error}</p>}
      <div className="row">
        <button className="btn" disabled={busy}>
          {busy ? 'جاري الرفع…' : banner ? 'حفظ' : 'إضافة البنر'}
        </button>
        <button type="button" className="btn ghost" onClick={onDone} disabled={busy}>
          إلغاء
        </button>
      </div>
    </form>
  )
}

function bannerState(b: HomeBanner): { label: string; cls: string } {
  const now = Date.now()
  if (!b.is_active) return { label: 'موقوف', cls: 'b-gray' }
  if (b.starts_at && new Date(b.starts_at).getTime() > now) return { label: 'مجدول', cls: 'b-warn' }
  if (b.ends_at && new Date(b.ends_at).getTime() <= now) return { label: 'انتهى', cls: 'b-gray' }
  return { label: 'ظاهر الآن', cls: 'b-ok' }
}

/** Banner list + form for one placement. Embedded inside the home page builder. */
export function Banners({ placement = 'hero', embedded = false }: { placement?: Placement; embedded?: boolean }) {
  const { can } = useStaffAuth()
  const canAdd = can('catalog', 'add')
  const canEdit = can('catalog', 'edit')
  const [banners, setBanners] = useState<HomeBanner[] | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Pick<Product, 'id' | 'name_ar' | 'sku'>[]>([])
  const [editing, setEditing] = useState<HomeBanner | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [b, c, p] = await Promise.all([
      supabase.from('home_banners').select('*').eq('placement', placement).order('sort_order'),
      fetchCategories(),
      supabase.from('products').select('id, name_ar, sku').eq('status', 'published').order('name_ar'),
    ])
    if (b.error) throw new Error(b.error.message)
    setBanners(b.data as HomeBanner[])
    setCategories(c)
    setProducts((p.data ?? []) as Pick<Product, 'id' | 'name_ar' | 'sku'>[])
  }, [])

  useEffect(() => {
    load().catch(() => setError('تعذّر التحميل.'))
  }, [load])

  async function update(b: HomeBanner, patch: Partial<HomeBanner>) {
    setError(null)
    const { error: e } = await supabase.from('home_banners').update(patch).eq('id', b.id)
    if (e)
      setError(e.message.includes('too_many_banners') ? `الحد الأقصى ${MAX[placement]} بنرات مفعّلة هنا. أوقف بنراً أولاً.` : catalogError(e.message))
    else load()
  }

  async function move(i: number, dir: -1 | 1) {
    const list = banners ?? []
    const a = list[i]
    const b = list[i + dir]
    if (!a || !b) return
    await Promise.all([
      supabase.from('home_banners').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('home_banners').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
    load()
  }

  async function remove(b: HomeBanner) {
    if (!confirm(`حذف البنر «${b.title}»؟ لا يمكن التراجع.`)) return
    const { error: e } = await supabase.from('home_banners').delete().eq('id', b.id)
    if (e) return setError(catalogError(e.message))
    await supabase.storage.from(BANNERS_BUCKET).remove([b.desktop_path, b.mobile_path].filter(Boolean) as string[])
    load()
  }

  const activeCount = (banners ?? []).filter((b) => b.is_active).length

  const body = (
    <>
      <div className={embedded ? 'row between wrapr' : 'ph'}>
        <div>
          {embedded ? (
            <b>{placement === 'mid' ? 'بنرات وسط الصفحة' : 'بنرات السلايدر'}</b>
          ) : (
            <h1>بنرات الصفحة الرئيسية</h1>
          )}
          <p className={embedded ? 'muted' : undefined}>
            {placement === 'mid' ? 'بنران جنب بعض وسط الرئيسية.' : 'تظهر أعلى رئيسية المتجر وتتقلب تلقائياً.'} المفعّل الآن {activeCount} من {MAX[placement]}.
          </p>
        </div>
        {canAdd && !editing && (
          <button className="btn" onClick={() => setEditing('new')}>
            + بنر جديد
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}

      {editing && (
        <BannerForm
          key={editing === 'new' ? 'new' : editing.id}
          banner={editing === 'new' ? null : editing}
          placement={placement}
          categories={categories}
          products={products}
          nextOrder={Math.max(0, ...(banners ?? []).map((b) => b.sort_order)) + 1}
          onDone={() => {
            setEditing(null)
            load()
          }}
        />
      )}

      {!banners ? (
        <p className="muted">جاري التحميل…</p>
      ) : banners.length === 0 ? (
        <div className="notice">
          <b>لا توجد بنرات بعد.</b>
          <span className="muted">{placement === 'mid' ? 'بدونها يختفي هذا القسم من الرئيسية.' : 'بدون بنرات تعرض الرئيسية الترحيب الافتراضي.'}</span>
        </div>
      ) : (
        <div className="stack">
          {banners.map((b, i) => {
            const st = bannerState(b)
            return (
              <article key={b.id} className="card banner-row">
                <img src={bannerUrl(b.desktop_path)} alt="" className="banner-thumb" />
                {b.mobile_path ? (
                  <img src={bannerUrl(b.mobile_path)} alt="" className="banner-thumb m" />
                ) : (
                  <span className="banner-thumb m none">بدون صورة جوال</span>
                )}
                <div className="stack grow">
                  <b>{b.title}</b>
                  <div className="row wrapr">
                    <span className={`badge ${st.cls}`}>{st.label}</span>
                    {b.starts_at && <span className="muted">من {new Date(b.starts_at).toLocaleString('ar-SA')}</span>}
                    {b.ends_at && <span className="muted">إلى {new Date(b.ends_at).toLocaleString('ar-SA')}</span>}
                  </div>
                </div>
                {canEdit && (
                  <div className="row wrapr">
                    <button className="btn sm ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="تقديم">
                      ↑
                    </button>
                    <button className="btn sm ghost" disabled={i === banners.length - 1} onClick={() => move(i, 1)} aria-label="تأخير">
                      ↓
                    </button>
                    <button className="btn sm ghost" onClick={() => update(b, { is_active: !b.is_active })}>
                      {b.is_active ? 'إيقاف' : 'تفعيل'}
                    </button>
                    <button className="btn sm sec" onClick={() => setEditing(b)}>
                      تعديل
                    </button>
                    <button className="btn sm ghost" onClick={() => remove(b)}>
                      حذف
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </>
  )
  return embedded ? body : <RequirePage page="catalog">{body}</RequirePage>
}
