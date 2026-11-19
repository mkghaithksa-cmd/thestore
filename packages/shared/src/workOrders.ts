// Work orders, custody and approvals (Day 9).

export type WorkOrderStatus = 'visit' | 'report' | 'approval' | 'quote' | 'payment' | 'paid' | 'closed' | 'cancelled'

export const WO_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  visit: 'بانتظار الفني',
  report: 'وصل التقرير: جهّز العرض',
  approval: 'خصم بانتظار المدير',
  quote: 'بانتظار رد العميل',
  payment: 'بانتظار الدفع',
  paid: 'مدفوع: جاهز للإغلاق',
  closed: 'مغلق',
  cancelled: 'ملغي',
}

/** What the customer sees for each stage. */
export const WO_CUSTOMER_LABELS: Record<WorkOrderStatus, string> = {
  visit: 'الفني في الطريق',
  report: 'نجهّز لك عرض السعر',
  approval: 'نجهّز لك عرض السعر',
  quote: 'عرض السعر جاهز: وافق أو ارفض',
  payment: 'بانتظار الدفع',
  paid: 'تم الدفع',
  closed: 'مكتمل',
  cancelled: 'ملغي',
}

export interface WorkOrderPart {
  id: string
  work_order_id: string
  product_id: string
  name_ar: string
  qty: number
  unit_price: number | null
}

export interface WorkOrder {
  id: string
  number: string
  request_id: string
  status: WorkOrderStatus
  arrived_at: string | null
  report_at: string | null
  report_by: string | null
  customer_absent: boolean
  finding: string | null
  tech_note: string | null
  photos: string[]
  inspection_fee: number
  labor_fee: number
  discount: number
  discount_reason: string | null
  vat_rate: number
  subtotal: number
  vat: number
  total: number
  quote_at: string | null
  decision: 'approved' | 'rejected' | null
  decision_at: string | null
  decision_via: 'customer' | 'staff' | null
  amount_due: number
  paid_at: string | null
  payment_method: 'cash' | 'moyasar' | null
  closed_at: string | null
  created_at: string
  parts?: WorkOrderPart[]
}

export type CustodyStatus = 'open' | 'pending' | 'settled'
export const CUSTODY_STATUS_LABELS: Record<CustodyStatus, string> = {
  open: 'عند الفني',
  pending: 'فرق بانتظار المدير',
  settled: 'مستلمة',
}

export type ApprovalKind = 'discount' | 'custody_diff' | 'stock_diff'
export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  discount: 'خصم على أمر عمل',
  custody_diff: 'فرق عهدة',
  stock_diff: 'فرق جرد',
}

/** The technician's view of the job (no prices). */
export interface TechJob {
  number: string
  status: WorkOrderStatus
  folder: string
  kind: 'emergency' | 'maintenance'
  request_number: string
  fault_type: string | null
  description: string | null
  contact_name: string
  contact_phone: string
  neighborhood: string | null
  street: string | null
  lat: number | null
  lng: number | null
  scheduled_at: string | null
  technician: string | null
  device: { name: string; model: string | null; ours: boolean; filters: { name: string; last_changed_on: string; next_due_on: string }[] } | null
  arrived_at: string | null
  report_at: string | null
  customer_absent: boolean
  finding: string | null
  tech_note: string | null
  photos: string[]
  parts: { product_id: string; name: string; qty: number }[]
  catalog: { id: string; name: string; type: 'filter' | 'part' }[] | null
}
