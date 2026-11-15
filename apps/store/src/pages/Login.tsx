import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import {
  OTP_LENGTH,
  OTP_RESEND_SECONDS,
  formatSaudiPhoneLocal,
  normalizeSaudiPhone,
  toAsciiDigits,
} from '@ghaith/shared'
import { useAuth } from '../lib/auth'
import { authErrorMessage } from '../lib/authErrors'
import { supabase } from '../lib/supabase'

/** Only allow in-app redirects ("/orders"), never "//evil.com". */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/account'
}

export function Login() {
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const navigate = useNavigate()

  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phoneInput, setPhoneInput] = useState('')
  const [phone, setPhone] = useState('') // E.164 once sent
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  // Resend countdown.
  useEffect(() => {
    if (secondsLeft <= 0) return
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [secondsLeft])

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  if (!loading && session) return <Navigate to={next} replace />

  async function sendCode(target: string) {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.signInWithOtp({ phone: target })
    setBusy(false)
    if (err) {
      setError(authErrorMessage(err))
      return false
    }
    setSecondsLeft(OTP_RESEND_SECONDS)
    return true
  }

  async function onSubmitPhone(e: FormEvent) {
    e.preventDefault()
    const normalized = normalizeSaudiPhone(phoneInput)
    if (!normalized) {
      setError('أدخل رقم جوال سعودي صحيح يبدأ بـ 05 (10 أرقام).')
      return
    }
    if (await sendCode(normalized)) {
      setPhone(normalized)
      setCode('')
      setStep('code')
    }
  }

  async function onSubmitCode(e: FormEvent) {
    e.preventDefault()
    if (code.length !== OTP_LENGTH) {
      setError(`أدخل الرمز المكوّن من ${OTP_LENGTH} أرقام.`)
      return
    }
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' })
    setBusy(false)
    if (err) {
      setError(authErrorMessage(err))
      return
    }
    navigate(next, { replace: true })
  }

  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        {step === 'phone' ? (
          <form onSubmit={onSubmitPhone} noValidate>
            <h1 className="h2">تسجيل الدخول برقم الجوال</h1>
            <p className="muted">نرسل لك رمز تحقق، بدون كلمة مرور.</p>
            <div className="field">
              <label htmlFor="phone">رقم الجوال</label>
              <input
                id="phone"
                className="input"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                placeholder="05XXXXXXXX"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? 'auth-error' : undefined}
                autoFocus
              />
            </div>
            {error && (
              <p id="auth-error" className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn block" disabled={busy}>
              {busy ? 'جاري الإرسال…' : 'إرسال رمز التحقق'}
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmitCode} noValidate>
            <h1 className="h2">أدخل رمز التحقق</h1>
            <p className="muted">
              أرسلنا رمزاً من {OTP_LENGTH} أرقام إلى <span dir="ltr">{formatSaudiPhoneLocal(phone)}</span>
            </p>
            <div className="field">
              <label htmlFor="otp">رمز التحقق</label>
              <input
                id="otp"
                ref={codeRef}
                className="input otp"
                dir="ltr"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={OTP_LENGTH}
                value={code}
                onChange={(e) => setCode(toAsciiDigits(e.target.value).replace(/\D/g, '').slice(0, OTP_LENGTH))}
                aria-invalid={!!error}
                aria-describedby={error ? 'auth-error' : undefined}
              />
            </div>
            {error && (
              <p id="auth-error" className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="btn block" disabled={busy}>
              {busy ? 'جاري التحقق…' : 'تأكيد الدخول'}
            </button>
            <div className="auth-links">
              <button
                type="button"
                className="linkbtn"
                disabled={busy || secondsLeft > 0}
                onClick={() => sendCode(phone)}
              >
                {secondsLeft > 0 ? `إعادة الإرسال بعد ${secondsLeft} ث` : 'إعادة إرسال الرمز'}
              </button>
              <button
                type="button"
                className="linkbtn"
                onClick={() => {
                  setStep('phone')
                  setError(null)
                }}
              >
                تغيير الرقم
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
