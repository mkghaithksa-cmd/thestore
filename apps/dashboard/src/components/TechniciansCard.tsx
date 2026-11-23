import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { serviceErrorMessage } from '@ghaith/shared'
import { supabase } from '../lib/supabase'

interface TechRow {
  id: string
  full_name: string
  phone: string
  is_active: boolean
}

/** «الفنيين»: name and phone. They have no account; each visit gets a link. */
export function TechniciansCard({ canAdd, canEdit }: { canAdd: boolean; canEdit: boolean }) {
  const [rows, setRows] = useState<TechRow[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    supabase
      .from('technicians')
      .select('id, full_name, phone, is_active')
      .order('is_active', { ascending: false })
      .order('full_name')
      .then(({ data }) => setRows((data ?? []) as TechRow[]))
  }, [])
  useEffect(load, [load])

  async function save(id: string | null, n: string, p: string, active: boolean) {
    setBusy(true)
    setError(null)
    const { error: e } = await supabase.rpc('technician_save', { p_id: id, p_name: n, p_phone: p, p_active: active })
    setBusy(false)
    if (e) {
      setError(serviceErrorMessage(e.message))
      return false
    }
    load()
    return true
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (await save(null, name, phone, true)) {
      setName('')
      setPhone('')
    }
  }

  return (
    <section className="card stack">
      <h2 className="h3">الفنيين</h2>
      <span className="muted">
        الفني ما يحتاج حساب. لكل زيارة يوصله رابط واتساب يفتحه من جواله، وما يشوف فيه الأسعار. الفني الموقّف ما يظهر في اختيار الفني.
      </span>
      {rows.length === 0 ? (
        <p className="notice warn">ما فيه فنيين. أضف فني عشان تقدر تحدد الزيارات وترسل الروابط.</p>
      ) : (
        <ul className="stack-sm ft-list">
          {rows.map((t) => (
            <li key={t.id} className="row between wrapr">
              <span>
                <b className={t.is_active ? undefined : 'muted'}>{t.full_name}</b>{' '}
                <span className="muted" dir="ltr">
                  {t.phone.replace(/^\+966/, '0')}
                </span>
                {!t.is_active && <span className="muted"> · موقّف</span>}
              </span>
              {canEdit && (
                <button type="button" className="linkbtn" disabled={busy} onClick={() => save(t.id, t.full_name, t.phone, !t.is_active)}>
                  {t.is_active ? 'إيقاف' : 'تفعيل'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canAdd && (
        <form className="row wrapr align-end" onSubmit={add}>
          <div className="field">
            <label htmlFor="tn">اسم الفني</label>
            <input id="tn" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tp">جواله</label>
            <input id="tp" className="input num" inputMode="tel" dir="ltr" placeholder="05xxxxxxxx" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <button className="btn field-btn" disabled={busy || !name.trim() || !phone.trim()}>
            إضافة فني
          </button>
        </form>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  )
}

