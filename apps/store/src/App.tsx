import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom'
import { Home } from './pages/Home'
import { Products } from './pages/Products'
import './App.css'

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
        </nav>
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
    <BrowserRouter>
      <Header />
      <main className="wrap">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<Products />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
