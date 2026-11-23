import { Fragment, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RequirePage } from '../components/Layout'
import { changedFields, fieldLabel, recordFields, recordTitle, resolveNames, showValue, type AuditRow, type Names } from '../lib/auditText'
import { sar, when } from '../lib/service'
import { supabase } from '../lib/supabase'

type Row = AuditRow

const ENTITY_LABELS: Record<string, string> = {
  discount: 'تنبيه خصم',
  settings: 'الإعدادات',
  work_days: 'أيام العمل',
  service_neighborhoods: 'الأحياء',
  service_areas: 'مناطق الخدمة',
  customers: 'العملاء',
  addresses: 'العناوين',
  categories: 'التصنيفات',
  manufacturers: 'الشركات',
  products: 'المنتجات',
  product_costs: 'تكلفة المنتجات',
  product_images: 'صور المنتجات',
  filter_compatibility: 'توافق الفلاتر',
  bundle_items: 'مكونات الباقات',
  roles: 'الأدوار',
  role_permissions: 'الصلاحيات',
  staff_profiles: 'الموظفين',
  home_banners: 'البنرات',
  home_sections: 'أقسام الرئيسية',
  store_pages: 'صفحات المتجر',
  reviews: 'التقييمات',
  orders: 'الطلبات',
  payment_requests: 'محاولات الدفع',
  payments: 'مدفوعات المتجر',
  stock_movements: 'حركات المخزون',
  customer_devices: 'أجهزة العملاء',
  device_filters: 'فلاتر الأجهزة',
  service_requests: 'البلاغات',
  technicians: 'الفنيين',
  work_orders: 'أوامر العمل',
  custodies: 'العهد',
  approvals: 'الموافقات',
}
const ACTION_LABELS = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف' } as const

const cut = (s: string, n = 80) => (s.length > n ? s.slice(0, n) + '…' : s)

const PAGE = 100

/** «سجل التدقيق»: every change, who made it and when. Read only. */
export function AuditLog() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [refs, setRefs] = useState<Names>({})
  const [params] = useSearchParams()
  const [entity, setEntity] = useState(() => params.get('entity') ?? '')
  const [day, setDay] = useState('')
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    (before?: number) => {
      setError(null)
      let q = supabase.from('audit_log').select('*').order('id', { ascending: false }).limit(PAGE)
      if (entity) q = q.eq('entity', entity)
      if (day) {
        // A Mecca day (UTC+3).
        const start = new Date(`${day}T00:00:00+03:00`).toISOString()
        const end = new Date(new Date(`${day}T00:00:00+03:00`).getTime() + 86400000).toISOString()
        q = q.gte('created_at', start).lt('created_at', end)
      }
      if (before) q = q.lt('id', before)
      q.then(({ data, error: e }) => {
        if (e) return setError('تعذّر التحميل.')
        const list = (data ?? []) as Row[]
        setRows((old) => (before && old ? [...old, ...list] : list))
        setMore(list.length === PAGE)
      })
    },
    [entity, day],
  )
  useEffect(() => load(), [load])
  // Names for the ids in the rows (products, customers, orders…).
  useEffect(() => {
    if (!rows?.length) return
    let live = true
    resolveNames(rows, { ...names, ...refs }).then((n) => live && Object.keys(n).length && setRefs((old) => ({ ...old, ...n })))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])
  const all: Names = { ...refs, ...names }
  useEffect(() => {
    supabase
      .from('staff_profiles')
      .select('user_id, full_name')
      .then(({ data }) => setNames(Object.fromEntries(((data ?? []) as { user_id: string; full_name: string }[]).map((x) => [x.user_id, x.full_name]))))
  }, [])

  const who = (a: string | null) => (!a ? 'النظام أو الفني' : names[a] ?? (refs[a] ? `العميل ${refs[a]}` : 'عميل'))

  return (
    <RequirePage page="audit_log">
      <div className="ph">
        <div>
          <h1>سجل التدقيق</h1>
          <p>كل إضافة أو تعديل أو حذف، مين سواه ومتى. السجل ما ينحذف ولا يتعدل.</p>
        </div>
      </div>
      <div className="chips">
        <button type="button" className={entity === 'discount' ? 'on' : undefined} onClick={() => setEntity(entity === 'discount' ? '' : 'discount')}>
          تنبيهات الخصم
        </button>
      </div>
      <div className="row wrapr align-end">
        <div className="field">
          <label htmlFor="ae">القسم</label>
          <select id="ae" className="input" value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="">الكل</option>
            {Object.entries(ENTITY_LABELS)
              .sort((a, b) => a[1].localeCompare(b[1], 'ar'))
              .map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ad">اليوم</label>
          <input id="ad" type="date" className="input" value={day} onChange={(e) => setDay(e.target.value)} />
        </div>
        {(entity || day) && (
          <button
            className="btn ghost sm field-btn"
            onClick={() => {
              setEntity('')
              setDay('')
            }}
          >
            مسح الفلتر
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      {!rows ? (
        !error && <p className="muted">جاري التحميل…</p>
      ) : rows.length === 0 ? (
        <div className="notice">
          <b>ما فيه سجلات.</b>
        </div>
      ) : (
        <div className="card tw">
          <table>
            <thead>
              <tr>
                <th>الوقت</th>
                <th>مين</th>
                <th>العملية</th>
                <th>القسم</th>
                <th>التغيير</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ch = changedFields(r)
                const title = recordTitle(r, all)
                const da = r.entity === 'discount' ? (r.after as { number?: string; discount?: number; reason?: string; total?: number } | null) : null
                const summary = da
                  ? `خصم ${sar(da.discount ?? 0)} على ${da.number ?? ''} · ${da.reason ?? ''} · الإجمالي بعده ${sar(da.total ?? 0)}`
                  : r.action === 'UPDATE'
                    ? (title ? `«${cut(title, 40)}» · ` : '') +
                      (ch.length === 0
                        ? 'بدون تغيير يُذكر'
                        : ch
                            .slice(0, 2)
                            .map((c) => `${fieldLabel(c.key)}: ${cut(showValue(r.entity, c.key, c.from, all), 28)} ← ${cut(showValue(r.entity, c.key, c.to, all), 28)}`)
                            .join(' · ') + (ch.length > 2 ? ` (و${ch.length - 2} غيرها)` : ''))
                    : cut(title || (r.action === 'INSERT' ? 'سجل جديد' : 'سجل محذوف'), 70)
                return (
                  <Fragment key={r.id}>
                    <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                      <td>{when(r.created_at)}</td>
                      <td>{who(r.actor)}</td>
                      <td>
                        <span className={`badge ${r.action === 'DELETE' || da ? 'b-warn' : ''}`}>{da ? 'خصم' : ACTION_LABELS[r.action]}</span>
                      </td>
                      <td>{ENTITY_LABELS[r.entity] ?? r.entity}</td>
                      <td dir="auto" className={da ? undefined : 'muted'}>
                        {summary}
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr className="detail">
                        <td colSpan={5}>
                          {r.action === 'UPDATE' ? (
                            <table className="mini audit-diff">
                              <thead>
                                <tr>
                                  <th>الحقل</th>
                                  <th>قبل</th>
                                  <th>بعد</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ch.map((c) => (
                                  <tr key={c.key}>
                                    <td>{fieldLabel(c.key)}</td>
                                    <td dir="auto">{cut(showValue(r.entity, c.key, c.from, all), 200)}</td>
                                    <td dir="auto">{cut(showValue(r.entity, c.key, c.to, all), 200)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <table className="mini audit-diff">
                              <thead>
                                <tr>
                                  <th>الحقل</th>
                                  <th>{r.action === 'DELETE' ? 'كان' : 'القيمة'}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {recordFields(r).map((f) => (
                                  <tr key={f.key}>
                                    <td>{fieldLabel(f.key)}</td>
                                    <td dir="auto">{cut(showValue(r.entity, f.key, f.value, all), 200)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {more && (
            <button className="btn ghost sm" onClick={() => load(rows[rows.length - 1].id)}>
              عرض أقدم
            </button>
          )}
        </div>
      )}
    </RequirePage>
  )
}
