import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CUSTODY_STATUS_LABELS, serviceErrorMessage, type CustodyStatus } from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { localPhone, sar, when } from '../lib/service'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

interface Custody {
  id: string
  amount: number
  status: CustodyStatus
  received_amount: number | null
  received_at: string | null
  note: string | null
  created_at: string
  technician: { id: string; full_name: string; phone: string }
  work_order: { id: string; number: string; request: { request_number: string; contact_name: string } }
}

interface Payment {
  id: string
  method: 'cash' | 'moyasar'
  amount: number
  created_at: string
  work_order: { id: string; number: string; request: { request_number: string; contact_name: string } }
  technician: { full_name: string } | null
}

type Tab = 'custody' | 'settled' | 'payments'

/** «المدفوعات والعهد»: cash held by technicians, and service payments. */
export function Payments() {
  const [tab, setTab] = useState<Tab>('custody')
  const [custody, setCustody] = useState<Custody[] | null>(null)
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    setError(null)
    Promise.all([
      supabase
        .from('custodies')
        .select('*, technician:technicians(id, full_name, phone), work_order:work_orders(id, number, request:service_requests(request_number, contact_name))')
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('service_payments')
        .select('id, method, amount, created_at, technician:technicians(full_name), work_order:work_orders(id, number, request:service_requests(request_number, contact_name))')
        .order('created_at', { ascending: false })
        .limit(200),
    ]).then(([c, p]) => {
      if (c.error || p.error) return setError('تعذّر التحميل.')
      setCustody((c.data ?? []) as unknown as Custody[])
      setPayments((p.data ?? []) as unknown as Payment[])
    })
  }, [])
  useEffect(reload, [reload])

  const openList = (custody ?? []).filter((c) => c.status !== 'settled')
  const byTech = new Map<string, { name: string; phone: string; total: number; rows: Custody[] }>()
  for (const c of openList) {
    const g = byTech.get(c.technician.id) ?? { name: c.technician.full_name, phone: c.technician.phone, total: 0, rows: [] }
    g.total += c.status === 'open' ? Number(c.amount) : 0
    g.rows.push(c)
    byTech.set(c.technician.id, g)
  }

  return (
    <RequirePage page="payments">
      <div className="ph">
        <div>
          <h1>المدفوعات والعهد</h1>
          <p>
            لما يستلم الفني فلوس نقداً تنفتح عليه عهدة. لما يسلّمك الفلوس سجّل المبلغ اللي استلمته. لو فيه فرق، اكتب السبب ويروح للمدير في{' '}
            <Link to="/approvals" className="link">
              الموافقات
            </Link>
            .
          </p>
        </div>
      </div>
      <div className="row between wrapr">
        <div className="chips" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'custody'} className={tab === 'custody' ? 'on' : undefined} onClick={() => setTab('custody')}>
            العهد المفتوحة ({openList.length})
          </button>
          <button type="button" role="tab" aria-selected={tab === 'settled'} className={tab === 'settled' ? 'on' : undefined} onClick={() => setTab('settled')}>
            العهد المستلمة
          </button>
          <button type="button" role="tab" aria-selected={tab === 'payments'} className={tab === 'payments' ? 'on' : undefined} onClick={() => setTab('payments')}>
            مدفوعات الصيانة
          </button>
        </div>
        <button className="btn ghost sm" onClick={reload}>
          تحديث
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!custody || !payments ? (
        !error && <p className="muted">جاري التحميل…</p>
      ) : tab === 'custody' ? (
        byTech.size === 0 ? (
          <div className="notice ok">
            <b>ما فيه عهد مفتوحة. كل الفلوس مستلمة.</b>
          </div>
        ) : (
          [...byTech.entries()].map(([id, g]) => (
            <section key={id} className="card stack-sm">
              <div className="row between wrapr">
                <b>
                  {g.name} <span className="muted" dir="ltr">{localPhone(g.phone)}</span>
                </b>
                <b>عنده {sar(g.total)}</b>
              </div>
              <div className="tw">
                <table>
                  <thead>
                    <tr>
                      <th>أمر العمل</th>
                      <th>العميل</th>
                      <th>المبلغ</th>
                      <th>من</th>
                      <th>الحالة</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((c) => (
                      <CustodyRow key={c.id} c={c} onDone={reload} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        )
      ) : tab === 'settled' ? (
        <div className="card tw">
          <table>
            <thead>
              <tr>
                <th>أمر العمل</th>
                <th>الفني</th>
                <th>المبلغ</th>
                <th>المستلم</th>
                <th>وقت الاستلام</th>
              </tr>
            </thead>
            <tbody>
              {custody
                .filter((c) => c.status === 'settled')
                .map((c) => (
                  <tr key={c.id}>
                    <td dir="ltr">{c.work_order.number}</td>
                    <td>{c.technician.full_name}</td>
                    <td>{sar(c.amount)}</td>
                    <td>
                      {sar(c.received_amount ?? 0)}
                      {Number(c.received_amount) !== Number(c.amount) && <div className="warn-text">فرق معتمد · {c.note}</div>}
                    </td>
                    <td>{c.received_at ? when(c.received_at) : '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card tw">
          <table>
            <thead>
              <tr>
                <th>الوقت</th>
                <th>أمر العمل</th>
                <th>العميل</th>
                <th>الطريقة</th>
                <th>المبلغ</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{when(p.created_at)}</td>
                  <td>
                    <Link to={`/p/work_orders?wo=${p.work_order.id}`} className="link" dir="ltr">
                      {p.work_order.number}
                    </Link>
                  </td>
                  <td>{p.work_order.request.contact_name}</td>
                  <td>{p.method === 'cash' ? `نقد مع ${p.technician?.full_name ?? 'الفني'}` : 'ميسر'}</td>
                  <td>{sar(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </RequirePage>
  )
}

function CustodyRow({ c, onDone }: { c: Custody; onDone: () => void }) {
  const { can } = useStaffAuth()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(String(Number(c.amount)))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const diff = (Number(amount) || 0) - Number(c.amount)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('custody_receive', { p_custody_id: c.id, p_amount: Number(amount) || 0, p_note: note.trim() || null })
    setBusy(false)
    if (err) return setError(serviceErrorMessage(err.message))
    onDone()
  }

  return (
    <Fragment>
      <tr>
        <td>
          <Link to={`/p/work_orders?wo=${c.work_order.id}`} className="link" dir="ltr">
            {c.work_order.number}
          </Link>
        </td>
        <td>{c.work_order.request.contact_name}</td>
        <td>{sar(c.amount)}</td>
        <td>{when(c.created_at)}</td>
        <td>
          <span className={`badge ${c.status === 'pending' ? 'b-warn' : ''}`}>{CUSTODY_STATUS_LABELS[c.status]}</span>
          {c.status === 'pending' && (
            <div className="muted">
              استلمنا {sar(c.received_amount ?? 0)} · {c.note}
            </div>
          )}
        </td>
        <td>
          {c.status === 'open' && can('payments', 'edit') && (
            <button className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>
              استلام
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="detail">
          <td colSpan={6}>
            <form className="row wrapr align-end" onSubmit={save}>
              <div className="field">
                <label htmlFor={`ra-${c.id}`}>المبلغ المستلم</label>
                <input id={`ra-${c.id}`} className="input num" inputMode="decimal" dir="ltr" style={{ width: 120 }} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} />
              </div>
              {diff !== 0 && (
                <div className="field grow">
                  <label htmlFor={`rn-${c.id}`}>
                    سبب الفرق ({diff > 0 ? 'زيادة' : 'نقص'} {sar(Math.abs(diff))})
                  </label>
                  <input id={`rn-${c.id}`} className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              )}
              <button className="btn sm field-btn" disabled={busy || (diff !== 0 && !note.trim())}>
                {diff === 0 ? 'تأكيد الاستلام' : 'أرسل الفرق للمدير'}
              </button>
              {error && <p className="form-error">{error}</p>}
            </form>
          </td>
        </tr>
      )}
    </Fragment>
  )
}
