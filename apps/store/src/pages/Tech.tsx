import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { serviceErrorMessage, type TechJob } from '@ghaith/shared'
import { supabase } from '../lib/supabase'

/** Phone photos are big: shrink to ≤1600px JPEG before upload. */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('invalid_photo'))), 'image/jpeg', 0.8))
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' })

interface Line {
  product_id: string
  qty: number
}

/** /t/:token — the technician's page (no account, no prices). */
export function TechPage() {
  const { token = '' } = useParams()
  const [job, setJob] = useState<TechJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [absent, setAbsent] = useState(false)
  const [finding, setFinding] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [pick, setPick] = useState('')
  const [photos, setPhotos] = useState<{ path: string; url: string }[]>([])
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('tech_job', { p_token: token })
    if (e) return setError(serviceErrorMessage(e.message))
    setJob(data as TechJob)
  }, [token])

  useEffect(() => {
    document.title = 'زيارة الفني | غيث'
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    load()
    return () => meta.remove()
  }, [load])

  async function arrive() {
    setBusy(true)
    const { error: e } = await supabase.rpc('tech_arrive', { p_token: token })
    setBusy(false)
    if (e) return setError(serviceErrorMessage(e.message))
    load()
  }

  async function addPhoto(file: File | undefined) {
    if (!file || !job || photos.length >= 4) return
    setUploading(true)
    setError(null)
    try {
      const blob = await shrink(file)
      const path = `${job.folder}/${crypto.randomUUID()}.jpg`
      const { error: e } = await supabase.storage.from('work-order-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (e) throw new Error('invalid_photo')
      setPhotos((p) => [...p, { path, url: URL.createObjectURL(blob) }])
    } catch {
      setError('تعذّر رفع الصورة. حاول مرة ثانية.')
    } finally {
      setUploading(false)
    }
  }

  function addPart() {
    if (!pick) return
    setLines((l) => (l.some((x) => x.product_id === pick) ? l.map((x) => (x.product_id === pick ? { ...x, qty: Math.min(x.qty + 1, 50) } : x)) : [...l, { product_id: pick, qty: 1 }]))
    setPick('')
  }

  async function submit() {
    if (!absent && !finding.trim()) return setError('اكتب نتيجة الفحص.')
    const msg = absent ? 'تأكيد: العميل غير موجود؟ بعد الإرسال ما يتعدل.' : 'إرسال التقرير؟ بعد الإرسال ما يتعدل.'
    if (!window.confirm(msg)) return
    setBusy(true)
    setError(null)
    const { error: e } = await supabase.rpc('tech_submit', {
      p_token: token,
      p_absent: absent,
      p_finding: absent ? null : finding.trim(),
      p_note: note.trim() || null,
      p_parts: absent ? [] : lines,
      p_photos: photos.map((p) => p.path),
    })
    setBusy(false)
    if (e) return setError(serviceErrorMessage(e.message))
    load()
  }

  if (error && !job) {
    return (
      <main className="wrap tech">
        <div className="notice bad" role="alert">
          <b>{error}</b>
        </div>
      </main>
    )
  }
  if (!job) return <main className="wrap tech"><p className="muted">جاري التحميل…</p></main>

  const name = (id: string) => job.catalog?.find((c) => c.id === id)?.name ?? ''
  const map = job.lat !== null && job.lng !== null ? `https://www.google.com/maps?q=${job.lat},${job.lng}` : null
  const locked = job.status !== 'visit'

  return (
    <main className="wrap tech stack">
      <header className="stack-sm">
        <span className="muted">تنقية غيث · زيارة فني</span>
        <h1 className="page-h">
          {job.kind === 'emergency' ? 'بلاغ عطل' : 'صيانة دورية'} <span dir="ltr">{job.number}</span>
        </h1>
        {job.scheduled_at && <span>الموعد: {when(job.scheduled_at)}</span>}
      </header>

      <section className="card stack-sm">
        <b>العميل</b>
        <span>{job.contact_name}</span>
        <div className="row wrapr">
          <a className="btn sm" href={`tel:${job.contact_phone}`} dir="ltr">
            اتصال {job.contact_phone.replace(/^\+966/, '0')}
          </a>
          {map && (
            <a className="btn sm ghost" href={map} target="_blank" rel="noreferrer">
              الموقع في الخريطة
            </a>
          )}
        </div>
        <span className="muted">{[job.neighborhood, job.street].filter(Boolean).join('، ') || '—'}</span>
      </section>

      <section className="card stack-sm">
        <b>الطلب</b>
        {job.fault_type && <span>العطل: {job.fault_type}</span>}
        {job.description && <span className="muted">{job.description}</span>}
        {job.device ? (
          <>
            <span>
              الجهاز: {job.device.name}
              {job.device.model ? ` (${job.device.model})` : ''} · {job.device.ours ? 'جهاز غيث' : 'جهاز شركة أخرى'}
            </span>
            {job.device.filters.length > 0 && (
              <ul className="muted">
                {job.device.filters.map((f) => (
                  <li key={f.name}>
                    {f.name}: آخر تغيير {f.last_changed_on}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <span className="muted">الجهاز غير معروف</span>
        )}
      </section>

      {locked ? (
        <section className="notice ok stack-sm">
          <b>{job.customer_absent ? 'انرسل: العميل غير موجود.' : 'انرسل التقرير. شكراً لك.'}</b>
          {job.finding && <span>{job.finding}</span>}
          {job.parts.length > 0 && <span>القطع: {job.parts.map((p) => `${p.name} × ${p.qty}`).join('، ')}</span>}
          <span className="muted">التقرير مقفل. لو فيه تعديل كلّم الموظف.</span>
        </section>
      ) : !job.arrived_at ? (
        <button className="btn big" disabled={busy} onClick={arrive}>
          وصلت عند العميل
        </button>
      ) : (
        <section className="card stack">
          <b>تقرير الفحص</b>
          <div className="seg">
            <button type="button" className={!absent ? 'on' : undefined} onClick={() => setAbsent(false)}>
              فحصت الجهاز
            </button>
            <button type="button" className={absent ? 'on' : undefined} onClick={() => setAbsent(true)}>
              العميل غير موجود
            </button>
          </div>
          {!absent && (
            <>
              <div className="field">
                <label htmlFor="finding">نتيجة الفحص</label>
                <textarea id="finding" className="input" rows={3} maxLength={1000} value={finding} onChange={(e) => setFinding(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="part">القطع أو الفلاتر المطلوبة</label>
                <div className="row">
                  <select id="part" className="input grow" value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">اختر…</option>
                    {(job.catalog ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn sm" disabled={!pick} onClick={addPart}>
                    إضافة
                  </button>
                </div>
                {lines.length > 0 && (
                  <ul className="stack-sm tech-parts">
                    {lines.map((l) => (
                      <li key={l.product_id} className="row between">
                        <span>{name(l.product_id)}</span>
                        <span className="row">
                          <button type="button" className="btn sm ghost" aria-label="أقل" onClick={() => setLines((x) => x.flatMap((y) => (y.product_id !== l.product_id ? [y] : y.qty > 1 ? [{ ...y, qty: y.qty - 1 }] : [])))}>
                            −
                          </button>
                          <b>{l.qty}</b>
                          <button type="button" className="btn sm ghost" aria-label="أكثر" onClick={() => setLines((x) => x.map((y) => (y.product_id === l.product_id ? { ...y, qty: Math.min(y.qty + 1, 50) } : y)))}>
                            +
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="tnote">{absent ? 'ملاحظة (مثلاً: الباب مقفل، اتصلت وما رد)' : 'ملاحظة (اختياري)'}</label>
            <input id="tnote" className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="field">
            <span>صور ({photos.length}/4)</span>
            {photos.length > 0 && (
              <div className="tech-photos">
                {photos.map((p, i) => (
                  <div key={p.path}>
                    <img src={p.url} alt={`صورة ${i + 1}`} />
                    <button type="button" aria-label={`حذف الصورة ${i + 1}`} onClick={() => setPhotos((l) => l.filter((x) => x.path !== p.path))}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {photos.length < 4 && (
              <label className="btn sm ghost self-start">
                {uploading ? 'جاري الرفع…' : absent ? '+ صورة للمكان' : '+ صورة'}
                <input type="file" accept="image/*" capture="environment" hidden disabled={uploading} onChange={(e) => { addPhoto(e.target.files?.[0]); e.target.value = '' }} />
              </label>
            )}
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn big" disabled={busy || uploading} onClick={submit}>
            {absent ? 'إرسال: العميل غير موجود' : 'إرسال التقرير'}
          </button>
        </section>
      )}
    </main>
  )
}
