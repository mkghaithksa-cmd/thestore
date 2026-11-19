import { useCallback, useEffect, useState } from 'react'
import { DEVICE_KIND_LABELS, serviceErrorMessage, type DeviceFilter, type DeviceKind } from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { localPhone, lookupPhone, normalizePhone, riyadhDate, when, type PhoneLookup, type StaffDevice } from '../lib/service'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

interface Product {
  id: string
  name_ar: string
  model: string | null
  type: 'device' | 'filter'
  filter_life_months: number | null
}

interface Uncertain {
  id: string
  name_ar: string
  started_on: string
  owner_phone: string | null
  customer: { phone: string; full_name: string | null } | null
}

/** «العملاء والأجهزة»: find a customer by phone, their devices and filters, add old devices. */
export function Customers() {
  const [phoneInput, setPhoneInput] = useState('')
  const [found, setFound] = useState<PhoneLookup | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [uncertain, setUncertain] = useState<Uncertain[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadUncertain = useCallback(() => {
    supabase
      .from('customer_devices')
      .select('id, name_ar, started_on, owner_phone, customer:customers(phone, full_name)')
      .eq('is_active', true)
      .eq('date_uncertain', true)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setUncertain((data ?? []) as unknown as Uncertain[]))
  }, [])

  useEffect(() => {
    supabase
      .from('products')
      .select('id, name_ar, model, type, filter_life_months')
      .in('type', ['device', 'filter'])
      .order('name_ar')
      .then(({ data }) => setProducts((data ?? []) as Product[]))
    loadUncertain()
  }, [loadUncertain])

  const find = useCallback(async (phone: string) => {
    setBusy(true)
    setError(null)
    try {
      setFound(await lookupPhone(phone))
    } catch {
      setError('تعذّر البحث.')
    } finally {
      setBusy(false)
    }
  }, [])

  function search(e: React.FormEvent) {
    e.preventDefault()
    const phone = normalizePhone(phoneInput)
    if (!phone) return setError('رقم الجوال غير صحيح. اكتبه بالشكل 05xxxxxxxx.')
    find(phone)
  }
  const refresh = () => {
    if (found) find(found.phone)
    loadUncertain()
  }

  return (
    <RequirePage page="customers">
      <div className="ph">
        <div>
          <h1>العملاء والأجهزة</h1>
          <p>ابحث برقم الجوال. تقدر تضيف أجهزة العملاء القديمة حتى لو ما عندهم حساب: لما يسجّلون برقمهم تظهر لهم في «أجهزتي».</p>
        </div>
      </div>
      <form className="card row wrapr align-end" onSubmit={search}>
        <div className="field grow">
          <label htmlFor="cu-phone">رقم جوال العميل</label>
          <input id="cu-phone" className="input" dir="ltr" inputMode="tel" placeholder="05xxxxxxxx" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} />
        </div>
        <button className="btn field-btn" disabled={busy}>
          بحث
        </button>
      </form>
      {error && <p className="form-error">{error}</p>}

      {found && <CustomerCard data={found} products={products} onChanged={refresh} />}

      {uncertain.length > 0 && (
        <div className="card stack">
          <h2 className="h3">أجهزة تاريخ تركيبها غير مؤكد ({uncertain.length})</h2>
          <p className="muted">تأكد من العميل وصحّح التاريخ، عشان مواعيد الفلاتر تطلع صح.</p>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>الجهاز</th>
                  <th>العميل</th>
                  <th>التاريخ المسجل</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {uncertain.map((u) => {
                  const phone = u.customer?.phone ?? u.owner_phone ?? ''
                  return (
                    <tr key={u.id}>
                      <td>{u.name_ar}</td>
                      <td>
                        {u.customer?.full_name ?? <span className="muted">بدون حساب</span>}
                        <div className="muted" dir="ltr">
                          {localPhone(phone)}
                        </div>
                      </td>
                      <td>{when(u.started_on)}</td>
                      <td>
                        <button
                          className="btn sm ghost"
                          onClick={() => {
                            setPhoneInput(localPhone(phone))
                            find(phone)
                          }}
                        >
                          فتح
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </RequirePage>
  )
}

function CustomerCard({ data, products, onChanged }: { data: PhoneLookup; products: Product[]; onChanged: () => void }) {
  const { can } = useStaffAuth()
  const [adding, setAdding] = useState(false)
  const devices = data.devices
  return (
    <div className="card stack">
      <div className="row between wrapr">
        <div className="stack-sm">
          <b>{data.customer ? data.customer.full_name ?? 'عميل بدون اسم' : 'رقم بدون حساب'}</b>
          <span className="muted" dir="ltr">
            {localPhone(data.phone)}
          </span>
          {data.customer && <span className="muted">عميل من {when(data.customer.created_at, false)}</span>}
        </div>
        {can('customers', 'add') && !adding && (
          <button className="btn sm" onClick={() => setAdding(true)}>
            + إضافة جهاز
          </button>
        )}
      </div>
      {adding && (
        <AddDevice
          phone={data.phone}
          products={products.filter((p) => p.type === 'device')}
          onDone={(saved) => {
            setAdding(false)
            if (saved) onChanged()
          }}
        />
      )}
      {devices.length === 0 ? (
        <p className="muted">ما عنده أجهزة مسجلة.</p>
      ) : (
        devices.map((d) => <DeviceBox key={d.id} d={d} filterProducts={products.filter((p) => p.type === 'filter')} onChanged={onChanged} />)
      )}
    </div>
  )
}

function AddDevice({ phone, products, onDone }: { phone: string; products: Product[]; onDone: (saved: boolean) => void }) {
  const [source, setSource] = useState<'ours' | 'other'>('ours')
  const [productId, setProductId] = useState('')
  const [kind, setKind] = useState<DeviceKind>('under_sink')
  const [brand, setBrand] = useState('')
  const [stages, setStages] = useState('')
  const [known, setKnown] = useState(true)
  const [started, setStarted] = useState('')
  const [installed, setInstalled] = useState(true)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (source === 'ours' && !productId) return setError('اختر الجهاز.')
    if (known && !started) return setError('اكتب تاريخ التركيب، أو اختر «ما يعرف التاريخ».')
    setBusy(true)
    setError(null)
    const { error: err } =
      source === 'ours'
        ? await supabase.rpc('device_add_staff', {
            p_phone: phone,
            p_product_id: productId,
            p_started_on: known ? started : null,
            p_installed: installed,
            p_notes: notes.trim() || null,
          })
        : await supabase.rpc('device_add_staff_external', {
            p_phone: phone,
            p_kind: kind,
            p_brand: brand.trim() || null,
            p_stages: stages ? Number(stages) : null,
            p_started_on: known ? started : null,
            p_notes: notes.trim() || null,
          })
    setBusy(false)
    if (err) return setError(serviceErrorMessage(err.message))
    onDone(true)
  }

  return (
    <form className="act card inset" onSubmit={save}>
      <b>إضافة جهاز</b>
      <div className="chips" role="radiogroup" aria-label="مصدر الجهاز">
        <button type="button" role="radio" aria-checked={source === 'ours'} className={source === 'ours' ? 'on' : undefined} onClick={() => setSource('ours')}>
          من منتجات غيث
        </button>
        <button type="button" role="radio" aria-checked={source === 'other'} className={source === 'other' ? 'on' : undefined} onClick={() => setSource('other')}>
          من شركة أخرى
        </button>
      </div>
      <div className="grid-form">
        {source === 'other' ? (
          <>
            <div className="field">
              <label htmlFor="ad-k">نوع الجهاز</label>
              <select id="ad-k" className="input" value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)}>
                {(Object.keys(DEVICE_KIND_LABELS) as DeviceKind[]).map((k) => (
                  <option key={k} value={k}>
                    {DEVICE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ad-b">الشركة / الماركة</label>
              <input id="ad-b" className="input" maxLength={60} value={brand} onChange={(e) => setBrand(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ad-s">عدد المراحل</label>
              <input id="ad-s" className="input num" inputMode="numeric" maxLength={2} value={stages} onChange={(e) => setStages(e.target.value.replace(/[^0-9]/g, ''))} />
            </div>
          </>
        ) : (
        <div className="field">
          <label htmlFor="ad-p">الجهاز</label>
          <select id="ad-p" className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">اختر</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name_ar}
                {p.model ? ` (${p.model})` : ''}
              </option>
            ))}
          </select>
        </div>
        )}
        <div className="field">
          <label htmlFor="ad-d">{source === 'other' ? 'آخر تغيير فلاتر / التركيب' : 'تاريخ التركيب'}</label>
          <input id="ad-d" type="date" className="input" max={riyadhDate()} disabled={!known} value={started} onChange={(e) => setStarted(e.target.value)} />
          <label className="check tight">
            <input type="checkbox" checked={!known} onChange={(e) => setKnown(!e.target.checked)} /> ما يعرف التاريخ (ينحفظ «تاريخ غير مؤكد»)
          </label>
        </div>
        <div className="field">
          <label htmlFor="ad-n">ملاحظات</label>
          <input id="ad-n" className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {source === 'ours' && (
            <label className="check tight">
              <input type="checkbox" checked={installed} onChange={(e) => setInstalled(e.target.checked)} /> ركّبناه نحن
            </label>
          )}
        </div>
      </div>
      <p className="muted">
        {source === 'ours'
          ? 'الفلاتر تنضاف تلقائياً حسب موديل الجهاز، وتقدر تعدّل عمرها وآخر تغيير بعد الحفظ.'
          : 'ينضاف له «طقم الفلاتر» بالعمر الافتراضي من الإعدادات. عدّله أو أضف فلاتر بعد الحفظ.'}
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="row">
        <button className="btn sm" disabled={busy}>
          حفظ الجهاز
        </button>
        <button type="button" className="btn sm ghost" onClick={() => onDone(false)}>
          إلغاء
        </button>
      </div>
    </form>
  )
}

function DeviceBox({ d, filterProducts, onChanged }: { d: StaffDevice; filterProducts: Product[]; onChanged: () => void }) {
  const { can } = useStaffAuth()
  const editable = can('customers', 'edit')
  const [editing, setEditing] = useState(false)
  const [started, setStarted] = useState(d.started_on)
  const [uncertain, setUncertain] = useState(d.date_uncertain)
  const [notes, setNotes] = useState(d.notes ?? '')
  const [newFilter, setNewFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const today = riyadhDate()

  async function call(fn: string, args: Record<string, unknown>) {
    setError(null)
    const { error: err } = await supabase.rpc(fn, args)
    if (err) return setError(serviceErrorMessage(err.message))
    setEditing(false)
    onChanged()
  }
  const save = (active = true) =>
    call('device_update_staff', { p_device_id: d.id, p_started_on: started, p_date_uncertain: uncertain, p_notes: notes.trim() || null, p_is_active: active })

  return (
    <section className={`card inset stack${d.is_active ? '' : ' off'}`}>
      <div className="row between wrapr">
        <div className="stack-sm">
          <b>
            {d.name_ar}
            {d.model && <span className="muted"> ({d.model})</span>}
            <span className={`badge ms ${d.product_id ? 'b-ok' : 'b-gray'}`}>{d.product_id ? 'غيث' : 'شركة أخرى'}</span>
            {d.stages ? <span className="muted"> · {d.stages} مراحل</span> : null}
            {!d.is_active && <span className="badge b-gray ms">مؤرشف</span>}
          </b>
          <span className="muted">
            {d.installed ? 'تركيب' : 'تسليم'} {when(d.started_on)}
            {d.order_id ? ' · من طلب في المتجر' : d.added_by && d.added_by !== d.customer_id ? ' · أضافه موظف' : ' · أضافه العميل'}
            {d.warranty_until ? ` · ضمان لين ${when(d.warranty_until)}` : ''}
          </span>
          {d.date_uncertain && <span className="warn-text">تاريخ غير مؤكد</span>}
          {d.next_contact_on && d.next_contact_on > today && <span className="muted">التذكير مؤجل لين {when(d.next_contact_on)}</span>}
          {d.notes && <span className="muted">{d.notes}</span>}
        </div>
        {editable && !editing && (
          <button className="btn sm ghost" onClick={() => setEditing(true)}>
            تعديل الجهاز
          </button>
        )}
      </div>
      {editing && (
        <div className="act">
          <div className="row wrapr align-end">
            <div className="field">
              <label htmlFor={`st-${d.id}`}>تاريخ التركيب</label>
              <input id={`st-${d.id}`} type="date" className="input" max={today} value={started} onChange={(e) => setStarted(e.target.value)} />
            </div>
            <label className="check field-btn">
              <input type="checkbox" checked={uncertain} onChange={(e) => setUncertain(e.target.checked)} /> تاريخ غير مؤكد
            </label>
            <div className="field grow">
              <label htmlFor={`no-${d.id}`}>ملاحظات</label>
              <input id={`no-${d.id}`} className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <div className="row wrapr">
            <button className="btn sm" onClick={() => save(true)}>
              حفظ
            </button>
            {d.is_active ? (
              <button className="btn sm ghost danger" onClick={() => window.confirm('أرشفة الجهاز؟ ما يظهر للعميل ولا في الصيانة.') && save(false)}>
                أرشفة
              </button>
            ) : (
              <button className="btn sm ghost" onClick={() => save(true)}>
                إرجاع من الأرشيف
              </button>
            )}
            <button className="btn sm ghost" onClick={() => setEditing(false)}>
              إلغاء
            </button>
          </div>
        </div>
      )}

      {d.filters.length > 0 ? (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>الفلتر</th>
                <th>العمر (شهر)</th>
                <th>آخر تغيير</th>
                <th>التغيير القادم</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {d.filters.map((f) => (
                <FilterRow key={f.id} f={f} editable={editable} onSave={(args) => call('device_filter_update', args)} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">ما فيه فلاتر مسجلة لهذا الجهاز.</p>
      )}
      {editable && (
        <div className="row wrapr">
          <select className="input sm" aria-label="إضافة فلتر" value={newFilter} onChange={(e) => setNewFilter(e.target.value)}>
            <option value="">+ إضافة فلتر</option>
            {filterProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name_ar}
                {p.filter_life_months ? ` (${p.filter_life_months} شهر)` : ''}
              </option>
            ))}
          </select>
          {newFilter && (
            <button className="btn sm sec" onClick={() => call('device_filter_add', { p_device_id: d.id, p_filter_product_id: newFilter }).then(() => setNewFilter(''))}>
              إضافة
            </button>
          )}
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  )
}

function FilterRow({ f, editable, onSave }: { f: DeviceFilter; editable: boolean; onSave: (args: Record<string, unknown>) => void }) {
  const [life, setLife] = useState(String(f.life_months))
  const [last, setLast] = useState(f.last_changed_on)
  useEffect(() => {
    setLife(String(f.life_months))
    setLast(f.last_changed_on)
  }, [f.life_months, f.last_changed_on])
  const today = riyadhDate()
  const late = f.is_active && f.next_due_on < today
  const dirty = life !== String(f.life_months) || last !== f.last_changed_on
  const args = (active: boolean) => ({ p_filter_id: f.id, p_life_months: Number(life), p_last_changed_on: last, p_is_active: active })

  return (
    <tr className={f.is_active ? undefined : 'off'}>
      <td>
        {f.name_ar}
        {!f.is_active && <span className="muted"> · محذوف</span>}
      </td>
      <td>
        {editable ? (
          <input className="input sm num" inputMode="numeric" style={{ width: 70 }} value={life} onChange={(e) => setLife(e.target.value.replace(/[^0-9]/g, ''))} aria-label={`عمر ${f.name_ar}`} />
        ) : (
          f.life_months
        )}
      </td>
      <td>
        {editable ? (
          <input className="input sm" type="date" max={today} value={last} onChange={(e) => setLast(e.target.value)} aria-label={`آخر تغيير ${f.name_ar}`} />
        ) : (
          when(f.last_changed_on)
        )}
      </td>
      <td className={late ? 'low' : undefined}>{f.is_active ? when(f.next_due_on) : '—'}</td>
      <td>
        {editable && (
          <div className="row">
            {dirty && (
              <button className="btn sm" onClick={() => onSave(args(f.is_active))}>
                حفظ
              </button>
            )}
            {!dirty && f.is_active && (
              <button className="btn sm ghost" onClick={() => onSave({ ...args(true), p_last_changed_on: today })}>
                تغيّر اليوم
              </button>
            )}
            <button className="linkbtn" onClick={() => onSave(args(!f.is_active))}>
              {f.is_active ? 'حذف' : 'إرجاع'}
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}
