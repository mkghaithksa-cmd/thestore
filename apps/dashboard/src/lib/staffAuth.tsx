import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { PermissionAction, StaffPage, StaffProfile } from '@ghaith/shared'
import { isSupabaseConfigured, supabase } from './supabase'
import { callFunction } from './functions'

type PermissionRow = { page: StaffPage; can_view: boolean; can_add: boolean; can_edit: boolean; can_approve: boolean }

export interface StaffMe {
  profile: StaffProfile
  roleName: string
  isSystemAdmin: boolean
  permissions: Partial<Record<StaffPage, PermissionRow>>
}

interface StaffAuthState {
  session: Session | null
  me: StaffMe | null
  /** True while the session / staff profile is being loaded. */
  loading: boolean
  /** Set when a signed-in account is not (or no longer) active staff. */
  notStaff: boolean
  signIn: (phone: string, code: string) => Promise<void>
  signOut: () => Promise<void>
  can: (page: StaffPage, action?: PermissionAction) => boolean
}

const Ctx = createContext<StaffAuthState | null>(null)

async function loadMe(userId: string): Promise<StaffMe | null> {
  const [{ data: profile }, { data: perms }] = await Promise.all([
    supabase.from('staff_profiles').select('*, role:roles(name, is_locked)').eq('user_id', userId).maybeSingle(),
    supabase.rpc('my_permissions'),
  ])
  const rows = (perms ?? []) as PermissionRow[]
  if (!profile || rows.length === 0) return null
  const { role, ...rest } = profile as StaffProfile & { role: { name: string; is_locked: boolean } | null }
  return {
    profile: rest,
    roleName: role?.name ?? '',
    isSystemAdmin: !!role?.is_locked,
    permissions: Object.fromEntries(rows.map((r) => [r.page, r])),
  }
}

export function StaffAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [me, setMe] = useState<StaffMe | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [notStaff, setNotStaff] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_e, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  // Load staff profile + permissions whenever the signed-in user changes.
  const userId = session?.user.id
  useEffect(() => {
    if (!userId) {
      setMe(null)
      return
    }
    let cancelled = false
    setLoading(true)
    loadMe(userId)
      .then((m) => {
        if (cancelled) return
        setMe(m)
        setNotStaff(!m)
        // A non-staff (or revoked) session must not linger in the dashboard.
        if (!m) void supabase.auth.signOut()
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [userId])

  const signIn = useCallback(async (phone: string, code: string) => {
    const tokens = await callFunction<{ access_token: string; refresh_token: string }>('staff-login', { phone, code })
    setNotStaff(false)
    const { error } = await supabase.auth.setSession(tokens)
    if (error) throw new Error('server_error')
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const can = useCallback(
    (page: StaffPage, action: PermissionAction = 'view') => {
      const p = me?.permissions[page]
      return !!p && !!p[`can_${action}`]
    },
    [me],
  )

  return (
    <Ctx.Provider value={{ session, me, loading, notStaff, signIn, signOut, can }}>{children}</Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useStaffAuth(): StaffAuthState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStaffAuth must be used inside <StaffAuthProvider>')
  return ctx
}
