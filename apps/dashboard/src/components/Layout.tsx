import { useState } from 'react'
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { STAFF_PAGES, formatSaudiPhoneLocal, type StaffPage } from '@ghaith/shared'
import { useStaffAuth } from '../lib/staffAuth'

/** Sidebar links; users_roles has two screens. */
const NAV = STAFF_PAGES.flatMap((p): { to: string; page: StaffPage; label: string }[] =>
  p.key === 'catalog'
    ? [{ to: '/catalog', page: p.key, label: 'المنتجات' }]
    : p.key === 'users_roles'
    ? [
        { to: '/users', page: p.key, label: 'المستخدمون' },
        { to: '/roles', page: p.key, label: 'الأدوار والصلاحيات' },
      ]
    : [{ to: p.key === 'dashboard' ? '/' : `/p/${p.key}`, page: p.key, label: p.label }],
)

export function Layout() {
  const { me, loading, can, signOut } = useStaffAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  if (loading) return <div className="center muted">جاري التحميل…</div>
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  return (
    <div className="shell">
      <aside className={`side${open ? ' open' : ''}`} aria-label="القائمة">
        <div className="brand">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
          </svg>
          لوحة غيث
        </div>
        <nav className="side-nav" onClick={() => setOpen(false)}>
          {NAV.filter((n) => can(n.page, 'view')).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nv">
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="who">
          <b>{me.profile.full_name}</b>
          <span>{me.roleName}</span>
          <span dir="ltr">{formatSaudiPhoneLocal(me.profile.phone)}</span>
          <button className="btn sm ghost" onClick={signOut}>
            تسجيل الخروج
          </button>
        </div>
      </aside>
      <div className="work">
        <button className="menu-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          ☰ القائمة
        </button>
        <Outlet />
      </div>
    </div>
  )
}

/** Shows children only if the current role can view the page. */
export function RequirePage({ page, children }: { page: StaffPage; children: React.ReactNode }) {
  const { can } = useStaffAuth()
  if (!can(page, 'view')) {
    return (
      <div className="notice">
        <b>لا تملك صلاحية عرض هذه الصفحة.</b>
        <span className="muted">تواصل مع مدير النظام إذا كنت تحتاجها.</span>
      </div>
    )
  }
  return <>{children}</>
}
