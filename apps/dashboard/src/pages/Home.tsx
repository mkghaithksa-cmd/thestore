import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { STAFF_PAGES, type StaffPage } from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { sar } from '../lib/service'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

interface Summary {
  today: string
  sales?: { store_today: number; store_month: number; service_today: number; service_month: number }
  orders?: { to_prepare: number; in_progress: number; awaiting_payment: number }
  visits?: { today: number; unscheduled: number; emergency_unscheduled: number }
  cash?: { custody_amount: number; custody_count: number; approvals_pending: number }
  stock?: { low_count: number; out_count: number; items: { name: string; on_hand: number }[] }
  discounts?: { today_count: number; today_amount: number; week_count: number; week_amount: number }
}

/** The manager's morning: five numbers, each linking to its page. */
export function Home() {
  const { me } = useStaffAuth()
  const [s, setS] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setError(null)
    supabase.rpc('dashboard_summary').then(({ data, error: e }) => {
      if (e) return setError('تعذّر تحميل الأرقام.')
      setS(data as Summary)
    })
  }, [])
  useEffect(load, [load])

  return (
    <RequirePage page="dashboard">
      <div className="ph">
        <div>
          <h1>أهلاً {me?.profile.full_name}</h1>
          <p>
            دورك: {me?.roleName}
            {s ? ` · ${new Date(s.today).toLocaleDateString('ar-SA-u-nu-latn-ca-gregory', { weekday: 'long', day: 'numeric', month: 'long' })}` : ''}
          </p>
        </div>
        <button className="btn ghost sm" onClick={load}>
          تحديث
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      {!s ? (
        !error && <p className="muted">جاري التحميل…</p>
      ) : (
        <div className="kpis">
          {s.sales && (
            <Link to="/p/reports" className="kpi">
              <span>المبيعات اليوم</span>
              <b>{sar(Number(s.sales.store_today) + Number(s.sales.service_today))}</b>
              <small>
                المتجر {sar(s.sales.store_today)} · الصيانة {sar(s.sales.service_today)}
              </small>
              <small>هذا الشهر {sar(Number(s.sales.store_month) + Number(s.sales.service_month))}</small>
            </Link>
          )}
          {s.orders && (
            <Link to="/p/orders" className={`kpi${s.orders.to_prepare ? ' warn' : ''}`}>
              <span>طلبات تحتاج تجهيز</span>
              <b>{s.orders.to_prepare}</b>
              <small>قيد التجهيز أو الشحن أو التركيب: {s.orders.in_progress}</small>
              <small>تنتظر دفع العميل: {s.orders.awaiting_payment}</small>
            </Link>
          )}
          {s.visits && (
            <Link to="/p/appointments" className={`kpi${s.visits.emergency_unscheduled ? ' warn' : ''}`}>
              <span>زيارات اليوم</span>
              <b>{s.visits.today}</b>
              <small>بلاغات بدون موعد: {s.visits.unscheduled}</small>
              {s.visits.emergency_unscheduled > 0 && <small className="warn-text">منها طارئة: {s.visits.emergency_unscheduled}</small>}
            </Link>
          )}
          {s.cash && (
            <Link to={s.cash.approvals_pending ? '/approvals' : '/p/payments'} className={`kpi${s.cash.approvals_pending ? ' warn' : ''}`}>
              <span>فلوس عند الفنيين</span>
              <b>{sar(s.cash.custody_amount)}</b>
              <small>عهد مفتوحة: {s.cash.custody_count}</small>
              <small>موافقات تنتظر: {s.cash.approvals_pending}</small>
            </Link>
          )}
          {s.stock && (
            <Link to="/p/inventory" className={`kpi${s.stock.out_count ? ' warn' : ''}`}>
              <span>منتجات خلصت أو قربت</span>
              <b>{s.stock.low_count}</b>
              <small>خلصت: {s.stock.out_count}</small>
              {s.stock.items.length > 0 && (
                <small>
                  {s.stock.items
                    .slice(0, 3)
                    .map((i) => i.name)
                    .join('، ')}
                  {s.stock.items.length > 3 ? '…' : ''}
                </small>
              )}
            </Link>
          )}
          {s.discounts && (
            <Link to="/p/audit_log?entity=discount" className={`kpi${s.discounts.today_count ? ' warn' : ''}`}>
              <span>خصومات اليوم</span>
              <b>{s.discounts.today_count}</b>
              <small>بمبلغ {sar(s.discounts.today_amount)}</small>
              <small>
                آخر 7 أيام: {s.discounts.week_count} · {sar(s.discounts.week_amount)}
              </small>
            </Link>
          )}
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
