import { useCallback, useEffect, useState } from 'react'
import { ORDER_STATUS_LABELS } from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { sar } from '../lib/service'
import { supabase } from '../lib/supabase'

interface Report {
  from: string
  to: string
  store: {
    paid_orders: number
    total: number
    vat: number
    install_fees: number
    shipping_fees: number
    average: number
    created: number
    cancelled: number
    by_status: Record<string, number>
  }
  service: {
    requests: number
    emergency: number
    maintenance: number
    cancelled: number
    closed_work_orders: number
    customer_absent: number
    rejected_quotes: number
    total: number
  }
  collections: { store_card: number; service_card: number; service_cash: number; custody_open: number }
  top_products: { name: string; sku: string; qty: number; revenue: number }[]
  parts_used: { name: string; qty: number }[]
  daily: { d: string; orders: number; store: number; service: number }[]
}

/** Today in Mecca as YYYY-MM-DD. */
function meccaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
}
function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

type Preset = 'today' | 'week' | 'month' | 'last_month' | 'custom'

function presetRange(p: Preset): [string, string] | null {
  const t = meccaToday()
  if (p === 'today') return [t, t]
  if (p === 'week') return [shift(t, -6), t]
  if (p === 'month') return [`${t.slice(0, 8)}01`, t]
  if (p === 'last_month') {
    const first = `${t.slice(0, 8)}01`
    const lastEnd = shift(first, -1)
    return [`${lastEnd.slice(0, 8)}01`, lastEnd]
  }
  return null
}

/** CSV with a BOM so Excel opens Arabic text correctly. */
function downloadCsv(r: Report) {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines: (string | number)[][] = [
    ['تقرير غيث', `${r.from} إلى ${r.to}`],
    [],
    ['الملخص', 'القيمة'],
    ['مبيعات المتجر (شامل الضريبة)', r.store.total],
    ['طلبات مدفوعة', r.store.paid_orders],
    ['متوسط الطلب', r.store.average],
    ['ضريبة المتجر', r.store.vat],
    ['رسوم التركيب', r.store.install_fees],
    ['رسوم الشحن', r.store.shipping_fees],
    ['تحصيل الصيانة', r.service.total],
    ['بلاغات جديدة', r.service.requests],
    ['أوامر عمل مغلقة', r.service.closed_work_orders],
    ['تحصيل بطاقة (المتجر)', r.collections.store_card],
    ['تحصيل بطاقة (الصيانة)', r.collections.service_card],
    ['تحصيل نقد (الصيانة)', r.collections.service_cash],
    [],
    ['اليوم', 'طلبات مدفوعة', 'مبيعات المتجر', 'تحصيل الصيانة', 'المجموع'],
    ...r.daily.map((d) => [d.d, d.orders, Number(d.store), Number(d.service), Number(d.store) + Number(d.service)]),
    [],
    ['أكثر المنتجات مبيعاً', 'SKU', 'الكمية', 'المبيعات (قبل الضريبة)'],
    ...r.top_products.map((p) => [p.name, p.sku, p.qty, Number(p.revenue)]),
  ]
  const csv = '﻿' + lines.map((l) => l.map(esc).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `ghaith-report-${r.from}-${r.to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** «التقارير»: sales, orders, maintenance, collections for a date range. */
export function Reports() {
  const [preset, setPreset] = useState<Preset>('week')
  const [range, setRange] = useState<[string, string]>(() => presetRange('week')!)
  const [r, setR] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    setError(null)
    supabase.rpc('report_summary', { p_from: range[0], p_to: range[1] }).then(({ data, error: e }) => {
      setBusy(false)
      if (e) {
        if (e.message.includes('invalid_range')) return setError('تاريخ النهاية قبل البداية.')
        if (e.message.includes('range_too_long')) return setError('الفترة سنة كحد أقصى.')
        return setError('تعذّر تحميل التقرير.')
      }
      setR(data as Report)
    })
  }, [range])
  useEffect(load, [load])

  function pick(p: Preset) {
    setPreset(p)
    const pr = presetRange(p)
    if (pr) setRange(pr)
  }

  const maxDay = r ? Math.max(1, ...r.daily.map((d) => Number(d.store) + Number(d.service))) : 1
  const sales = r ? Number(r.store.total) + Number(r.service.total) : 0

  return (
    <RequirePage page="reports">
      <div className="ph">
        <div>
          <h1>التقارير</h1>
          <p>المبيعات تنحسب يوم الدفع (بتوقيت مكة). الطلب الملغي ما ينحسب. الصيانة تنحسب يوم التحصيل.</p>
        </div>
        {r && (
          <button className="btn sec sm" onClick={() => downloadCsv(r)}>
            تحميل Excel
          </button>
        )}
      </div>

      <div className="row between wrapr align-end">
        <div className="chips" role="tablist">
          {(
            [
              ['today', 'اليوم'],
              ['week', 'آخر 7 أيام'],
              ['month', 'هذا الشهر'],
              ['last_month', 'الشهر الماضي'],
              ['custom', 'فترة أخرى'],
            ] as [Preset, string][]
          ).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={preset === k} className={preset === k ? 'on' : undefined} onClick={() => pick(k)}>
              {l}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="row wrapr align-end">
            <div className="field">
              <label htmlFor="rf">من</label>
              <input id="rf" type="date" className="input" value={range[0]} max={range[1]} onChange={(e) => e.target.value && setRange([e.target.value, range[1]])} />
            </div>
            <div className="field">
              <label htmlFor="rt">إلى</label>
              <input id="rt" type="date" className="input" value={range[1]} min={range[0]} onChange={(e) => e.target.value && setRange([range[0], e.target.value])} />
            </div>
          </div>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      {!r ? (
        !error && <p className="muted">جاري التحميل…</p>
      ) : (
        <div className={`stack${busy ? ' dim' : ''}`}>
          <div className="kpis">
            <div className="kpi">
              <span>إجمالي المبيعات</span>
              <b>{sar(sales)}</b>
              <small>شامل الضريبة</small>
            </div>
            <div className="kpi">
              <span>المتجر</span>
              <b>{sar(r.store.total)}</b>
              <small>
                {r.store.paid_orders} طلب مدفوع · متوسط {sar(r.store.average)}
              </small>
            </div>
            <div className="kpi">
              <span>الصيانة</span>
              <b>{sar(r.service.total)}</b>
              <small>{r.service.closed_work_orders} أمر عمل مغلق</small>
            </div>
            <div className="kpi">
              <span>ضريبة المتجر</span>
              <b>{sar(r.store.vat)}</b>
              <small>
                تركيب {sar(r.store.install_fees)} · شحن {sar(r.store.shipping_fees)}
              </small>
            </div>
          </div>

          <section className="card stack-sm">
            <b>المبيعات يوم بيوم</b>
            <div className="tw">
              <table>
                <thead>
                  <tr>
                    <th>اليوم</th>
                    <th>طلبات</th>
                    <th>المتجر</th>
                    <th>الصيانة</th>
                    <th>المجموع</th>
                    <th style={{ width: '35%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {r.daily
                    .slice()
                    .reverse()
                    .map((d) => {
                      const t = Number(d.store) + Number(d.service)
                      return (
                        <tr key={d.d}>
                          <td>{dayLabel(d.d)}</td>
                          <td>{d.orders}</td>
                          <td>{sar(d.store)}</td>
                          <td>{sar(d.service)}</td>
                          <td>
                            <b>{sar(t)}</b>
                          </td>
                          <td>
                            <div className="bar" aria-hidden="true">
                              <i style={{ width: `${(t / maxDay) * 100}%` }} />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="two-col">
            <section className="card stack-sm">
              <b>التحصيل</b>
              <table className="mini">
                <tbody>
                  <tr>
                    <td>بطاقة (المتجر)</td>
                    <td>{sar(r.collections.store_card)}</td>
                  </tr>
                  <tr>
                    <td>بطاقة (الصيانة)</td>
                    <td>{sar(r.collections.service_card)}</td>
                  </tr>
                  <tr>
                    <td>نقد مع الفنيين (الصيانة)</td>
                    <td>{sar(r.collections.service_cash)}</td>
                  </tr>
                  <tr>
                    <td>
                      <b>عهد ما استلمناها للحين</b>
                    </td>
                    <td>
                      <b className={Number(r.collections.custody_open) > 0 ? 'warn-text' : undefined}>{sar(r.collections.custody_open)}</b>
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section className="card stack-sm">
              <b>الطلبات اللي انعملت في الفترة: {r.store.created}</b>
              <table className="mini">
                <tbody>
                  {Object.entries(r.store.by_status).map(([k, n]) => (
                    <tr key={k}>
                      <td>{ORDER_STATUS_LABELS[k as keyof typeof ORDER_STATUS_LABELS] ?? k}</td>
                      <td>{n}</td>
                    </tr>
                  ))}
                  {r.store.created === 0 && (
                    <tr>
                      <td className="muted">ما فيه طلبات.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            <section className="card stack-sm">
              <b>البلاغات الجديدة: {r.service.requests}</b>
              <table className="mini">
                <tbody>
                  <tr>
                    <td>أعطال طارئة</td>
                    <td>{r.service.emergency}</td>
                  </tr>
                  <tr>
                    <td>صيانة دورية</td>
                    <td>{r.service.maintenance}</td>
                  </tr>
                  <tr>
                    <td>ملغية</td>
                    <td>{r.service.cancelled}</td>
                  </tr>
                  <tr>
                    <td>العميل رفض العرض</td>
                    <td>{r.service.rejected_quotes}</td>
                  </tr>
                  <tr>
                    <td>العميل ما كان موجود</td>
                    <td>{r.service.customer_absent}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section className="card stack-sm">
              <b>أكثر المنتجات مبيعاً</b>
              {r.top_products.length === 0 ? (
                <span className="muted">ما فيه مبيعات في الفترة.</span>
              ) : (
                <table className="mini">
                  <tbody>
                    {r.top_products.map((p) => (
                      <tr key={p.sku}>
                        <td>{p.name}</td>
                        <td>× {p.qty}</td>
                        <td>{sar(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <span className="muted">المبالغ قبل الضريبة.</span>
            </section>

            {r.parts_used.length > 0 && (
              <section className="card stack-sm">
                <b>قطع انصرفت في الصيانة</b>
                <table className="mini">
                  <tbody>
                    {r.parts_used.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td>
                        <td>× {p.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        </div>
      )}
    </RequirePage>
  )
}
