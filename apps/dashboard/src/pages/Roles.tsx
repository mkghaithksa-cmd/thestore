import { useCallback, useEffect, useState, type FormEvent } from 'react'
import {
  PERMISSION_ACTIONS,
  STAFF_PAGES,
  staffErrorMessage,
  type PermissionAction,
  type Role,
  type RolePermission,
} from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { rpcErrorCode } from '../lib/functions'
import { useStaffAuth } from '../lib/staffAuth'
import { supabase } from '../lib/supabase'

function AddRoleForm({ roles, onAdded }: { roles: Role[]; onAdded: (id: string) => void }) {
  const [name, setName] = useState('')
  const [copyFrom, setCopyFrom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setError(staffErrorMessage('invalid_name'))
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('role_create', {
      p_name: name.trim(),
      p_copy_from: copyFrom || null,
    })
    setBusy(false)
    if (err) {
      return setError(err.message.includes('duplicate') ? 'يوجد دور بهذا الاسم.' : staffErrorMessage(rpcErrorCode(err.message)))
    }
    setName('')
    onAdded(data as string)
  }

  return (
    <form className="card row wrapr align-end" onSubmit={onSubmit} noValidate>
      <div className="field grow">
        <label htmlFor="r_name">اسم الدور الجديد</label>
        <input id="r_name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field grow">
        <label htmlFor="r_copy">نسخ الصلاحيات من</label>
        <select id="r_copy" className="input" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
          <option value="">بدون (كل الصلاحيات مغلقة)</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <button className="btn" disabled={busy}>
        إضافة دور
      </button>
      {error && <p className="form-error full">{error}</p>}
    </form>
  )
}

export function Roles() {
  const { can } = useStaffAuth()
  const [roles, setRoles] = useState<Role[]>([])
  const [perms, setPerms] = useState<RolePermission[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const canEdit = can('users_roles', 'edit')
  const canAdd = can('users_roles', 'add')

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([
      supabase.from('roles').select('*').order('created_at'),
      supabase.from('role_permissions').select('*'),
    ])
    if (r.error || p.error) return setError('تعذر تحميل الأدوار.')
    setRoles(r.data as Role[])
    setPerms(p.data as RolePermission[])
    setSelected((s) => s ?? (r.data as Role[])[0]?.id ?? null)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const role = roles.find((r) => r.id === selected)
  const readOnly = !canEdit || !!role?.is_locked

  async function toggle(page: string, action: PermissionAction, value: boolean) {
    if (!role) return
    setError(null)
    const column = `can_${action}` as const
    // Optimistic update, then save.
    setPerms((all) => all.map((p) => (p.role_id === role.id && p.page === page ? { ...p, [column]: value } : p)))
    const { error: err } = await supabase
      .from('role_permissions')
      .update({ [column]: value })
      .eq('role_id', role.id)
      .eq('page', page)
    if (err) {
      setError(staffErrorMessage(rpcErrorCode(err.message)))
      await load()
    }
  }

  return (
    <RequirePage page="users_roles">
      <div className="ph">
        <div>
          <h1>الأدوار والصلاحيات</h1>
          <p>لكل صفحة: عرض، إضافة، تعديل، اعتماد. تُطبّق في قاعدة البيانات وليس فقط في الواجهة.</p>
        </div>
      </div>

      {canAdd && <AddRoleForm roles={roles} onAdded={(id) => load().then(() => setSelected(id))} />}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="chips" role="tablist" aria-label="الأدوار">
        {roles.map((r) => (
          <button
            key={r.id}
            role="tab"
            aria-selected={r.id === selected}
            className={r.id === selected ? 'on' : undefined}
            onClick={() => setSelected(r.id)}
          >
            {r.name}
            {r.is_locked && ' 🔒'}
          </button>
        ))}
      </div>

      {role && (
        <div className="card tw">
          {role.is_locked && <p className="muted">دور مدير النظام مقفول: كل الصلاحيات مفعّلة ولا يمكن تعديله.</p>}
          <table>
            <thead>
              <tr>
                <th>الصفحة</th>
                {PERMISSION_ACTIONS.map((a) => (
                  <th key={a.key} className="center-cell">
                    {a.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STAFF_PAGES.map((page) => {
                const p = perms.find((x) => x.role_id === role.id && x.page === page.key)
                return (
                  <tr key={page.key}>
                    <td>{page.label}</td>
                    {PERMISSION_ACTIONS.map((a) => (
                      <td key={a.key} className="center-cell">
                        <input
                          type="checkbox"
                          aria-label={`${page.label}: ${a.label}`}
                          checked={!!p?.[`can_${a.key}`]}
                          disabled={readOnly || !p}
                          onChange={(e) => toggle(page.key, a.key, e.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </RequirePage>
  )
}
