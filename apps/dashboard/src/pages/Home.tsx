import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { SERVICE_STATUS_LABELS, STAFF_PAGES, type ServiceStatus, type StaffPage } from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { sar } from '../lib/service'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'
import { SalesChart, type ChartDay } from '../components/SalesChart'

interface Summary {
  today: string
  sales?: { store_today: number; store_month: number; service_today: number; service_month: number }
  orders?: { to_prepare: number; in_progress: number; awaiting_payment: number }
  visits?: { today: number; unscheduled: number; emergency_unscheduled: number }
  cash?: { custody_amount: number; custody_count: number; approvals_pending: number }
  stock?: { low_count: number; out_count: number; items: { name: string; on_hand: number }[] }
  discounts?: { today_count: number; today_amount: number; week_count: number; week_amount: number }
}

interface HomeData {
  chart?: { days: ChartDay[]; month_to_date: number; prev_month_to_date: number }
  visits?: { id: string; number: string; kind: 'emergency' | 'maintenance'; status: ServiceStatus; at: string; name: string; area: string | null; technician: string | null }[]
  actions: { key: ActionKey; n: number; level: 'bad' | 'warn' | 'info'; to: string }[]
  activity?: { id: number; at: string; action: 'INSERT' | 'UPDATE' | 'DELETE'; entity: string; who: string | null; status: string | null; label: string | null; discount: number | null }[]
  technicians?: { name: string; closed: number; cash: number; holding: number }[]
}

type ActionKey = 'emergency' | 'unscheduled' | 'late_visits' | 'orders_to_prepare' | 'quotes_to_price' | 'quotes_waiting' | 'paid_not_closed' | 'old_custody' | 'approvals'

const ACTION_TEXT: Record<ActionKey, (n: number) => string> = {
  emergency: (n) => `${n} بلاغ طارئ بدون موعد`,
  unscheduled: (n) => `${n} طلب صيانة بدون موعد`,
  late_visits: (n) => `${n} زيارة فات وقتها وما بدأت`,
  orders_to_prepare: (n) => `${n} طلب مدفوع ينتظر التجهيز`,
  quotes_to_price: (n) => `${n} تقرير فني ينتظر عرض السعر`,
  quotes_waiting: (n) => `${n} عرض سعر ينتظر رد العميل من أكثر من يوم`,
  paid_not_closed: (n) => `${n} أمر عمل مدفوع ما انقفل`,
  old_custody: (n) => `${n} عهدة عند الفني من أكثر من يوم`,
  approvals: (n) => `${n} طلب ينتظر موافقتك`,
}

const ENTITY_TEXT: Record<string, string> = {
  orders: 'طلب',
  service_requests: 'بلاغ',
  work_orders: 'أمر عمل',
  products: 'منتج',
  customers: 'عميل',
  custodies: 'عهدة',
  approvals: 'موافقة',
  payments: 'دفعة',
  technicians: 'فني',
  settings: 'الإعدادات',
  reviews: 'تقييم',
  staff_profiles: 'موظف',
  categories: 'تصنيف',
  home_banners: 'بنر',
  home_sections: 'الصفحة الرئيسية',
  customer_devices: 'جهاز عميل',
  discount: 'خصم',
}
const ACTION_TEXT_AR = { INSERT: 'أضاف', UPDATE: 'عدّل', DELETE: 'حذف' } as const

const time = (iso: string) => new Date(iso).toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' })
function ago(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'الحين'
  if (m < 60) return `قبل ${m} د`
  const h = Math.round(m / 60)
  if (h < 24) return `قبل ${h} س`
  const d = Math.round(h / 24)
  return d === 1 ? 'أمس' : `قبل ${d} أيام`
}
function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Riyadh' }).format(new Date()))
  return h < 12 ? 'صباح الخير' : 'مساء الخير'
}

/* Small line icons (24px grid, 1.8 stroke) so the tiles read at a glance. */
const ICONS: Record<string, ReactNode> = {
  money: <path d="M3 7h18v10H3zM7 12h.01M17 12h.01M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />,
  box: <path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8" />,
  calendar: <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />,
  wallet: <path d="M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3zM3 7V5h13v2M16 13h2" />,
  alert: <path d="M12 3l10 18H2zM12 10v5M12 18h.01" />,
  tag: <path d="M3 12V3h9l9 9-9 9zM7.5 7.5h.01" />,
  phone: <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  truck: <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" />,
}
function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="ic" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

function Tile({ to, icon, label, value, sub, tone, children }: { to: string; icon: keyof typeof ICONS; label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' | 'bad'; children?: ReactNode }) {
  return (
    <Link to={to} className={`tile${tone ? ` ${tone}` : ''}`}>
      <span className="tile-top">
        <span className="tile-ic">
          <Icon name={icon} />
        </span>
        {label}
      </span>
      <b className="tile-val">{value}</b>
      {sub && <span className="tile-sub">{sub}</span>}
      {children}
    </Link>
  )
}

/** The staff home: quick actions, today's numbers, the sales chart, what needs doing. */
export function Home() {
  const { me, can } = useStaffAuth()
  const [s, setS] = useState<Summary | null>(null)
  const [h, setH] = useState<HomeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setBusy(true)
    setError(null)
    Promise.all([supabase.rpc('dashboard_summary'), supabase.rpc('dashboard_home')]).then(([a, b]) => {
      setBusy(false)
      if (a.error || b.error) return setError('تعذّر تحميل الأرقام.')
      setS(a.data as Summary)
      setH(b.data as HomeData)
    })
  }, [])
  useEffect(load, [load])

  const sales = s?.sales
  const todaySales = sales ? Number(sales.store_today) + Number(sales.service_today) : 0
  const mtd = h?.chart ? Number(h.chart.month_to_date) : 0
  const prev = h?.chart ? Number(h.chart.prev_month_to_date) : 0
  const change = prev > 0 ? Math.round(((mtd - prev) / prev) * 100) : null

  return (
    <RequirePage page="dashboard">
      <div className="home-head">
        <div>
          <h1>
            {greeting()}، {me?.profile.full_name}
          </h1>
          <p className="muted">
            {s ? new Date(`${s.today}T12:00:00Z`).toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : ''}
            {me?.roleName ? ` · ${me.roleName}` : ''}
          </p>
        </div>
        <div className="quick">
          {can('appointments', 'add') && (
            <Link to="/p/appointments?tab=phone" className="btn sm">
              <Icon name="phone" /> بلاغ هاتفي
            </Link>
          )}
          {can('inventory', 'add') && (
            <Link to="/p/inventory" className="btn sec sm">
              <Icon name="truck" /> استلام بضاعة
            </Link>
          )}
          {can('catalog', 'add') && (
            <Link to="/catalog/new" className="btn sec sm">
              <Icon name="plus" /> منتج جديد
            </Link>
          )}
          <button className="btn ghost sm" onClick={load} disabled={busy} aria-label="تحديث">
            <Icon name="refresh" />
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}
      {!s || !h ? (
        !error && <p className="muted">جاري التحميل…</p>
      ) : (
        <div className={`home${busy ? ' dim' : ''}`}>
          <div className="tiles">
            {sales && (
              <Tile to="/p/reports" icon="money" label="مبيعات اليوم" value={sar(todaySales)} sub={`المتجر ${sar(sales.store_today)} · الصيانة ${sar(sales.service_today)}`}>
                <span className="tile-sub">
                  الشهر {sar(Number(sales.store_month) + Number(sales.service_month))}
                  {change !== null && (
                    <span className={`trend ${change >= 0 ? 'up' : 'down'}`}>
                      {change >= 0 ? '▲' : '▼'} {Math.abs(change)}٪ عن الشهر الماضي
                    </span>
                  )}
                </span>
              </Tile>
            )}
            {s.orders && (
              <Tile to="/p/orders" icon="box" label="طلبات تحتاج تجهيز" value={s.orders.to_prepare} tone={s.orders.to_prepare ? 'warn' : undefined} sub={`قيد التجهيز أو الشحن: ${s.orders.in_progress} · تنتظر الدفع: ${s.orders.awaiting_payment}`} />
            )}
            {s.visits && (
              <Tile
                to="/p/appointments?f=today"
                icon="calendar"
                label="زيارات اليوم"
                value={s.visits.today}
                tone={s.visits.emergency_unscheduled ? 'bad' : s.visits.unscheduled ? 'warn' : undefined}
                sub={s.visits.unscheduled ? `بدون موعد: ${s.visits.unscheduled}${s.visits.emergency_unscheduled ? ` (طارئة ${s.visits.emergency_unscheduled})` : ''}` : 'كل البلاغات لها موعد'}
              />
            )}
            {s.cash && (
              <Tile to="/p/payments" icon="wallet" label="فلوس عند الفنيين" value={sar(s.cash.custody_amount)} tone={s.cash.approvals_pending ? 'warn' : undefined} sub={`عهد مفتوحة: ${s.cash.custody_count} · موافقات: ${s.cash.approvals_pending}`} />
            )}
            {s.stock && (
              <Tile
                to="/p/inventory"
                icon="alert"
                label="منتجات خلصت أو قربت"
                value={s.stock.low_count}
                tone={s.stock.out_count ? 'bad' : s.stock.low_count ? 'warn' : undefined}
                sub={s.stock.items.length ? s.stock.items.slice(0, 2).map((i) => i.name).join('، ') + (s.stock.items.length > 2 ? '…' : '') : 'المخزون تمام'}
              />
            )}
            {s.discounts && (
              <Tile to="/p/audit_log?entity=discount" icon="tag" label="خصومات اليوم" value={s.discounts.today_count} tone={s.discounts.today_count ? 'warn' : undefined} sub={`${sar(s.discounts.today_amount)} · آخر 7 أيام ${s.discounts.week_count}`} />
            )}
          </div>

          <div className="home-grid">
            {h.chart && (
              <section className="card stack-sm span-2">
                <div className="row between wrapr">
                  <b>المبيعات آخر 30 يوم</b>
                  <Link to="/p/reports" className="link">
                    التفاصيل في التقارير
                  </Link>
                </div>
                <SalesChart days={h.chart.days} />
              </section>
            )}

            <section className="card stack-sm">
              <b>يحتاج إجراء</b>
              {h.actions.length === 0 ? (
                <div className="empty-ok">✓ ما فيه شي متأخر. كل شي ماشي.</div>
              ) : (
                <ul className="actions">
                  {h.actions.map((a) => (
                    <li key={a.key}>
                      <Link to={a.to} className={`act-${a.level}`}>
                        <span className="dot" aria-hidden="true" />
                        <span>{ACTION_TEXT[a.key](a.n)}</span>
                        <span className="go" aria-hidden="true">
                          ‹
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {h.visits && (
              <section className="card stack-sm span-2">
                <div className="row between wrapr">
                  <b>زيارات اليوم ({h.visits.length})</b>
                  <Link to="/p/appointments?f=today" className="link">
                    كل المواعيد
                  </Link>
                </div>
                {h.visits.length === 0 ? (
                  <span className="muted">ما فيه زيارات اليوم.</span>
                ) : (
                  <div className="tw">
                    <table>
                      <thead>
                        <tr>
                          <th>الساعة</th>
                          <th>العميل</th>
                          <th>الحي</th>
                          <th>الفني</th>
                          <th>الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {h.visits.map((v) => (
                          <tr key={v.id}>
                            <td>
                              <Link to={`/p/appointments?sr=${v.id}`} className="link">
                                {time(v.at)}
                              </Link>
                              {v.kind === 'emergency' && <span className="badge b-warn sm-badge">طارئ</span>}
                            </td>
                            <td>{v.name}</td>
                            <td>{v.area ?? '—'}</td>
                            <td>{v.technician ?? <span className="warn-text">بدون فني</span>}</td>
                            <td>
                              <span className={`badge ${v.status === 'done' ? 'b-ok' : v.status === 'in_progress' ? 'b-info' : ''}`}>{SERVICE_STATUS_LABELS[v.status]}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {h.technicians && (
              <section className="card stack-sm">
                <b>الفنيين هذا الشهر</b>
                {h.technicians.length === 0 ? (
                  <span className="muted">ما فيه فنيين. أضفهم من الإعدادات.</span>
                ) : (
                  <table className="mini techs">
                    <thead>
                      <tr>
                        <th>الفني</th>
                        <th>زيارات</th>
                        <th>حصّل نقد</th>
                        <th>عنده الحين</th>
                      </tr>
                    </thead>
                    <tbody>
                      {h.technicians.map((t) => (
                        <tr key={t.name}>
                          <td>{t.name}</td>
                          <td>{t.closed}</td>
                          <td>{sar(t.cash)}</td>
                          <td className={Number(t.holding) > 0 ? 'warn-text' : undefined}>{sar(t.holding)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            {h.activity && (
              <section className="card stack-sm span-3">
                <div className="row between wrapr">
                  <b>آخر النشاطات</b>
                  <Link to="/p/audit_log" className="link">
                    سجل التدقيق
                  </Link>
                </div>
                <ul className="activity">
                  {h.activity.map((a) => (
                    <li key={a.id}>
                      <span className={`dot ${a.entity === 'discount' ? 'warn' : a.action === 'DELETE' ? 'bad' : ''}`} aria-hidden="true" />
                      <span className="grow">
                        <b>{a.who ?? 'النظام أو الفني'}</b>{' '}
                        {a.entity === 'discount'
                          ? `أعطى خصم ${sar(a.discount ?? 0)} على ${a.label ?? ''}`
                          : `${ACTION_TEXT_AR[a.action]} ${ENTITY_TEXT[a.entity] ?? a.entity}${a.label ? ` ${a.label}` : ''}`}
                      </span>
                      <span className="muted">{ago(a.at)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      )}
    </RequirePage>
  )
}

/** Placeholder for pages built in later days. */
export function ComingSoon() {
  const { page } = useParams()
  const meta = STAFF_PAGES.find((p) => p.key === page)
  if (!meta) return <div className="notice">الصفحة غير موجودة.</div>
  return (
    <RequirePage page={meta.key as StaffPage}>
      <div className="ph">
        <h1>{meta.label}</h1>
      </div>
      <div className="notice">
        <b>هذه الصفحة تُبنى في الأيام القادمة من الخطة.</b>
      </div>
    </RequirePage>
  )
}
