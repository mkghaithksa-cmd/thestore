import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { effectiveStatus } from '@ghaith/shared'
import { formatSar } from '../lib/catalog'
import { fetchOrder, fetchPaymentRequest, formatDate, verifyPayment } from '../lib/orders'
import { usePageMeta } from '../lib/seo'
import { verifyServicePayment } from '../lib/service'
import { supabase } from '../lib/supabase'
import { useAsync } from '../lib/useAsync'

// Moyasar's own payment form (card details go straight to Moyasar, never to us).
const MOYASAR = 'https://cdn.moyasar.com/mpf/1.15.0/moyasar'
const PUBLISHABLE_KEY = import.meta.env.VITE_MOYASAR_PUBLISHABLE_KEY ?? ''

interface MoyasarGlobal {
  init(options: Record<string, unknown>): void
}
declare global {
  interface Window {
    Moyasar?: MoyasarGlobal
  }
}

let loading: Promise<MoyasarGlobal> | null = null
function loadMoyasar(): Promise<MoyasarGlobal> {
  if (window.Moyasar) return Promise.resolve(window.Moyasar)
  loading ??= new Promise((resolve, reject) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `${MOYASAR}.css`
    document.head.appendChild(css)
    const js = document.createElement('script')
    js.src = `${MOYASAR}.js`
    js.onload = () => (window.Moyasar ? resolve(window.Moyasar) : reject(new Error('moyasar')))
    js.onerror = () => {
      loading = null
      reject(new Error('moyasar'))
    }
    document.head.appendChild(js)
  })
  return loading
}

async function load(id: string) {
  const [data, request] = await Promise.all([fetchOrder(id), fetchPaymentRequest(id)])
  return data ? { ...data, request } : null
}

/** /orders/:id/pay — Moyasar's form for the order's exact amount. */
export function PayPage() {
  usePageMeta('الدفع')
  const { id = '' } = useParams()
  const { state, reload } = useAsync(() => load(id), [id])
  const box = useRef<HTMLDivElement>(null)
  const [formError, setFormError] = useState(false)

  const ready = state.status === 'success' && state.data && state.data.request && effectiveStatus(state.data.order) === 'pending_payment'
  const amount = state.status === 'success' ? state.data?.request?.amount_halalas : undefined
  const orderNumber = state.status === 'success' ? state.data?.order.order_number : undefined
  const requestId = state.status === 'success' ? state.data?.request?.id : undefined

  useEffect(() => {
    if (!ready || !box.current || !PUBLISHABLE_KEY) return
    let live = true
    loadMoyasar()
      .then((m) => {
        if (!live || !box.current) return
        box.current.innerHTML = ''
        m.init({
          element: box.current,
          amount,
          currency: 'SAR',
          description: `طلب ${orderNumber} - تنقية غيث`,
          publishable_api_key: PUBLISHABLE_KEY,
          callback_url: `${window.location.origin}/orders/${id}/paid`,
          methods: ['creditcard'],
          supported_networks: ['mada', 'visa', 'mastercard'],
          language: 'ar',
          metadata: { order_id: id, payment_request_id: requestId, order_number: orderNumber },
        })
      })
      .catch(() => live && setFormError(true))
    return () => {
      live = false
    }
  }, [ready, amount, orderNumber, requestId, id])

  if (state.status === 'loading') return <p className="muted">جاري التحميل…</p>
  if (state.status === 'error') {
    return (
      <div className="notice bad" role="alert">
        <b>تعذّر تحميل صفحة الدفع.</b>
        <button className="btn sm" onClick={reload}>
          إعادة المحاولة
        </button>
      </div>
    )
  }
  if (!state.data) return <Navigate to="/orders" replace />
  const { order: o } = state.data
  if (effectiveStatus(o) !== 'pending_payment' || !state.data.request) return <Navigate to={`/orders/${o.id}`} replace />

  return (
    <div className="stack narrow">
      <h1 className="page-h">الدفع</h1>
      <div className="card stack-sm">
        <div className="row between">
          <span>
            الطلب <b dir="ltr">{o.order_number}</b>
          </span>
          <b>{formatSar(Number(o.total))}</b>
        </div>
        <span className="muted">شامل الضريبة. الطلب محجوز لك لين {formatDate(o.expires_at, true)}.</span>
      </div>
      {!PUBLISHABLE_KEY ? (
        <p className="notice warn">الدفع الإلكتروني غير متاح حالياً. تواصل معنا لإتمام الدفع.</p>
      ) : formError ? (
        <div className="notice bad" role="alert">
          <b>تعذّر تحميل نموذج الدفع.</b>
          <button className="btn sm" onClick={() => window.location.reload()}>
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <div className="card pay-box">
          <div ref={box} className="mysr-form" />
        </div>
      )}
      <p className="muted center">الدفع آمن عن طريق ميسر. بيانات بطاقتك تروح لميسر مباشرة وما نشوفها ولا نحفظها.</p>
      <Link to={`/orders/${o.id}`} className="link center">
        الرجوع للطلب
      </Link>
    </div>
  )
}

/** /orders/:id/paid — Moyasar sends the customer back here; the server checks the payment. */
export function PaidPage() {
  usePageMeta('نتيجة الدفع')
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const paymentId = params.get('id') ?? ''
  const [result, setResult] = useState<{ status: string; message?: string | null; error?: string } | null>(null)

  useEffect(() => {
    if (!paymentId) return
    let live = true
    verifyPayment(id, paymentId).then((r) => {
      if (!live) return
      setResult(r)
      if (r.status === 'paid') navigate(`/orders/${id}?paid=1`, { replace: true })
    })
    return () => {
      live = false
    }
  }, [id, paymentId, navigate])

  if (!paymentId) return <Navigate to={`/orders/${id}`} replace />
  if (!result) return <p className="muted">نتأكد من الدفع مع ميسر…</p>

  if (result.status === 'failed') {
    return (
      <div className="stack narrow">
        <div className="notice bad" role="alert">
          <b>ما تم الدفع.</b>
          <span>{result.message || 'رفض البنك العملية.'} ما انخصم منك شي، وتقدر تحاول مرة ثانية.</span>
        </div>
        <Link to={`/orders/${id}/pay`} className="btn self-start">
          حاول مرة ثانية
        </Link>
      </div>
    )
  }
  return (
    <div className="stack narrow">
      <div className="notice" role="status">
        <b>استلمنا عملية الدفع ونتأكد منها.</b>
        <span>يتحدّث طلبك خلال دقائق. إذا انخصم المبلغ وما تحدّث الطلب، تواصل معنا ونرتبه لك.</span>
      </div>
      <Link to={`/orders/${id}`} className="btn self-start">
        عرض الطلب
      </Link>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Paying a work order (repair quote, or the inspection fee)
// ---------------------------------------------------------------------------
async function loadWo(id: string) {
  const { data, error } = await supabase.from('work_orders').select('id, number, status, amount_due').eq('id', id).maybeSingle()
  if (error) throw error
  return data as { id: string; number: string; status: string; amount_due: number } | null
}

/** /service/pay/:id — Moyasar's form for the amount due on a work order. */
export function ServicePayPage() {
  usePageMeta('دفع الصيانة')
  const { id = '' } = useParams()
  const { state, reload } = useAsync(() => loadWo(id), [id])
  const box = useRef<HTMLDivElement>(null)
  const [formError, setFormError] = useState(false)
  const w = state.status === 'success' ? state.data : null
  const ready = !!w && w.status === 'payment' && Number(w.amount_due) > 0
  const amount = w ? Math.round(Number(w.amount_due) * 100) : 0
  const number = w?.number

  useEffect(() => {
    if (!ready || !box.current || !PUBLISHABLE_KEY) return
    let live = true
    loadMoyasar()
      .then((m) => {
        if (!live || !box.current) return
        box.current.innerHTML = ''
        m.init({
          element: box.current,
          amount,
          currency: 'SAR',
          description: `صيانة ${number} - تنقية غيث`,
          publishable_api_key: PUBLISHABLE_KEY,
          callback_url: `${window.location.origin}/service/paid/${id}`,
          methods: ['creditcard'],
          supported_networks: ['mada', 'visa', 'mastercard'],
          language: 'ar',
          metadata: { work_order_id: id, work_order_number: number },
        })
      })
      .catch(() => live && setFormError(true))
    return () => {
      live = false
    }
  }, [ready, amount, number, id])

  if (state.status === 'loading') return <p className="muted">جاري التحميل…</p>
  if (state.status === 'error') {
    return (
      <div className="notice bad" role="alert">
        <b>تعذّر تحميل صفحة الدفع.</b>
        <button className="btn sm" onClick={reload}>
          إعادة المحاولة
        </button>
      </div>
    )
  }
  if (!w || !ready) return <Navigate to="/service" replace />

  return (
    <div className="stack narrow">
      <h1 className="page-h">دفع الصيانة</h1>
      <div className="card stack-sm">
        <div className="row between">
          <span>
            أمر العمل <b dir="ltr">{w.number}</b>
          </span>
          <b>{formatSar(Number(w.amount_due))}</b>
        </div>
        <span className="muted">شامل الضريبة.</span>
      </div>
      {!PUBLISHABLE_KEY ? (
        <p className="notice warn">الدفع الإلكتروني غير متاح حالياً. تقدر تدفع نقداً للفني.</p>
      ) : formError ? (
        <div className="notice bad" role="alert">
          <b>تعذّر تحميل نموذج الدفع.</b>
          <button className="btn sm" onClick={() => window.location.reload()}>
            إعادة المحاولة
          </button>
        </div>
      ) : (
        <div className="card pay-box">
          <div ref={box} className="mysr-form" />
        </div>
      )}
      <p className="muted center">الدفع آمن عن طريق ميسر. بيانات بطاقتك تروح لميسر مباشرة وما نشوفها ولا نحفظها.</p>
      <Link to="/service" className="link center">
        الرجوع لطلبات الصيانة
      </Link>
    </div>
  )
}

/** /service/paid/:id — back from Moyasar; the server checks the payment. */
export function ServicePaidPage() {
  usePageMeta('نتيجة الدفع')
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const paymentId = params.get('id') ?? ''
  const [result, setResult] = useState<{ status: string; message?: string | null } | null>(null)

  useEffect(() => {
    if (!paymentId) return
    let live = true
    verifyServicePayment(id, paymentId).then((r) => {
      if (!live) return
      setResult(r)
      if (r.status === 'paid') navigate('/service', { replace: true })
    })
    return () => {
      live = false
    }
  }, [id, paymentId, navigate])

  if (!paymentId) return <Navigate to="/service" replace />
  if (!result) return <p className="muted">نتأكد من الدفع مع ميسر…</p>
  if (result.status === 'failed') {
    return (
      <div className="stack narrow">
        <div className="notice bad" role="alert">
          <b>ما تم الدفع.</b>
          <span>{result.message || 'رفض البنك العملية.'} ما انخصم منك شي، وتقدر تحاول مرة ثانية.</span>
        </div>
        <Link to={`/service/pay/${id}`} className="btn self-start">
          حاول مرة ثانية
        </Link>
      </div>
    )
  }
  return (
    <div className="stack narrow">
      <div className="notice" role="status">
        <b>استلمنا عملية الدفع ونتأكد منها.</b>
        <span>يتحدّث طلبك خلال دقائق. إذا انخصم المبلغ وما تحدّث، تواصل معنا ونرتبه لك.</span>
      </div>
      <Link to="/service" className="btn self-start">
        طلبات الصيانة
      </Link>
    </div>
  )
}
