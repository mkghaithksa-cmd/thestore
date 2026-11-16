import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom'
import { BUSINESS, STORE_PAGES, formatSaudiPhoneLocal, telHref } from '@ghaith/shared'
import { RequireAuth } from './components/RequireAuth'
import { AuthProvider, useAuth } from './lib/auth'
import { CartProvider, useCart } from './lib/cart'
import { LocationProvider } from './lib/location'
import { LocationButton, LocationDialog, LocationPrompt } from './components/LocationPicker'
import { Cart } from './pages/Cart'
import { Account } from './pages/Account'
import { Home } from './pages/Home'
import { InfoPage } from './pages/InfoPage'
import { Login } from './pages/Login'
import { OrderPage, Orders } from './pages/Orders'
import { Checkout } from './pages/Checkout'
import { ProductPage } from './pages/ProductPage'
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

function CartButton() {
  const { count } = useCart()
  return (
    <Link to="/cart" className="cart-btn" aria-label={count ? `السلة، فيها ${count}` : 'السلة'}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2" />
        <circle cx="9.5" cy="20" r="1.3" />
        <circle cx="17" cy="20" r="1.3" />
      </svg>
      {count > 0 && <span className="badge">{count > 99 ? '99+' : count}</span>}
    </Link>
  )
}

/** Coloured logo on light backgrounds, white logo on dark (brand guide). */
function Logo({ onDark = false }: { onDark?: boolean }) {
  return (
    <span className={`logo-img${onDark ? ' on-dark' : ''}`}>
      <img src="/brand/logo-color.png" className="logo-color" alt={BUSINESS.shortName} width="400" height="222" />
      <img src="/brand/logo-white.png" className="logo-white" alt="" aria-hidden="true" width="400" height="217" />
    </span>
  )
}

function TopBar() {
  return (
    <div className="topbar">
      <div className="wrap">
        <span>{BUSINESS.city}</span>
        <span className="topbar-phones">
          {BUSINESS.phones.map((p) => (
            <a key={p} href={telHref(p)} dir="ltr">
              {p}
            </a>
          ))}
        </span>
      </div>
    </div>
  )
}

function Footer() {
  return (
    <footer className="ftr">
      <div className="wrap ftr-grid">
        <div className="ftr-about">
          <Logo onDark />
          <p>{BUSINESS.tagline}</p>
        </div>
        <nav aria-label="روابط المتجر">
          <h2>المتجر</h2>
          <Link to="/products">المنتجات</Link>
          <Link to="/cart">السلة</Link>
          <Link to="/orders">طلباتي</Link>
          <Link to="/account">حسابي</Link>
        </nav>
        <nav aria-label="معلومات المتجر">
          <h2>معلومات</h2>
          {STORE_PAGES.map((p) => (
            <Link key={p.slug} to={`/pages/${p.slug}`}>
              {p.title}
            </Link>
          ))}
        </nav>
        <div>
          <h2>تواصل معنا</h2>
          {BUSINESS.phones.map((p) => (
            <a key={p} href={telHref(p)} dir="ltr" className="ftr-ltr">
              {p}
            </a>
          ))}
          <a href={`mailto:${BUSINESS.email}`} dir="ltr" className="ftr-ltr">
            {BUSINESS.email}
          </a>
          <span>{BUSINESS.address}</span>
        </div>
      </div>
      <div className="wrap ftr-legal">
        <span>
          © {new Date().getFullYear()} {BUSINESS.legalName}
        </span>
        <span>السجل التجاري: {BUSINESS.commercialRegister}</span>
      </div>
    </footer>
  )
}

function Header() {
  return (
    <header className="hdr">
      <div className="wrap">
        <Link to="/" className="logo" aria-label={`${BUSINESS.shortName} — الرئيسية`}>
          <Logo />
        </Link>
        <nav className="nav">
          <NavLink to="/" end>
            الرئيسية
          </NavLink>
          <NavLink to="/products">المنتجات</NavLink>
          <NavLink to="/orders">طلباتي</NavLink>
        </nav>
        <div className="hact">
          <LocationButton />
          <CartButton />
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
      <CartProvider>
      <LocationProvider>
      <BrowserRouter>
        <TopBar />
        <Header />
        <LocationPrompt />
        <LocationDialog />
        <main className="wrap">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/products" element={<Products />} />
            <Route path="/products/:key" element={<ProductPage />} />
            <Route path="/cart" element={<Cart />} />
            <Route
              path="/checkout"
              element={
                <RequireAuth>
                  <Checkout />
                </RequireAuth>
              }
            />
            <Route
              path="/orders/:id"
              element={
                <RequireAuth>
                  <OrderPage />
                </RequireAuth>
              }
            />
            <Route path="/pages/:slug" element={<InfoPage />} />
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
        <Footer />
      </BrowserRouter>
      </LocationProvider>
      </CartProvider>
    </AuthProvider>
  )
}
