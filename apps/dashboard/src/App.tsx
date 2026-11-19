import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { StaffAuthProvider } from './lib/staffAuth'
import { ComingSoon, Home } from './pages/Home'
import { HomeBuilder } from './pages/HomeBuilder'
import { Reviews } from './pages/Reviews'
import { Orders } from './pages/Orders'
import { Inventory } from './pages/Inventory'
import { Appointments } from './pages/Appointments'
import { Customers } from './pages/Customers'
import { Categories } from './pages/Categories'
import { Login } from './pages/Login'
import { ProductForm } from './pages/ProductForm'
import { Products } from './pages/Products'
import { Roles } from './pages/Roles'
import { Settings } from './pages/Settings'
import { StorePages } from './pages/StorePages'
import { Users } from './pages/Users'
import { WorkOrders } from './pages/WorkOrders'
import { Payments } from './pages/Payments'
import { Approvals } from './pages/Approvals'
import './App.css'

export default function App() {
  return (
    <StaffAuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/users" element={<Users />} />
            <Route path="/roles" element={<Roles />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/pages" element={<StorePages />} />
            <Route path="/catalog" element={<Products />} />
            <Route path="/catalog/banners" element={<Navigate to="/catalog/home" replace />} />
            <Route path="/catalog/home" element={<HomeBuilder />} />
            <Route path="/catalog/reviews" element={<Reviews />} />
            <Route path="/catalog/categories" element={<Categories />} />
            <Route path="/catalog/new" element={<ProductForm />} />
            <Route path="/catalog/:id" element={<ProductForm key="edit" />} />
            <Route path="/p/orders" element={<Orders />} />
            <Route path="/p/inventory" element={<Inventory />} />
            <Route path="/p/appointments" element={<Appointments />} />
            <Route path="/p/customers" element={<Customers />} />
            <Route path="/p/work_orders" element={<WorkOrders />} />
            <Route path="/p/payments" element={<Payments />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/p/:page" element={<ComingSoon />} />
            <Route path="*" element={<div className="notice">الصفحة غير موجودة.</div>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StaffAuthProvider>
  )
}
