import { useCallback, useEffect, useState } from 'react'
import { REVIEW_STATUS_LABELS, type Review, type ReviewStatus } from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { catalogError } from '../lib/catalog'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

type Row = Review & { product: { name_ar: string; sku: string } | null }
type Filter = ReviewStatus | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'pending', label: 'بانتظار المراجعة' },
  { key: 'approved', label: 'مقبولة' },
  { key: 'rejected', label: 'مرفوضة' },
  { key: 'all', label: 'الكل' },
]

const STATUS_CLS: Record<ReviewStatus, string> = { pending: 'b-warn', approved: 'b-ok', rejected: 'b-gray' }

function stars(n: number) {
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}

export function Reviews() {
  const { can } = useStaffAuth()
  const canApprove = can('catalog', 'approve')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [filter, setFilter] = useState<Filter>('pending')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('reviews')
      .select('*, product:products(name_ar, sku)')
      .order('created_at', { ascending: false })
      .limit(500)
    if (e) throw new Error(e.message)
    setRows((data ?? []) as Row[])
  }, [])

  useEffect(() => {
    load().catch(() => setError('تعذّر تحميل التقييمات.'))
  }, [load])

  // Open on the tab that has something to do.
  useEffect(() => {
    if (rows && filter === 'pending' && !rows.some((r) => r.status === 'pending')) setFilter('all')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows === null])

  async function update(r: Row, patch: Partial<Pick<Review, 'status' | 'is_featured'>>) {
    setBusy(r.id)
    setError(null)
    const { error: e } = await supabase.from('reviews').update(patch).eq('id', r.id)
    setBusy(null)
    if (e) return setError(catalogError(e.message))
    load()
  }

  async function remove(r: Row) {
    if (!confirm(`حذف تقييم «${r.author_name}» نهائياً؟ لا يمكن التراجع.`)) return
    setBusy(r.id)
    const { error: e } = await supabase.from('reviews').delete().eq('id', r.id)
    setBusy(null)
    if (e) return setError(catalogError(e.message))
    load()
  }

  const samples = (rows ?? []).filter((r) => r.is_sample)

  async function removeSamples() {
    if (!confirm(`حذف ${samples.length} تقييمات تجريبية نهائياً؟ التقييمات الحقيقية ما تتأثر.`)) return
    setBusy('samples')
    const { error: e } = await supabase.from('reviews').delete().eq('is_sample', true)
    setBusy(null)
    if (e) return setError(catalogError(e.message))
    load()
  }

  const shown = (rows ?? []).filter((r) => filter === 'all' || r.status === filter)
  const count = (f: Filter) => (rows ?? []).filter((r) => f === 'all' || r.status === f).length
  const featured = (rows ?? []).filter((r) => r.is_featured).length

  return (
    <RequirePage page="catalog">
      <div className="ph">
        <div>
          <h1>التقييمات</h1>
          <p>
            تقييمات العملاء على المنتجات. المقبول فقط يظهر في المتجر، والمميَّز بالنجمة يظهر في الرئيسية ({featured} مميزة). يقيّم فقط اللي اشترى
            المنتج.
          </p>
        </div>
        {canApprove && samples.length > 0 && (
          <button className="btn ghost" disabled={busy === 'samples'} onClick={removeSamples}>
            حذف التقييمات التجريبية ({samples.length})
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}

      <div className="chips" role="tablist" aria-label="تصفية">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={filter === f.key ? 'on' : undefined} onClick={() => setFilter(f.key)}>
            {f.label} ({count(f.key)})
          </button>
        ))}
      </div>

      {!rows ? (
        !error && <p className="muted">جاري التحميل…</p>
      ) : shown.length === 0 ? (
        <div className="notice">
          <b>لا توجد تقييمات هنا.</b>
          <span className="muted">التقييمات تجي من العملاء بعد استلام طلباتهم (يتفعّل نموذج التقييم في اليوم 7).</span>
        </div>
      ) : (
        <div className="stack">
          {shown.map((r) => (
            <article key={r.id} className="card review-row">
              <div className="stack grow">
                <div className="row wrapr">
                  <span className="review-stars" aria-label={`${r.rating} من 5`}>
                    {stars(r.rating)}
                  </span>
                  <span className={`badge ${STATUS_CLS[r.status]}`}>{REVIEW_STATUS_LABELS[r.status]}</span>
                  {r.is_featured && <span className="badge b-warn">⭐ مميز في الرئيسية</span>}
                  {r.is_sample && <span className="badge b-gray">تجريبي</span>}
                </div>
                {r.body && <p className="review-body">{r.body}</p>}
                <span className="muted">
                  {r.author_name}
                  {r.city ? ` · ${r.city}` : ''} · {r.product?.name_ar ?? 'منتج محذوف'} · {new Date(r.created_at).toLocaleDateString('ar-SA-u-nu-latn')}
                </span>
              </div>
              {canApprove && (
                <div className="row wrapr">
                  {r.status !== 'approved' && (
                    <button className="btn sm" disabled={busy === r.id} onClick={() => update(r, { status: 'approved' })}>
                      قبول
                    </button>
                  )}
                  {r.status !== 'rejected' && (
                    <button className="btn sm ghost" disabled={busy === r.id} onClick={() => update(r, { status: 'rejected' })}>
                      رفض
                    </button>
                  )}
                  {r.status === 'approved' && (
                    <button className="btn sm sec" disabled={busy === r.id} onClick={() => update(r, { is_featured: !r.is_featured })}>
                      {r.is_featured ? 'إلغاء التمييز' : '⭐ تمييز في الرئيسية'}
                    </button>
                  )}
                  <button className="btn sm ghost" disabled={busy === r.id} onClick={() => remove(r)}>
                    حذف
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </RequirePage>
  )
}
