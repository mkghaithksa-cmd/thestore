import { Link } from 'react-router-dom'
import { productPath } from '@ghaith/shared'
import { fetchMyDevices, formatDate } from '../lib/orders'
import { usePageMeta } from '../lib/seo'
import { useAsync } from '../lib/useAsync'

/** «أجهزتي»: devices delivered or installed from the customer's orders. Filters and maintenance come next. */
export function Devices() {
  usePageMeta('أجهزتي')
  const { state, reload } = useAsync(fetchMyDevices)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="stack narrow">
      <div className="row between wrapr">
        <h1 className="page-h">أجهزتي</h1>
        <Link to="/orders" className="link">
          طلباتي
        </Link>
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
      {state.status === 'success' && state.data.length === 0 && (
        <div className="notice">
          <b>ما عندك أجهزة مسجلة بعد.</b>
          <span className="muted">لما يوصلك جهاز أو نركّبه لك يظهر هنا، ومعه مواعيد صيانته وفلاتره.</span>
        </div>
      )}
      {state.status === 'success' &&
        state.data.map((d) => (
          <div key={d.id} className="card order-row">
            <div className="stack-sm">
              <b>{d.product ? <Link to={productPath(d.product)}>{d.name_ar}</Link> : d.name_ar}</b>
              <span className="muted">
                {d.installed ? 'ركّبناه' : 'استلمته'} في {formatDate(d.started_on)}
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
        ))}
    </div>
  )
}
