import { BrandMark } from '../components/BrandMark'
import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { STAFF_CODE_LENGTH, normalizeSaudiPhone, staffErrorMessage, toAsciiDigits } from '@ghaith/shared'
import { FunctionError } from '../lib/functions'
import { useStaffAuth } from '../lib/staffAuth'
import { ThemeToggle } from '../components/ThemeToggle'

function lockMessage(details: Record<string, unknown>): string {
  const until = typeof details.locked_until === 'string' ? new Date(details.locked_until) : null
  if (!until || Number.isNaN(until.getTime())) return staffErrorMessage('locked')
  const time = until.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
  return `تم قفل الدخول مؤقتاً بسبب محاولات خاطئة متكررة. حاول بعد الساعة ${time}.`
}

export function Login() {
  const { me, loading, notStaff, signIn } = useStaffAuth()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!loading && me) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const normalized = normalizeSaudiPhone(phone)
    if (!normalized) return setError(staffErrorMessage('invalid_phone'))
    if (code.length !== STAFF_CODE_LENGTH) return setError(staffErrorMessage('invalid_code'))
    setBusy(true)
    setError(null)
    try {
      await signIn(normalized, code)
    } catch (err) {
      if (err instanceof FunctionError) {
        if (err.code === 'locked') setError(lockMessage(err.details))
        else if (err.code === 'invalid' && typeof err.details.attempts_left === 'number')
          setError(`${staffErrorMessage('invalid')} المتبقي ${err.details.attempts_left} محاولات قبل القفل المؤقت.`)
        else setError(staffErrorMessage(err.code))
      } else {
        setError(staffErrorMessage('server_error'))
      }
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <ThemeToggle className="icon-btn login-theme" />
      <form className="card login-card" onSubmit={onSubmit} noValidate>
        <BrandMark />
        <h1 className="h2">دخول الموظفين</h1>
        <p className="muted">بجوالك والرمز المكوّن من {STAFF_CODE_LENGTH} أرقام الذي أعطاك إياه المدير.</p>

        {notStaff && !error && <p className="form-error">هذا الحساب ليس حساب موظف نشط.</p>}

        <div className="field">
          <label htmlFor="phone">رقم الجوال</label>
          <input
            id="phone"
            className="input"
            dir="ltr"
            inputMode="tel"
            autoComplete="username"
            placeholder="05XXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label htmlFor="code">الرمز</label>
          <input
            id="code"
            className="input otp"
            dir="ltr"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            maxLength={STAFF_CODE_LENGTH}
            value={code}
            onChange={(e) => setCode(toAsciiDigits(e.target.value).replace(/\D/g, '').slice(0, STAFF_CODE_LENGTH))}
          />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn block" disabled={busy}>
          {busy ? 'جاري الدخول…' : 'دخول'}
        </button>
      </form>
    </div>
  )
}
