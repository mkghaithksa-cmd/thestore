import { useState } from 'react'
import { MAX_PRODUCT_IMAGES, PRODUCT_IMAGES_BUCKET, type ProductImage } from '@ghaith/shared'
import { catalogError, imageUrl } from '../lib/catalog'
import { prepareImage } from '../lib/image'
import { supabase } from '../lib/supabase'

interface Props {
  productId: string
  images: ProductImage[]
  onChange: (images: ProductImage[]) => void
  canAdd: boolean
  canEdit: boolean
}

/** Up to 5 images; the first is the main one. Shrunk in the browser before upload. */
export function ProductImages({ productId, images, onChange, canAdd, canEdit }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sorted = [...images].sort((a, b) => a.sort_order - b.sort_order)
  const left = MAX_PRODUCT_IMAGES - sorted.length

  async function onPick(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    setBusy(true)
    const added: ProductImage[] = []
    try {
      let order = (sorted.at(-1)?.sort_order ?? -1) + 1
      for (const file of Array.from(files).slice(0, left)) {
        const img = await prepareImage(file)
        const path = `${productId}/${crypto.randomUUID()}.${img.ext}`
        const up = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).upload(path, img.blob, {
          contentType: img.blob.type,
          cacheControl: '31536000',
        })
        if (up.error) throw new Error(up.error.message)
        const { data, error: insErr } = await supabase
          .from('product_images')
          .insert({ product_id: productId, storage_path: path, sort_order: order++ })
          .select()
          .single()
        if (insErr) {
          await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([path])
          throw new Error(insErr.message)
        }
        added.push(data as ProductImage)
      }
      if (files.length > left) setError(`أُضيفت ${left} فقط. الحد الأقصى ${MAX_PRODUCT_IMAGES} صور.`)
    } catch (e) {
      setError(catalogError(e instanceof Error ? e.message : ''))
    } finally {
      onChange([...sorted, ...added])
      setBusy(false)
    }
  }

  async function remove(img: ProductImage) {
    if (!confirm('حذف هذه الصورة؟')) return
    setBusy(true)
    setError(null)
    const { error: delErr } = await supabase.from('product_images').delete().eq('id', img.id)
    if (delErr) setError(catalogError(delErr.message))
    else {
      await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove([img.storage_path])
      onChange(sorted.filter((i) => i.id !== img.id))
    }
    setBusy(false)
  }

  /** Swaps an image with its neighbour (-1 = earlier, +1 = later). */
  async function move(index: number, dir: -1 | 1) {
    const other = sorted[index + dir]
    const cur = sorted[index]
    if (!other) return
    setBusy(true)
    setError(null)
    const next = sorted.map((i) =>
      i.id === cur.id ? { ...i, sort_order: other.sort_order } : i.id === other.id ? { ...i, sort_order: cur.sort_order } : i,
    )
    const results = await Promise.all([
      supabase.from('product_images').update({ sort_order: other.sort_order }).eq('id', cur.id),
      supabase.from('product_images').update({ sort_order: cur.sort_order }).eq('id', other.id),
    ])
    const failed = results.find((r) => r.error)
    if (failed?.error) setError(catalogError(failed.error.message))
    else onChange(next)
    setBusy(false)
  }

  return (
    <div className="stack">
      <div className="img-grid">
        {sorted.map((img, i) => (
          <figure key={img.id} className="img-tile">
            <img src={imageUrl(img.storage_path)} alt="" />
            {i === 0 && <span className="badge b-ok img-main">الرئيسية</span>}
            {canEdit && (
              <div className="img-actions">
                <button type="button" className="btn sm ghost" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label="تقديم">
                  →
                </button>
                <button
                  type="button"
                  className="btn sm ghost"
                  disabled={busy || i === sorted.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="تأخير"
                >
                  ←
                </button>
                <button type="button" className="btn sm ghost" disabled={busy} onClick={() => remove(img)}>
                  حذف
                </button>
              </div>
            )}
          </figure>
        ))}
        {canAdd && left > 0 && (
          <label className={`img-add${busy ? ' busy' : ''}`}>
            <input type="file" accept="image/*" multiple hidden disabled={busy} onChange={(e) => onPick(e.target.files)} />
            <b>{busy ? 'جاري الرفع…' : '+ إضافة صور'}</b>
            <span className="muted">باقي {left} من {MAX_PRODUCT_IMAGES}</span>
          </label>
        )}
      </div>
      <p className="muted">
        الصورة الأولى هي الرئيسية في المتجر. تُصغَّر الصور تلقائياً قبل الرفع، وننصح بصورة مربعة بخلفية فاتحة.
      </p>
      {error && <p className="form-error">{error}</p>}
    </div>
  )
}
