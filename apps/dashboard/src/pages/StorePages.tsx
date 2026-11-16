import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { STORE_PAGES, isStorePageSlug, parsePageBody, type StorePage } from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

const errText = (m: string) =>
  m.includes('row-level security') || m.includes('permission denied')
    ? 'لا تملك صلاحية تعديل صفحات المتجر.'
    : m.includes('empty_page')
      ? 'لا يمكن نشر صفحة فاضية. اكتب المحتوى أولاً (20 حرفاً على الأقل).'
      : m.includes('invalid_title')
        ? 'العنوان بين حرفين و80 حرفاً.'
        : 'تعذّر الحفظ. حاول مرة أخرى.'

const when = (iso: string) =>
  new Date(iso).toLocaleString('ar-SA-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })

/** Same rendering as the store, so the preview is what customers see. */
export function PageBody({ body }: { body: string }) {
  const blocks = parsePageBody(body)
  if (!blocks.length) return <p className="muted">لا يوجد محتوى بعد.</p>
  return (
    <div className="page-body">
      {blocks.map((b, i) =>
        b.kind === 'h' ? (
          <h3 key={i}>{b.text}</h3>
        ) : b.kind === 'ul' ? (
          <ul key={i}>
            {b.items.map((t, j) => (
              <li key={j}>{t}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.text}</p>
        ),
      )}
    </div>
  )
}

function Editor({ page, canEdit, onSaved }: { page: StorePage; canEdit: boolean; onSaved: () => void }) {
  const [title, setTitle] = useState(page.title_ar)
  const [body, setBody] = useState(page.body)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const dirty = title !== page.title_ar || body !== page.body
  const hint = STORE_PAGES.find((p) => p.slug === page.slug)?.hint

  async function save(publish: boolean) {
    setBusy(true)
    setMsg(null)
    const { error } = await supabase
      .from('store_pages')
      .update({ title_ar: title, body, is_published: publish })
      .eq('id', page.id)
    setBusy(false)
    if (error) return setMsg({ ok: false, text: errText(error.message) })
    setMsg({
      ok: true,
      text: publish ? 'تم الحفظ والنشر ✓ الصفحة ظاهرة في المتجر الآن.' : page.is_published ? 'تم الحفظ ✓ الصفحة مخفية الآن عن العملاء.' : 'تم حفظ المسودة ✓',
    })
    onSaved()
  }

  return (
    <section className="card stack">
      <div className="row between wrapr">
        <h2 className="h3">{page.title_ar}</h2>
        <span className={`badge ${page.is_published ? 'b-ok' : 'b-gray'}`}>{page.is_published ? 'منشورة' : 'مسودة — تظهر «قريباً»'}</span>
      </div>
      {hint && <p className="muted">اقتراح للمحتوى: {hint}</p>}

      <fieldset className="plain stack" disabled={!canEdit || busy}>
        <div className="field">
          <label htmlFor="pg-title">عنوان الصفحة</label>
          <input id="pg-title" className="input" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="chips" role="tablist" aria-label="طريقة العرض">
          <button type="button" role="tab" aria-selected={tab === 'write'} className={tab === 'write' ? 'on' : undefined} onClick={() => setTab('write')}>
            كتابة
          </button>
          <button type="button" role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? 'on' : undefined} onClick={() => setTab('preview')}>
            معاينة
          </button>
        </div>

        {tab === 'write' ? (
          <div className="field">
            <label htmlFor="pg-body">المحتوى</label>
            <textarea id="pg-body" className="input textarea page-text" rows={16} maxLength={50000} value={body} onChange={(e) => setBody(e.target.value)} />
            <span className="muted">
              سطر فاضي = فقرة جديدة · ابدأ السطر بـ <code>## </code> لعنوان فرعي · ابدأ بـ <code>- </code> لنقطة في قائمة
            </span>
          </div>
        ) : (
          <div className="page-preview">
            <h1>{title}</h1>
            <PageBody body={body} />
          </div>
        )}
      </fieldset>

      {msg && <p className={msg.ok ? 'ok-text' : 'form-error'}>{msg.text}</p>}

      {canEdit && (
        <div className="row wrapr">
          <button className="btn" disabled={busy} onClick={() => save(true)}>
            {page.is_published ? 'حفظ' : 'حفظ ونشر'}
          </button>
          {page.is_published ? (
            <button className="btn ghost" disabled={busy} onClick={() => save(false)}>
              إخفاء عن المتجر
            </button>
          ) : (
            <button className="btn ghost" disabled={busy || !dirty} onClick={() => save(false)}>
              حفظ كمسودة
            </button>
          )}
          {page.is_published && (
            <a className="link" href={`/pages/${page.slug}`} target="_blank" rel="noreferrer">
              فتح في المتجر ↗
            </a>
          )}
        </div>
      )}
      <p className="muted">
        آخر تعديل: {when(page.updated_at)}. كل تعديل يُسجَّل في سجل التدقيق باسم من عدّله.
      </p>
    </section>
  )
}

export function StorePages() {
  const { can } = useStaffAuth()
  const [params, setParams] = useSearchParams()
  const [pages, setPages] = useState<StorePage[] | null>(null)
  const [error, setError] = useState('')
  const sel = params.get('page')
  const selected = isStorePageSlug(sel ?? undefined) ? pages?.find((p) => p.slug === sel) : undefined

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('store_pages').select('*').order('sort_order')
    if (error) throw error
    setPages((data ?? []) as StorePage[])
  }, [])

  useEffect(() => {
    load().catch(() => setError('تعذّر تحميل الصفحات.'))
  }, [load])

  return (
    <RequirePage page="settings">
      <div className="ph">
        <div>
          <h1>صفحات المتجر</h1>
          <p>من نحن، والشحن، والاسترداد، والضمان، والخصوصية، والشروط. الصفحة اللي ما تنشرها تظهر للعملاء «قريباً».</p>
        </div>
        <Link to="/settings" className="btn ghost sm">
          رجوع للإعدادات
        </Link>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!pages ? (
        !error && <p className="muted">جاري التحميل…</p>
      ) : (
        <div className="pages-layout">
          <nav className="card pages-list" aria-label="الصفحات">
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                className={p.slug === selected?.slug ? 'on' : undefined}
                aria-current={p.slug === selected?.slug ? 'page' : undefined}
                onClick={() => setParams({ page: p.slug }, { replace: true })}
              >
                <span>{p.title_ar}</span>
                <span className={`badge ${p.is_published ? 'b-ok' : 'b-gray'}`}>{p.is_published ? 'منشورة' : 'مسودة'}</span>
              </button>
            ))}
          </nav>
          {selected ? (
            <Editor key={selected.id} page={selected} canEdit={can('settings', 'edit')} onSaved={() => load().catch(() => {})} />
          ) : (
            <div className="notice">
              <b>اختر صفحة من القائمة لتعديلها.</b>
              <span className="muted">اكتب المحتوى، شوف المعاينة، وبعدين انشرها.</span>
            </div>
          )}
        </div>
      )}
    </RequirePage>
  )
}
