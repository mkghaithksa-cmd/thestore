import type { OrderStatus } from './index'

/** delivery: inside Mecca; delivery_install: delivered and installed; shipping: outside Mecca. */
export type Fulfillment = 'delivery' | 'delivery_install' | 'shipping'

export interface Order {
  id: string
  order_number: string
  customer_id: string
  status: OrderStatus
  fulfillment: Fulfillment
  zone: 'mecca' | 'outside'
  city: string
  neighborhood_name: string | null
  street: string | null
  address_notes: string | null
  lat: number
  lng: number
  contact_name: string
  contact_phone: string
  preferred_visit_date: string | null
  customer_notes: string | null
  vat_rate: number
  subtotal: number
  install_units: number
  install_fee: number
  shipping_fee: number
  vat_amount: number
  total: number
  expires_at: string
  paid_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  created_at: string
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  sku: string
  name_ar: string
  type: string
  qty: number
  unit_price: number
  line_total: number
  installable: boolean
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'بانتظار الدفع',
  paid: 'مدفوع',
  preparing: 'قيد التجهيز',
  shipped: 'تم الشحن',
  installing: 'قيد التركيب',
  delivered: 'تم التوصيل',
  completed: 'مكتمل',
  cancelled: 'ملغي',
}

export const FULFILLMENT_LABELS: Record<Fulfillment, string> = {
  delivery: 'توصيل داخل مكة',
  delivery_install: 'توصيل وتركيب داخل مكة',
  shipping: 'شحن',
}

/** An unpaid order past its 24 hours counts as cancelled even before the clean-up job runs. */
export function effectiveStatus(o: Pick<Order, 'status' | 'expires_at'>, now = Date.now()): OrderStatus {
  return o.status === 'pending_payment' && new Date(o.expires_at).getTime() <= now ? 'cancelled' : o.status
}

/** Codes raised by create_order() → what the customer reads. */
export const ORDER_ERRORS: Record<string, string> = {
  not_signed_in: 'سجّل دخولك أولاً.',
  not_a_customer: 'هذا الحساب حساب موظف. استخدم رقم جوال عميل للطلب.',
  invalid_name: 'اكتب اسمك الكامل (حرفين على الأقل).',
  name_required: 'اكتب اسمك الكامل.',
  privacy_required: 'يلزم الموافقة على الشروط وسياسة الخصوصية.',
  too_many_pending: 'عندك 5 طلبات بانتظار الدفع. ادفع أحدها أو انتظر إلغاءها قبل طلب جديد.',
  location_required: 'حدد موقع بيتك على الخريطة.',
  outside_ksa: 'الموقع المحدد خارج المملكة. نوصّل داخل السعودية فقط.',
  invalid_fulfillment: 'طريقة التوصيل لا تناسب موقعك. راجع الموقع وطريقة التوصيل.',
  neighborhood_required: 'اختر الحي.',
  empty_cart: 'سلتك فاضية.',
  too_many_items: 'عدد المنتجات في الطلب كبير. قسّمه على أكثر من طلب.',
  invalid_items: 'تعذّر قراءة السلة. حدّث الصفحة وحاول مرة ثانية.',
  invalid_qty: 'الكمية لكل منتج من 1 إلى 20.',
  product_unavailable: 'منتج في سلتك لم يعد متوفراً. حدّث السلة وحاول مرة ثانية.',
  service_outside_area: 'خدمات الصيانة والزيارات متاحة داخل مكة المكرمة فقط.',
  nothing_to_install: 'ما في سلتك جهاز يحتاج تركيب. اختر التوصيل فقط.',
  visit_date_required: 'اختر اليوم المناسب للزيارة.',
  invalid_visit_date: 'اليوم المختار غير متاح. اختر يوم عمل من بكرة إلى 30 يوم.',
}

export function orderErrorMessage(message: string | undefined | null): string {
  const code = Object.keys(ORDER_ERRORS).find((k) => message?.includes(k))
  return code ? ORDER_ERRORS[code] : 'تعذّر إنشاء الطلب. حاول مرة ثانية.'
}
