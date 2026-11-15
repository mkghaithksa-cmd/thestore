import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom'
import { formatSaudiPhoneLocal } from '@ghaith/shared'
import { RequireAuth } from './components/RequireAuth'
import { AuthProvider, useAuth } from './lib/auth'
import { Account } from './pages/Account'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Orders } from './pages/Orders'
import { Products } from './pages/Products'
import './App.css'

function AccountButton() {
  const { session, loading } = useAuth()
  if (loading) return null
  if (!session) {
    return (
      <Link to="/login" className="btn sm">
        دخول
      </Link>
    )
  }
  const phone = session.user.phone ? formatSaudiPhoneLocal(`+${session.user.phone}`) : ''
  return (
    <Link to="/account" className="acct-btn" title="حسابي">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
      </svg>
      <span>حسابي</span>
      {phone && (
        <small dir="ltr" className="acct-phone">
          {phone}
        </small>
      )}
    </Link>
  )
}

function Header() {
  return (
    <header className="hdr">
      <div className="wrap">
        <Link to="/" className="logo">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
          </svg>
          غيث
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            الرئيسية
          </NavLink>
          <NavLink to="/products">المنتجات</NavLink>
          <NavLink to="/orders">طلباتي</NavLink>
        </nav>
        <div className="hact">
          <AccountButton />
        </div>
      </div>
    </header>
  )
}

function NotFound() {
  return (
    <div className="notice">
      <b>الصفحة غير موجودة.</b>
      <Link to="/" className="link">
        العودة للرئيسية
      </Link>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Header />
        <main className="wrap">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/products" element={<Products />} />
            <Route path="/login" element={<Login />} />
            <Route
              path="/account"
              element={
                <RequireAuth>
                  <Account />
                </RequireAuth>
              }
            />
            <Route
              path="/orders"
              element={
                <RequireAuth>
                  <Orders />
                </RequireAuth>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </BrowserRouter>
    </AuthProvider>
  )
}
