import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { StaffAuthProvider } from './lib/staffAuth'
import { ComingSoon, Home } from './pages/Home'
import { Login } from './pages/Login'
import { Roles } from './pages/Roles'
import { Users } from './pages/Users'
import './App.css'

export default function App() {
  return (
    <StaffAuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/users" element={<Users />} />
            <Route path="/roles" element={<Roles />} />
            <Route path="/p/:page" element={<ComingSoon />} />
            <Route path="*" element={<div className="notice">الصفحة غير موجودة.</div>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StaffAuthProvider>
  )
}
