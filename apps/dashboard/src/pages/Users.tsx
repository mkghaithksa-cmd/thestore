import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  STAFF_CODE_LENGTH,
  formatSaudiPhoneLocal,
  generateStaffCode,
  normalizeSaudiPhone,
  staffErrorMessage,
  toAsciiDigits,
  type Role,
  type StaffProfile,
} from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { FunctionError, callFunction, rpcErrorCode } from '../lib/functions'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

type StaffRow = StaffProfile & { role: Pick<Role, 'name' | 'is_locked'> | null }

function CodeField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <div className="row">
      <input
        id={id}
        className="input otp"
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        maxLength={STAFF_CODE_LENGTH}
        value={value}
        onChange={(e) => onChange(toAsciiDigits(e.target.value).replace(/\D/g, '').slice(0, STAFF_CODE_LENGTH))}
      />
      <button type="button" className="btn sm sec" onClick={() => onChange(generateStaffCode())}>
        توليد رمز
      </button>
    </div>
  )
}

/** Shown once after a code is set, so the manager can hand it over. */
function CodeNotice({ name, code, onClose }: { name: string; code: string; onClose: () => void }) {
  return (
    <div className="notice ok" role="status">
      <b>
        رمز الدخول لـ {name}: <span dir="ltr" className="code-reveal">{code}</span>
      </b>
      <span className="muted">سلّمه للموظف مباشرة. لن يظهر مرة أخرى، ولا يُحفظ إلا بشكل مشفّر.</span>
      <button className="btn sm ghost" onClick={onClose}>
        تم
      </button>
    </div>
  )
}

function AddStaffForm({ roles, onAdded }: { roles: Role[]; onAdded: (name: string, code: string) => void }) {
  const { me } = useStaffAuth()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [roleId, setRoleId] = useState('')
  const [code, setCode] = useState(generateStaffCode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choosable = roles.filter((r) => r.is_active && (!r.is_locked || me?.isSystemAdmin))

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const normalized = normalizeSaudiPhone(phone)
    if (name.trim().length < 2) return setError(staffErrorMessage('invalid_name'))
    if (!normalized) return setError(staffErrorMessage('invalid_phone'))
    if (!roleId) return setError(staffErrorMessage('invalid_role'))
    if (code.length !== STAFF_CODE_LENGTH) return setError(staffErrorMessage('invalid_code'))
    setBusy(true)
    setError(null)
    try {
      await callFunction('admin-users', { full_name: name.trim(), phone: normalized, role_id: roleId, code })
      onAdded(name.trim(), code)
      setName('')
      setPhone('')
      setRoleId('')
      setCode(generateStaffCode())
    } catch (err) {
      setError(staffErrorMessage(err instanceof FunctionError ? err.code : 'server_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit} noValidate>
      <h2 className="h3">إضافة موظف</h2>
      <div className="grid-form">
        <div className="field">
          <label htmlFor="s_name">الاسم الكامل</label>
          <input id="s_name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="s_phone">رقم الجوال</label>
          <input
            id="s_phone"
            className="input"
            dir="ltr"
            inputMode="tel"
            placeholder="05XXXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="s_role">الدور</label>
          <select id="s_role" className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">اختر الدور</option>
            {choosable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="s_code">رمز الدخول ({STAFF_CODE_LENGTH} أرقام)</label>
          <CodeField id="s_code" value={code} onChange={setCode} />
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn" disabled={busy}>
        {busy ? 'جاري الإضافة…' : 'إضافة الموظف'}
      </button>
    </form>
  )
}

function ChangeCodeForm({ row, onDone, onCancel }: { row: StaffRow; onDone: (code: string) => void; onCancel: () => void }) {
  const [code, setCode] = useState(generateStaffCode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (code.length !== STAFF_CODE_LENGTH) return setError(staffErrorMessage('invalid_code'))
    setBusy(true)
    const { error: err } = await supabase.rpc('staff_set_code', { p_user: row.user_id, p_code: code })
    setBusy(false)
    if (err) return setError(staffErrorMessage(rpcErrorCode(err.message)))
    onDone(code)
  }

  return (
    <form className="inline-form" onSubmit={onSubmit} noValidate>
      <label htmlFor={`c_${row.user_id}`}>رمز جديد لـ {row.full_name}</label>
      <CodeField id={`c_${row.user_id}`} value={code} onChange={setCode} />
      <span className="muted">سيتم تسجيل خروجه من كل الأجهزة.</span>
      {error && <p className="form-error">{error}</p>}
      <div className="row">
        <button className="btn sm" disabled={busy}>
          حفظ الرمز
        </button>
        <button type="button" className="btn sm ghost" onClick={onCancel}>
          إلغاء
        </button>
      </div>
    </form>
  )
}

export function Users() {
  const { me, can, signOut } = useStaffAuth()
  const [staff, setStaff] = useState<StaffRow[] | null>(null)
  const [roles, setRoles] = useState<Role[]>([])
  const [loadError, setLoadError] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [codeFor, setCodeFor] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<{ name: string; code: string } | null>(null)

  const canAdd = can('users_roles', 'add')
  const canEdit = can('users_roles', 'edit')

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([
      supabase.from('staff_profiles').select('*, role:roles(name, is_locked)').order('created_at'),
      supabase.from('roles').select('*').order('created_at'),
    ])
    if (s.error || r.error) return setLoadError(true)
    setLoadError(false)
    setStaff(s.data as StaffRow[])
    setRoles(r.data as Role[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setActionError(null)
    const { error } = await fn()
    if (error) setActionError(staffErrorMessage(rpcErrorCode(error.message)))
    await load()
  }

  const status = (s: StaffRow) => {
    if (!s.is_active) return <span className="badge b-gray">موقوف</span>
    if (s.locked_until && new Date(s.locked_until) > new Date())
      return <span className="badge b-warn">مقفول مؤقتاً</span>
    return <span className="badge b-ok">نشط</span>
  }

  return (
    <RequirePage page="users_roles">
      <div className="ph">
        <div>
          <h1>المستخدمون</h1>
          <p>الموظفون يدخلون بالجوال ورمز من {STAFF_CODE_LENGTH} أرقام. لا يُحذف موظف، يُوقف فقط.</p>
        </div>
      </div>

      {revealed && <CodeNotice {...revealed} onClose={() => setRevealed(null)} />}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {canAdd && (
        <AddStaffForm
          roles={roles}
          onAdded={(name, code) => {
            setRevealed({ name, code })
            void load()
          }}
        />
      )}

      <div className="card tw">
        {loadError && <p className="form-error">تعذر تحميل الموظفين.</p>}
        {!staff && !loadError && <p className="muted">جاري التحميل…</p>}
        {staff && (
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الجوال</th>
                <th>الدور</th>
                <th>الحالة</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => {
                const isMe = s.user_id === me?.profile.user_id
                const locked = !!s.role?.is_locked
                const editable = canEdit && !isMe && !locked
                return (
                  <tr key={s.user_id}>
                    <td>
                      <b>{s.full_name}</b>
                      {isMe && <span className="muted"> (أنت)</span>}
                    </td>
                    <td dir="ltr" className="num">
                      {formatSaudiPhoneLocal(s.phone)}
                    </td>
                    <td>
                      {editable ? (
                        <select
                          className="input sm"
                          aria-label={`دور ${s.full_name}`}
                          value={s.role_id}
                          onChange={(e) =>
                            run(() => supabase.rpc('staff_set_role', { p_user: s.user_id, p_role: e.target.value }))
                          }
                        >
                          {roles
                            .filter((r) => r.is_active && (!r.is_locked || me?.isSystemAdmin))
                            .map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        s.role?.name
                      )}
                    </td>
                    <td>{status(s)}</td>
                    <td>
                      {codeFor === s.user_id ? (
                        <ChangeCodeForm
                          row={s}
                          onCancel={() => setCodeFor(null)}
                          onDone={(code) => {
                            setCodeFor(null)
                            if (isMe) {
                              void signOut()
                            } else {
                              setRevealed({ name: s.full_name, code })
                              void load()
                            }
                          }}
                        />
                      ) : (
                        <div className="row wrapr">
                          {(isMe || editable) && (
                            <button className="btn sm sec" onClick={() => setCodeFor(s.user_id)}>
                              تغيير الرمز
                            </button>
                          )}
                          {editable && (
                            <button
                              className="btn sm ghost"
                              onClick={() =>
                                run(() => supabase.rpc('staff_set_active', { p_user: s.user_id, p_active: !s.is_active }))
                              }
                            >
                              {s.is_active ? 'إيقاف' : 'تفعيل'}
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </RequirePage>
  )
}
