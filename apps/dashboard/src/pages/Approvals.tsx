import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { APPROVAL_KIND_LABELS, serviceErrorMessage, type ApprovalKind } from '@ghaith/shared'
import { sar, when } from '../lib/service'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

interface Approval {
  id: string
  kind: ApprovalKind
  amount: number | null
  qty: number | null
  note: string | null
  status: 'pending' | 'approved' | 'rejected'
  requested_by: string | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
  work_order: { id: string; number: string; total: number } | null
  custody: { amount: number; technician: { full_name: string } } | null
  product: { name_ar: string } | null
}

/** «الموافقات»: discounts, custody and stock-count differences. Nobody approves their own. */
export function Approvals() {
  const { can, me } = useStaffAuth()
  const [rows, setRows] = useState<Approval[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [showDone, setShowDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const allowed = can('payments', 'approve') || can('inventory', 'approve')

  const reload = useCallback(() => {
    setError(null)
    Promise.all([
      supabase
        .from('approvals')
        .select('*, work_order:work_orders(id, number, total), custody:custodies(amount, technician:technicians(full_name)), product:products(name_ar)')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('staff_profiles').select('user_id, full_name'),
    ]).then(([a, s]) => {
      if (a.error) return setError('تعذّر التحميل.')
      setRows((a.data ?? []) as unknown as Approval[])
      setNames(Object.fromEntries(((s.data ?? []) as { user_id: string; full_name: string }[]).map((x) => [x.user_id, x.full_name])))
    })
  }, [])
  useEffect(reload, [reload])

  if (!allowed) {
    return (
      <div className="notice">
        <b>الموافقات للمدير.</b>
        <span className="muted">طلباتك اللي تنتظر موافقة تظهر في صفحاتها (أوامر العمل، العهد، المخزون).</span>
      </div>
    )
  }
  const list = (rows ?? []).filter((r) => (showDone ? r.status !== 'pending' : r.status === 'pending'))

  return (
    <>
      <div className="ph">
        <div>
          <h1>الموافقات</h1>
          <p>فرق عهدة وفرق جرد. (الخصومات ما تحتاج موافقة: تنبيهها في سجل التدقيق.) ما أحد يعتمد طلبه بنفسه، والرفض يحتاج سبب. كل قرار ينحفظ في سجل التدقيق.</p>
        </div>
      </div>
      <div className="row between wrapr">
        <div className="chips" role="tablist">
          <button type="button" role="tab" aria-selected={!showDone} className={!showDone ? 'on' : undefined} onClick={() => setShowDone(false)}>
            بانتظار القرار ({(rows ?? []).filter((r) => r.status === 'pending').length})
          </button>
          <button type="button" role="tab" aria-selected={showDone} className={showDone ? 'on' : undefined} onClick={() => setShowDone(true)}>
            السابقة
          </button>
        </div>
        <button className="btn ghost sm" onClick={reload}>
          تحديث
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!rows ? (
        !error && <p className="muted">جاري التحميل…</p>
      ) : list.length === 0 ? (
        <div className="notice ok">
          <b>{showDone ? 'ما فيه قرارات سابقة.' : 'ما فيه شي ينتظر موافقتك.'}</b>
        </div>
      ) : (
        list.map((a) => (
          <ApprovalCard
            key={a.id}
            a={a}
            who={a.requested_by ? names[a.requested_by] ?? 'موظف' : '—'}
            own={a.requested_by === me?.profile.user_id}
            canDecide={can(a.kind === 'stock_diff' ? 'inventory' : 'payments', 'approve')}
            onDone={reload}
          />
        ))
      )}
    </>
  )
}

function ApprovalCard({ a, who, own, canDecide, onDone }: { a: Approval; who: string; own: boolean; canDecide: boolean; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(approve: boolean) {
    if (!approve && !note.trim()) return setError('اكتب سبب الرفض.')
    setBusy(true)
    setError(null)
    const { error: e } = await supabase.rpc('approval_decide', { p_approval_id: a.id, p_approve: approve, p_note: note.trim() || null })
    setBusy(false)
    if (e) return setError(serviceErrorMessage(e.message))
    onDone()
  }

  return (
    <section className="card stack-sm">
      <div className="row between wrapr">
        <b>{APPROVAL_KIND_LABELS[a.kind]}</b>
        <span className="muted">
          طلبه {who} · {when(a.created_at)}
        </span>
      </div>
      {a.kind === 'discount' && a.work_order && (
        <span>
          خصم <b>{sar(a.amount ?? 0)}</b> على أمر العمل{' '}
          <Link to={`/p/work_orders?wo=${a.work_order.id}`} className="link" dir="ltr">
            {a.work_order.number}
          </Link>{' '}
          (الإجمالي بعد الخصم {sar(a.work_order.total)})
        </span>
      )}
      {a.kind === 'custody_diff' && a.custody && (
        <span>
          عهدة {a.custody.technician.full_name}: المفروض {sar(a.custody.amount)}، المستلم {sar(Number(a.custody.amount) + Number(a.amount))} ·{' '}
          <b className={Number(a.amount) < 0 ? 'warn-text' : undefined}>
            {Number(a.amount) < 0 ? 'نقص' : 'زيادة'} {sar(Math.abs(Number(a.amount)))}
          </b>
        </span>
      )}
      {a.kind === 'stock_diff' && a.product && (
        <span>
          {a.product.name_ar}: الجرد {Number(a.qty) > 0 ? 'أكثر' : 'أقل'} من النظام بـ <b>{Math.abs(Number(a.qty))}</b>
        </span>
      )}
      {a.note && <span className="muted">السبب: {a.note}</span>}
      {a.status === 'pending' ? (
        own ? (
          <span className="muted">هذا طلبك: يعتمده مدير ثاني.</span>
        ) : canDecide ? (
          <div className="row wrapr align-end">
            <div className="field grow">
              <label htmlFor={`an-${a.id}`}>ملاحظة (مطلوبة للرفض)</label>
              <input id={`an-${a.id}`} className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <button className="btn sm field-btn" disabled={busy} onClick={() => decide(true)}>
              موافقة
            </button>
            <button className="btn sm ghost danger field-btn" disabled={busy} onClick={() => decide(false)}>
              رفض
            </button>
          </div>
        ) : (
          <span className="muted">ما عندك صلاحية هذا النوع.</span>
        )
      ) : (
        <span className={a.status === 'approved' ? 'ok-text' : 'warn-text'}>
          {a.status === 'approved' ? 'تمت الموافقة' : 'مرفوض'} · {a.decided_at ? when(a.decided_at) : ''}
          {a.decision_note ? ` · ${a.decision_note}` : ''}
        </span>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  )
}
