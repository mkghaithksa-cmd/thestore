import { Fragment, useCallback, useEffect, useState } from 'react'
import { orderErrorMessage, PRODUCT_TYPE_LABELS, type ProductType } from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

interface Item {
  id: string
  sku: string
  name_ar: string
  type: ProductType
  status: string
  reorder_level: number
  on_hand: number
}

interface Movement {
  id: number
  qty: number
  kind: 'receive' | 'issue' | 'return' | 'adjust'
  reference: string | null
  note: string | null
  balance_after: number
  created_at: string
  product: { name_ar: string; sku: string } | null
}

const KIND_LABELS: Record<Movement['kind'], string> = { receive: 'استلام', issue: 'صرف لطلب', return: 'إرجاع من طلب ملغي', adjust: 'جرد' }

const when = (iso: string) =>
  new Date(iso).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' })

const isLow = (i: Item) => i.on_hand < 0 || (i.reorder_level > 0 && i.on_hand <= i.reorder_level)

/** One warehouse: balances, receiving, stock counts and the movements log. */
export function Inventory() {
  const { can } = useStaffAuth()
  const [items, setItems] = useState<Item[] | null>(null)
  const [moves, setMoves] = useState<Movement[]>([])
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [open, setOpen] = useState<{ id: string; mode: 'receive' | 'count' } | null>(null)

  const load = useCallback(async () => {
    const [p, l, m] = await Promise.all([
      supabase.from('products').select('id, sku, name_ar, type, status, reorder_level').eq('tracks_stock', true).order('name_ar'),
      supabase.from('stock_levels').select('product_id, on_hand'),
      supabase.from('stock_movements').select('id, qty, kind, reference, note, balance_after, created_at, product:products(name_ar, sku)').order('id', { ascending: false }).limit(100),
    ])
    if (p.error || l.error || m.error) throw new Error('load')
    const bal = new Map((l.data ?? []).map((r) => [r.product_id as string, r.on_hand as number]))
    setItems((p.data ?? []).map((r) => ({ ...(r as Omit<Item, 'on_hand'>), on_hand: bal.get(r.id as string) ?? 0 })))
    setMoves((m.data ?? []) as unknown as Movement[])
  }, [])

  const reload = useCallback(() => {
    setError(null)
    load().catch(() => setError('تعذّر تحميل المخزون.'))
  }, [load])
  useEffect(reload, [reload])

  const low = (items ?? []).filter(isLow)
  const term = q.trim().toLowerCase()
  const shown = (items ?? []).filter((i) => (!onlyLow || isLow(i)) && (!term || i.name_ar.toLowerCase().includes(term) || i.sku.toLowerCase().includes(term)))

  return (
    <RequirePage page="inventory">
      <div className="ph">
        <div>
          <h1>المخزون</h1>
          <p>مستودع واحد. الصرف يصير تلقائياً لما الطلب يبدأ تجهيزه أو لما ينقفل أمر صيانة فيه قطع، والطلب الملغي بعد الصرف يرجع للمخزون. الرصيد بالسالب يعني بعنا أكثر من المسجّل: سوّ جرد.</p>
        </div>
        <button className="btn ghost" onClick={reload}>
          تحديث
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}

      {low.length > 0 && (
        <div className="notice warn" role="status">
          <b>
            {low.length === 1 ? 'منتج واحد' : `${low.length} منتجات`} وصل حد إعادة الطلب أو أقل: {low.slice(0, 4).map((i) => i.name_ar).join('، ')}
            {low.length > 4 ? '…' : ''}
          </b>
          <button className="linkbtn" onClick={() => setOnlyLow(true)}>
            عرضها
          </button>
        </div>
      )}

      <div className="card stack">
        <div className="row wrapr">
          <input className="input grow" placeholder="ابحث بالاسم أو SKU" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="row">
            <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> الناقص فقط
          </label>
        </div>
        {!items ? (
          !error && <p className="muted">جاري التحميل…</p>
        ) : shown.length === 0 ? (
          <p className="muted">لا توجد منتجات هنا.</p>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>النوع</th>
                  <th>الرصيد</th>
                  <th>حد إعادة الطلب</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <Fragment key={i.id}>
                    <tr>
                      <td>
                        {i.name_ar}
                        <div className="muted" dir="ltr">
                          {i.sku}
                          {i.status === 'draft' ? ' · مسودة' : ''}
                        </div>
                      </td>
                      <td>{PRODUCT_TYPE_LABELS[i.type]}</td>
                      <td className={isLow(i) ? 'low' : undefined}>{i.on_hand}</td>
                      <td>
                        <ReorderLevel item={i} editable={can('inventory', 'edit')} onSaved={reload} />
                      </td>
                      <td>
                        <div className="row">
                          {can('inventory', 'add') && (
                            <button className="btn sm sec" onClick={() => setOpen(open?.id === i.id && open.mode === 'receive' ? null : { id: i.id, mode: 'receive' })}>
                              استلام
                            </button>
                          )}
                          {can('inventory', 'edit') && (
                            <button className="btn sm ghost" onClick={() => setOpen(open?.id === i.id && open.mode === 'count' ? null : { id: i.id, mode: 'count' })}>
                              جرد
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {open?.id === i.id && (
                      <tr className="detail">
                        <td colSpan={5}>
                          <StockForm
                            item={i}
                            mode={open.mode}
                            onDone={() => {
                              setOpen(null)
                              reload()
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card stack">
        <h2 className="h3">آخر الحركات</h2>
        {moves.length === 0 ? (
          <p className="muted">ما في حركات بعد. ابدأ بالجرد الافتتاحي (زر «جرد») لكل منتج.</p>
        ) : (
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المنتج</th>
                  <th>الحركة</th>
                  <th>الكمية</th>
                  <th>الرصيد بعدها</th>
                  <th>المرجع</th>
                </tr>
              </thead>
              <tbody>
                {moves.map((m) => (
                  <tr key={m.id}>
                    <td>{when(m.created_at)}</td>
                    <td>{m.product?.name_ar ?? '—'}</td>
                    <td>{KIND_LABELS[m.kind]}</td>
                    <td dir="ltr">{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
                    <td>{m.balance_after}</td>
                    <td>
                      <span dir="auto">{m.reference ?? ''}</span>
                      {m.note && <div className="muted">{m.note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </RequirePage>
  )
}

function ReorderLevel({ item, editable, onSaved }: { item: Item; editable: boolean; onSaved: () => void }) {
  const [v, setV] = useState(String(item.reorder_level))
  const [err, setErr] = useState(false)
  useEffect(() => setV(String(item.reorder_level)), [item.reorder_level])
  if (!editable) return <>{item.reorder_level}</>
  async function save() {
    const n = Number(v)
    if (!Number.isInteger(n) || n < 0) return setErr(true)
    if (n === item.reorder_level) return
    const { error } = await supabase.rpc('stock_set_reorder_level', { p_product_id: item.id, p_level: n })
    setErr(!!error)
    if (!error) onSaved()
  }
  return (
    <input
      className={`input sm num${err ? ' bad' : ''}`}
      inputMode="numeric"
      aria-label={`حد إعادة الطلب: ${item.name_ar}`}
      value={v}
      onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      style={{ width: 80 }}
    />
  )
}

function StockForm({ item, mode, onDone }: { item: Item; mode: 'receive' | 'count'; onDone: () => void }) {
  const [qty, setQty] = useState(mode === 'count' ? String(Math.max(item.on_hand, 0)) : '')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState(mode === 'count' ? 'جرد' : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const n = Number(qty)
    if (!qty || !Number.isInteger(n) || n < (mode === 'receive' ? 1 : 0)) return setError('اكتب كمية صحيحة.')
    setBusy(true)
    setError(null)
    const { data, error: err } =
      mode === 'receive'
        ? await supabase.rpc('stock_receive', { p_product_id: item.id, p_qty: n, p_reference: ref, p_note: note.trim() || null })
        : await supabase.rpc('stock_count', { p_product_id: item.id, p_on_hand: n, p_note: note })
    setBusy(false)
    if (err) return setError(orderErrorMessage(err.message))
    // A later count with a difference waits for a manager (the balance stays until approved).
    if (mode === 'count' && n !== item.on_hand && data === item.on_hand) {
      window.alert('انحفظ الجرد. الفرق راح للمدير في «الموافقات»، والرصيد يتعدّل بعد موافقته.')
    }
    onDone()
  }

  return (
    <form className="act card inset" onSubmit={submit}>
      <b>{mode === 'receive' ? `استلام مخزون: ${item.name_ar}` : `جرد: ${item.name_ar} (الرصيد الحالي ${item.on_hand})`}</b>
      <div className="row wrapr">
        <input
          className="input sm"
          inputMode="numeric"
          placeholder={mode === 'receive' ? 'الكمية المستلمة' : 'الكمية الموجودة فعلاً'}
          value={qty}
          onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, ''))}
          autoFocus
        />
        {mode === 'receive' && (
          <input className="input sm" placeholder="رقم فاتورة المورد" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} />
        )}
        <input
          className="input sm grow"
          placeholder={mode === 'receive' ? 'ملاحظة (اختياري)' : 'سبب الجرد'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
        />
        <button className="btn sm" disabled={busy}>
          {mode === 'receive' ? 'تسجيل الاستلام' : 'حفظ الجرد'}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
