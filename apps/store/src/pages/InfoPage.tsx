import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BUSINESS, STORE_PAGES, isStorePageSlug, parsePageBody, telHref, type StorePage } from '@ghaith/shared'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

/** A published page, or null while the client has not written it yet. */
async function fetchPage(slug: string): Promise<StorePage | null> {
  const { data, error } = await supabase.from('store_pages').select('*').eq('slug', slug).maybeSingle()
  if (error) throw error
  return (data as StorePage | null) ?? null
}

function Body({ body }: { body: string }) {
  return (
    <div className="page-body">
      {parsePageBody(body).map((b, i) =>
        b.kind === 'h' ? (
          <h2 key={i}>{b.text}</h2>
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

export function InfoPage() {
  const { slug = '' } = useParams()
  const known = isStorePageSlug(slug)
  const fallback = STORE_PAGES.find((p) => p.slug === slug)
  const { state, reload } = useAsync(() => (known ? fetchPage(slug) : Promise.resolve(null)), [slug])
  const page = state.status === 'success' ? state.data : null
  const title = page?.title_ar ?? fallback?.title ?? 'الصفحة غير موجودة'

  useEffect(() => {
    document.title = `${title} | غيث لتنقية المياه`
    return () => {
      document.title = 'غيث لتنقية المياه'
    }
  }, [title])

  if (!known) {
    return (
      <div className="notice">
        <b>الصفحة غير موجودة.</b>
        <Link to="/" className="link">
          العودة للرئيسية
        </Link>
      </div>
    )
  }

  return (
    <article className="info-page">
      <h1 className="page-h">{title}</h1>
      {state.status === 'loading' && <div className="skeleton info-skel" aria-label="جاري التحميل" />}
      {state.status === 'error' && (
        <div className="notice bad">
          <b>تعذّر تحميل الصفحة.</b>
          <button className="linkbtn" onClick={reload}>
            حاول مرة أخرى
          </button>
        </div>
      )}
      {state.status === 'success' &&
        (page ? (
          <>
            <Body body={page.body} />
            <p className="muted">
              آخر تحديث: {new Date(page.updated_at).toLocaleDateString('ar-SA-u-nu-latn', { dateStyle: 'long' })}
            </p>
          </>
        ) : (
          <div className="notice">
            <b>قريباً</b>
            <span className="muted">نجهّز محتوى هذه الصفحة. لأي سؤال تواصل معنا:</span>
            <div className="row wrapr">
              {BUSINESS.phones.map((p) => (
                <a key={p} href={telHref(p)} dir="ltr" className="link">
                  {p}
                </a>
              ))}
            </div>
          </div>
        ))}
    </article>
  )
}
