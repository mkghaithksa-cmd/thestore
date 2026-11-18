import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { formatSaudiPhoneLocal, type Customer } from '@ghaith/shared'
import { useAuth } from '../lib/auth'
import { completeMyProfile, fetchMyCustomer } from '../lib/customer'
import { useAsync } from '../lib/useAsync'

function CompleteProfileForm({ customer, onDone }: { customer: Customer; onDone: (c: Customer) => void }) {
  const [name, setName] = useState(customer.full_name ?? '')
  const [email, setEmail] = useState(customer.email ?? '')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setError('أدخل الاسم الكامل.')
    if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      return setError('البريد الإلكتروني غير صحيح.')
    if (!agreed) return setError('يلزم الموافقة على الشروط وسياسة الخصوصية.')
    setBusy(true)
    setError(null)
    try {
      onDone(await completeMyProfile(customer.id, { full_name: name, email: email || null }))
    } catch {
      setError('تعذر حفظ البيانات. حاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit} noValidate>
      <h2 className="h3">أكمل بياناتك</h2>
      <p className="muted">مرة واحدة فقط، لتسريع طلباتك القادمة.</p>
      <div className="field">
        <label htmlFor="full_name">الاسم الكامل</label>
        <input id="full_name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="email">
          البريد الإلكتروني <span className="muted">(اختياري)</span>
        </label>
        <input
          id="email"
          className="input"
          dir="ltr"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <span>
          أوافق على <b>الشروط</b> و<b>سياسة الخصوصية</b> وأسمح بالتواصل معي بخصوص طلباتي وصيانتي.
        </span>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn" disabled={busy}>
        {busy ? 'جاري الحفظ…' : 'حفظ البيانات'}
      </button>
    </form>
  )
}

export function Account() {
  const { session, signOut } = useAuth()
  const { state, reload } = useAsync(fetchMyCustomer)
  const [saved, setSaved] = useState<Customer | null>(null)

  const customer = saved ?? (state.status === 'success' ? state.data : null)

  return (
    <div className="stack narrow">
      <h1 className="page-h">حسابي</h1>

      <div className="card row between wrapr">
        <div>
          <div className="muted">رقم الجوال</div>
          <b dir="ltr">{formatSaudiPhoneLocal(customer?.phone ?? (session?.user.phone ? `+${session.user.phone}` : ''))}</b>
          {customer?.full_name && <div>{customer.full_name}</div>}
        </div>
        <button className="btn sm ghost" onClick={signOut}>
          تسجيل الخروج
        </button>
      </div>

      {state.status === 'loading' && <p className="muted">جاري التحميل…</p>}
      {state.status === 'error' && (
        <div className="notice bad" role="alert">
          <b>تعذر تحميل بيانات الحساب.</b>
          <button className="btn sm" onClick={reload}>
            إعادة المحاولة
          </button>
        </div>
      )}
      {state.status === 'success' && !customer && (
        <div className="notice">لم يتم العثور على ملف العميل. تواصل معنا.</div>
      )}

      {customer && customer.profile_type === 'short' && (
        <>
          <div className="notice warn">حسابك مختصر برقم الجوال فقط. أكمل بياناتك مرة واحدة لتسريع طلباتك القادمة.</div>
          <CompleteProfileForm customer={customer} onDone={setSaved} />
        </>
      )}
      {customer && customer.profile_type === 'full' && (
        <div className="notice ok">بياناتك مكتملة ✓{saved && ' تم الحفظ.'}</div>
      )}

      <Link to="/orders" className="card row between">
        <b>طلباتي</b>
        <span className="link">←</span>
      </Link>
      <Link to="/devices" className="card row between">
        <b>أجهزتي</b>
        <span className="link">←</span>
      </Link>
      <Link to="/service" className="card row between">
        <b>طلبات الصيانة والبلاغات</b>
        <span className="link">←</span>
      </Link>
    </div>
  )
}
