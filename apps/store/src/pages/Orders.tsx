import { Link } from 'react-router-dom'

/** Placeholder until orders are built (step: checkout). */
export function Orders() {
  return (
    <div className="stack narrow">
      <h1 className="page-h">طلباتي</h1>
      <div className="notice">
        <b>لا توجد طلبات بعد.</b>
        <span className="muted">عند إتمام أول طلب سيظهر هنا مع حالته.</span>
        <Link to="/products" className="btn sm">
          تصفح المنتجات
        </Link>
      </div>
    </div>
  )
}
