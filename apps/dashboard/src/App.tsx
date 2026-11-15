import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { VAT_RATE } from '@ghaith/shared'
import './App.css'

function Home() {
  return (
    <main className="shell">
      <section className="card">
      <h1>لوحة الإدارة</h1>
      <p>إدارة الطلبات والمنتجات والفريق — قيد الإنشاء.</p>
      <p className="muted">الأسعار شاملة ضريبة القيمة المضافة {VAT_RATE * 100}٪</p>
    </section>
    </main>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  )
}
