import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  OPEN_SERVICE_STATUSES,
  SERVICE_KIND_LABELS,
  SERVICE_STATUS_LABELS,
  daysUntil,
  filterUsage,
  productPath,
  serviceErrorMessage,
  type DeviceFilter,
  type ServiceRequest,
} from '@ghaith/shared'
import { fetchSettings } from '../lib/catalog'
import { formatDate } from '../lib/orders'
import { fetchMyDevicesFull, fetchMyRequests, riyadhDate, snoozeMyDevice, type MyDeviceFull } from '../lib/service'
import { usePageMeta } from '../lib/seo'
import { useAsync } from '../lib/useAsync'

async function load() {
  const [devices, requests, settings] = await Promise.all([fetchMyDevicesFull(), fetchMyRequests(), fetchSettings()])
  return { devices, requests, alertDays: settings.maintenance_alert_days }
}

function FilterBar({ f, alertDays }: { f: DeviceFilter; alertDays: number }) {
  const used = filterUsage(f)
  const left = daysUntil(f.next_due_on)
  const tone = left < 0 ? 'bad' : left <= alertDays ? 'warn' : 'ok'
  return (
    <li className="fbar">
      <div className="row between wrapr">
        <span>{f.name_ar}</span>
        <span className={`muted fbar-due ${tone}`}>
          {left < 0 ? `متأخر ${-left} يوم` : left === 0 ? 'موعد تغييره اليوم' : `يتغيّر ${formatDate(f.next_due_on)}`}
        </span>
      </div>
      <div
        className={`fbar-track ${tone}`}
        role="meter"
        aria-label={`استهلاك ${f.name_ar}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(used, 100)}
      >
        <span style={{ width: `${Math.min(used, 100)}%` }} />
      </div>
      <small className="muted">
        آخر تغيير {formatDate(f.last_changed_on)} · عمره {f.life_months} {f.life_months > 10 ? 'شهر' : 'أشهر'} · مستهلك {Math.min(used, 100)}٪
      </small>
    </li>
  )
}

const SNOOZE = [
  { days: 14, label: 'أسبوعين' },
  { days: 30, label: 'شهر' },
  { days: 60, label: 'شهرين' },
]

function DeviceCard({ d, open, alertDays, onChange }: { d: MyDeviceFull; open: ServiceRequest | undefined; alertDays: number; onChange: () => void }) {
  const [snoozing, setSnoozing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = riyadhDate()
  const nextDue = d.filters[0]?.next_due_on
  const dueSoon = nextDue !== undefined && daysUntil(nextDue) <= alertDays
  const snoozed = d.next_contact_on && d.next_contact_on > today

  async function snooze(days: number) {
    setBusy(true)
    setError(null)
    try {
      await snoozeMyDevice(d.id, riyadhDate(days))
      setSnoozing(false)
      onChange()
    } catch (e) {
      setError(serviceErrorMessage((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card stack-sm device-card">
      <div className="row between wrapr">
        <div className="stack-sm">
          <b>{d.product ? <Link to={productPath(d.product)}>{d.name_ar}</Link> : d.name_ar}</b>
          <span className="muted">
            {d.model && <span dir="ltr">{d.model} · </span>}
            {d.installed ? 'ركّبناه' : 'استلمته'} في {formatDate(d.started_on)}
            {d.date_uncertain && ' (تقريبي)'}
          </span>
        </div>
        <div className="stack-sm end">
          {d.warranty_until ? (
            d.warranty_until >= today ? (
              <span className="tag ok">بالضمان لين {formatDate(d.warranty_until)}</span>
            ) : (
              <span className="tag off">انتهى الضمان</span>
            )
          ) : null}
          {d.order_id && (
            <Link to={`/orders/${d.order_id}`} className="link">
              الطلب
            </Link>
          )}
        </div>
      </div>

      {d.filters.length > 0 ? (
        <ul className="fbars">
          {d.filters.map((f) => (
            <FilterBar key={f.id} f={f} alertDays={alertDays} />
          ))}
        </ul>
      ) : (
        <p className="muted">ما عندنا بيانات فلاتر هذا الجهاز بعد. نضيفها في أول زيارة صيانة.</p>
      )}

      {open ? (
        <p className="notice">
          <b>
            {SERVICE_KIND_LABELS[open.kind]} {open.request_number}: {SERVICE_STATUS_LABELS[open.status]}
          </b>
          <Link to="/service" className="link">
            تفاصيل الطلب
          </Link>
        </p>
      ) : (
        <>
          {dueSoon && !snoozed && <p className="notice warn">حان وقت تغيير الفلاتر. احجز زيارة صيانة ونتواصل معك لتأكيد الموعد.</p>}
          {snoozed && <p className="muted">أجّلت تذكير الصيانة لين {formatDate(d.next_contact_on!)}.</p>}
          <div className="row wrapr">
            <Link to={`/service/new?kind=maintenance&device=${d.id}`} className={`btn sm${dueSoon ? '' : ' ghost'}`}>
              احجز صيانة
            </Link>
            <Link to={`/service/new?kind=emergency&device=${d.id}`} className="btn sm ghost">
              بلّغ عن عطل
            </Link>
            {dueSoon && !snoozed && !snoozing && (
              <button type="button" className="linkbtn" onClick={() => setSnoozing(true)}>
                أجّل التذكير
              </button>
            )}
          </div>
          {snoozing && (
            <div className="row wrapr">
              <span className="muted">ذكّرني بعد:</span>
              <div className="seg">
                {SNOOZE.map((s) => (
                  <button key={s.days} type="button" disabled={busy} onClick={() => snooze(s.days)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <button type="button" className="linkbtn" onClick={() => setSnoozing(false)}>
                تراجع
              </button>
            </div>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** «أجهزتي»: the customer's devices, their filters and maintenance. */
export function Devices() {
  usePageMeta('أجهزتي')
  const { state, reload } = useAsync(load)

  return (
    <div className="stack narrow">
      <div className="row between wrapr">
        <h1 className="page-h">أجهزتي</h1>
        <div className="row wrapr">
          <Link to="/service" className="link">
            طلبات الصيانة
          </Link>
          <Link to="/orders" className="link">
            طلباتي
          </Link>
        </div>
      </div>
      {state.status === 'loading' && <p className="muted">جاري التحميل…</p>}
      {state.status === 'error' && (
        <div className="notice bad" role="alert">
          <b>تعذّر تحميل أجهزتك.</b>
          <button className="btn sm" onClick={reload}>
            إعادة المحاولة
          </button>
        </div>
      )}
      {state.status === 'success' && state.data.devices.length === 0 && (
        <div className="notice">
          <b>ما عندك أجهزة مسجلة بعد.</b>
          <span className="muted">
            لما يوصلك جهاز أو نركّبه لك يظهر هنا، ومعه مواعيد صيانته وفلاتره. عندك جهاز قديم منّا؟ اتصل بنا ونضيفه لك.
          </span>
          <Link to="/service/new?kind=emergency" className="btn sm self-start">
            بلّغ عن عطل
          </Link>
        </div>
      )}
      {state.status === 'success' &&
        state.data.devices.map((d) => (
          <DeviceCard
            key={d.id}
            d={d}
            alertDays={state.data.alertDays}
            open={state.data.requests.find((r) => r.device_id === d.id && OPEN_SERVICE_STATUSES.includes(r.status))}
            onChange={reload}
          />
        ))}
    </div>
  )
}
