import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { VAT_RATE } from '@ghaith/shared'
import './App.css'

function Home() {
  return (
    <section className="hero">
      <h1>ماء نقي لبيتك</h1>
      <p>أجهزة تنقية وفلاتر وتركيب وصيانة — المتجر قيد الإنشاء.</p>
      <p className="badge">الأسعار شاملة ضريبة القيمة المضافة {VAT_RATE * 100}٪</p>
    </section>
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
