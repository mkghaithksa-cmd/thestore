// Turns raw audit rows (column names, codes, ids) into plain Arabic.
import {
  APPROVAL_KIND_LABELS,
  AUDIENCE_LABELS,
  CUSTODY_STATUS_LABELS,
  DEVICE_KIND_LABELS,
  FULFILLMENT_LABELS,
  ORDER_STATUS_LABELS,
  PERIOD_LABELS,
  PRODUCT_TYPE_LABELS,
  REVIEW_STATUS_LABELS,
  SERVICE_KIND_LABELS,
  SERVICE_STATUS_LABELS,
  WO_STATUS_LABELS,
  formatSaudiPhoneLocal,
} from '@ghaith/shared'
import { sar, when } from './service'
import { supabase } from './supabase'

type Rec = Record<string, unknown>

/** Column → what a person calls it. */
export const FIELD_LABELS: Record<string, string> = {
  // People and links
  customer_id: 'العميل',
  technician_id: 'الفني',
  product_id: 'المنتج',
  filter_product_id: 'الفلتر',
  bundle_product_id: 'الباقة',
  component_product_id: 'المنتج داخل الباقة',
  order_id: 'الطلب',
  request_id: 'البلاغ',
  work_order_id: 'أمر العمل',
  device_id: 'الجهاز',
  address_id: 'العنوان',
  category_id: 'التصنيف',
  parent_id: 'التصنيف الأب',
  manufacturer_id: 'الشركة',
  role_id: 'الدور',
  user_id: 'الموظف',
  neighborhood_id: 'الحي',
  custody_id: 'العهدة',
  payment_request_id: 'محاولة الدفع',
  added_by: 'أضافه',
  created_by: 'أنشأه',
  updated_by: 'عدّله',
  closed_by: 'أقفله',
  decided_by: 'قرّر فيه',
  decision_by: 'قرّر فيه',
  quote_by: 'سوّى العرض',
  report_by: 'كتب التقرير',
  received_by: 'استلمه',
  recorded_by: 'سجّله',
  requested_by: 'طلبه',
  reviewed_by: 'راجعه',
  // Names and text
  name: 'الاسم',
  name_ar: 'الاسم',
  name_en: 'الاسم بالإنجليزي',
  full_name: 'الاسم',
  title: 'العنوان',
  title_ar: 'العنوان',
  subtitle_ar: 'العنوان الفرعي',
  label: 'التسمية',
  description: 'الوصف',
  description_ar: 'الوصف',
  body: 'النص',
  note: 'ملاحظة',
  notes: 'ملاحظات',
  tech_note: 'ملاحظة الفني',
  customer_notes: 'ملاحظات العميل',
  address_notes: 'وصف العنوان',
  building_note: 'وصف المبنى',
  decision_note: 'سبب القرار',
  discount_reason: 'سبب الخصم',
  cancel_reason: 'سبب الإلغاء',
  finding: 'اللي لقاه الفني',
  fault_type: 'نوع العطل',
  fault_types: 'أنواع الأعطال',
  author_name: 'اسم المقيّم',
  contact_name: 'اسم المستلم',
  phone: 'الجوال',
  contact_phone: 'جوال المستلم',
  owner_phone: 'جوال صاحب الجهاز',
  email: 'البريد',
  slug: 'رابط الصفحة',
  sku: 'رمز المنتج',
  brand: 'الماركة',
  model: 'الموديل',
  device_model: 'الموديل',
  reference: 'المرجع',
  tracking_number: 'رقم الشحنة',
  shipping_carrier: 'شركة الشحن',
  // Numbers and codes
  number: 'الرقم',
  order_number: 'رقم الطلب',
  request_number: 'رقم البلاغ',
  stage_number: 'رقم المرحلة',
  qty: 'الكمية',
  balance_after: 'الرصيد بعدها',
  reorder_level: 'حد إعادة الطلب',
  rating: 'التقييم',
  sort_order: 'الترتيب',
  install_units: 'عدد التركيبات',
  life_months: 'عمر الفلتر (شهر)',
  lifetime_months: 'عمر الفلتر (شهر)',
  filter_life_months: 'عمر الفلتر (شهر)',
  default_filter_life_months: 'عمر الفلتر الافتراضي (شهر)',
  warranty_months: 'الضمان (شهر)',
  failed_attempts: 'محاولات دخول خاطئة',
  technician_link_hours: 'مدة رابط الفني (ساعة)',
  maintenance_alert_days: 'التنبيه قبل الموعد (يوم)',
  maintenance_overdue_days: 'التأخير (يوم)',
  maintenance_decline_days: 'بعد الرفض (يوم)',
  day_of_week: 'اليوم',
  vat_rate: 'نسبة الضريبة',
  seller_vat_number: 'الرقم الضريبي',
  // Money
  amount: 'المبلغ',
  amount_due: 'المبلغ المستحق',
  amount_halalas: 'المبلغ',
  received_amount: 'المبلغ المستلم',
  total: 'الإجمالي',
  subtotal: 'المجموع قبل الضريبة',
  vat: 'الضريبة',
  vat_amount: 'الضريبة',
  discount: 'الخصم',
  shipping_fee: 'رسوم الشحن',
  install_fee: 'رسوم التركيب',
  inspection_fee: 'رسوم الفحص',
  labor_fee: 'أجرة العمل',
  price_before_vat: 'السعر قبل الضريبة',
  cost: 'التكلفة',
  discount_approval_limit: 'حد الخصم بدون موافقة',
  currency: 'العملة',
  // States
  status: 'الحالة',
  kind: 'النوع',
  type: 'النوع',
  device_kind: 'نوع الجهاز',
  fulfillment: 'طريقة الاستلام',
  method: 'طريقة الدفع',
  payment_method: 'طريقة الدفع',
  provider: 'بوابة الدفع',
  refund_status: 'الاسترجاع',
  decision: 'القرار',
  decision_via: 'القرار من',
  source: 'المصدر',
  audience: 'يظهر لـ',
  placement: 'مكانه',
  zone: 'المنطقة',
  city: 'المدينة',
  link_kind: 'نوع الرابط',
  link_ref: 'الرابط',
  preferred_period: 'الفترة المفضلة',
  is_active: 'مفعّل',
  is_visible: 'ظاهر',
  is_published: 'منشور',
  is_featured: 'مميّز',
  is_sample: 'تجريبي',
  is_default: 'الأساسي',
  is_locked: 'مقفل',
  is_working: 'يوم عمل',
  is_temporary: 'مؤقت',
  installed: 'مركّب',
  installable_in_mecca: 'يتركّب في مكة',
  tracks_stock: 'يتابع المخزون',
  in_service_area: 'داخل منطقة الخدمة',
  customer_absent: 'العميل غير موجود',
  date_uncertain: 'التاريخ تقريبي',
  charge_inspection_if_absent: 'رسوم الفحص لو العميل غير موجود',
  maintenance_reminders_on: 'تذكيرات الصيانة',
  can_view: 'يشوف',
  can_add: 'يضيف',
  can_edit: 'يعدّل',
  can_approve: 'يعتمد',
  // Places
  neighborhood_name: 'الحي',
  street: 'الشارع',
  country: 'الدولة',
  lat: 'خط العرض',
  lng: 'خط الطول',
  // Dates
  scheduled_at: 'الموعد',
  preferred_date: 'التاريخ المفضل',
  preferred_visit_date: 'تاريخ الزيارة المفضل',
  started_on: 'تاريخ البداية',
  last_changed_on: 'آخر تغيير',
  next_due_on: 'الموعد الجاي',
  next_contact_on: 'التواصل الجاي',
  warranty_until: 'الضمان لين',
  starts_at: 'يبدأ',
  ends_at: 'ينتهي',
  start_time: 'من الساعة',
  end_time: 'إلى الساعة',
  expires_at: 'ينتهي',
  paid_at: 'وقت الدفع',
  preparing_at: 'بدأ التجهيز',
  shipped_at: 'وقت الشحن',
  delivered_at: 'وقت التسليم',
  completed_at: 'وقت الاكتمال',
  cancelled_at: 'وقت الإلغاء',
  closed_at: 'وقت الإقفال',
  done_at: 'وقت الانتهاء',
  arrived_at: 'وصول الفني',
  decided_at: 'وقت القرار',
  decision_at: 'وقت القرار',
  quote_at: 'وقت العرض',
  report_at: 'وقت التقرير',
  received_at: 'وقت الاستلام',
  reviewed_at: 'وقت المراجعة',
  stock_issued_at: 'صرف المخزون',
  locked_until: 'مقفول لين',
  last_used_at: 'آخر استخدام',
  privacy_accepted_at: 'وافق على الخصوصية',
  sessions_valid_after: 'تسجيل خروج من كل الأجهزة',
  // Media and technical
  photo_path: 'الصورة',
  photos: 'الصور',
  image_path: 'الصورة',
  image_url: 'الصورة',
  storage_path: 'الصورة',
  desktop_path: 'صورة الكمبيوتر',
  mobile_path: 'صورة الجوال',
  alt_ar: 'وصف الصورة',
  specs: 'المواصفات',
  config: 'الإعدادات',
  stages: 'المراحل',
  boundary: 'حدود المنطقة',
  raw: 'رد بوابة الدفع',
  provider_payment_id: 'رقم العملية عند البوابة',
  maintenance_wa_message: 'رسالة تذكير الصيانة',
  page: 'الصفحة',
  key: 'المفتاح',
  unit: 'الوحدة',
  case: 'الحالة',
  profile_type: 'نوع الحساب',
}

/** Codes inside a column, per section (the same word means different things). */
const STATUS_BY_ENTITY: Record<string, Record<string, string>> = {
  orders: ORDER_STATUS_LABELS,
  service_requests: SERVICE_STATUS_LABELS,
  work_orders: WO_STATUS_LABELS,
  custodies: CUSTODY_STATUS_LABELS,
  reviews: REVIEW_STATUS_LABELS,
  approvals: { pending: 'بانتظار الموافقة', approved: 'تمت الموافقة', rejected: 'مرفوض' },
  payment_requests: { initiated: 'بدأ الدفع', paid: 'مدفوع', failed: 'فشل', expired: 'انتهت المهلة' },
  payments: { paid: 'مدفوع', failed: 'فشل', refunded: 'مسترجع' },
  store_pages: { draft: 'مسودة', published: 'منشورة' },
}
const KIND_BY_ENTITY: Record<string, Record<string, string>> = {
  service_requests: SERVICE_KIND_LABELS,
  approvals: APPROVAL_KIND_LABELS,
  stock_movements: { receive: 'استلام', issue: 'صرف', return: 'مرتجع', adjust: 'جرد / تعديل' },
}
const CODES: Record<string, Record<string, string>> = {
  fulfillment: FULFILLMENT_LABELS,
  device_kind: DEVICE_KIND_LABELS,
  type: PRODUCT_TYPE_LABELS,
  audience: AUDIENCE_LABELS,
  preferred_period: PERIOD_LABELS,
  method: { cash: 'كاش', moyasar: 'دفع إلكتروني (مُيسّر)' },
  payment_method: { cash: 'كاش', moyasar: 'دفع إلكتروني (مُيسّر)' },
  provider: { moyasar: 'مُيسّر' },
  refund_status: { none: 'لا يوجد', due: 'مستحق', done: 'تم الاسترجاع' },
  decision: { approved: 'موافقة', rejected: 'رفض' },
  decision_via: { customer: 'العميل', staff: 'الموظف' },
  source: { web: 'الموقع', phone: 'اتصال' },
  placement: { hero: 'أعلى الصفحة', mid: 'وسط الصفحة' },
  zone: { mecca: 'مكة', outside: 'خارج مكة' },
  city: { makkah: 'مكة', outside: 'خارج مكة' },
  link_kind: { none: 'بدون رابط', product: 'منتج', category: 'تصنيف', url: 'رابط' },
  day_of_week: { 0: 'الأحد', 1: 'الاثنين', 2: 'الثلاثاء', 3: 'الأربعاء', 4: 'الخميس', 5: 'الجمعة', 6: 'السبت' },
}

const MONEY = new Set(['amount', 'amount_due', 'received_amount', 'total', 'subtotal', 'vat', 'vat_amount', 'discount', 'shipping_fee', 'install_fee', 'inspection_fee', 'labor_fee', 'price_before_vat', 'cost', 'discount_approval_limit'])
const PHONES = new Set(['phone', 'contact_phone', 'owner_phone'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/

/** Fields a reader never needs (they change on every save or only mean something to the system). */
export const HIDDEN = new Set(['id', 'created_at', 'updated_at', 'token_hash', 'code_hash', 'raw', 'boundary', 'payment_request_id', 'provider_payment_id', 'sessions_valid_after'])

export const fieldLabel = (k: string) => FIELD_LABELS[k] ?? k.replace(/_/g, ' ')

/** Names for ids found in the rows (best effort; what the viewer may read). */
export type Names = Record<string, string>

const LOOKUPS: { keys: string[]; table: string; cols: string; name: (r: Rec) => string }[] = [
  { keys: ['product_id', 'filter_product_id', 'bundle_product_id', 'component_product_id'], table: 'products', cols: 'id, name_ar', name: (r) => String(r.name_ar ?? '') },
  { keys: ['customer_id'], table: 'customers', cols: 'id, full_name, phone', name: (r) => String(r.full_name || formatSaudiPhoneLocal(String(r.phone ?? ''))) },
  { keys: ['technician_id'], table: 'technicians', cols: 'id, full_name', name: (r) => String(r.full_name ?? '') },
  { keys: ['order_id'], table: 'orders', cols: 'id, order_number', name: (r) => String(r.order_number ?? '') },
  { keys: ['request_id'], table: 'service_requests', cols: 'id, request_number', name: (r) => String(r.request_number ?? '') },
  { keys: ['work_order_id'], table: 'work_orders', cols: 'id, number', name: (r) => String(r.number ?? '') },
  { keys: ['category_id', 'parent_id'], table: 'categories', cols: 'id, name_ar', name: (r) => String(r.name_ar ?? '') },
  { keys: ['manufacturer_id'], table: 'manufacturers', cols: 'id, name', name: (r) => String(r.name ?? '') },
  { keys: ['role_id'], table: 'roles', cols: 'id, name', name: (r) => String(r.name ?? '') },
  { keys: ['neighborhood_id'], table: 'service_neighborhoods', cols: 'id, name_ar', name: (r) => String(r.name_ar ?? '') },
  { keys: ['device_id'], table: 'customer_devices', cols: 'id, name_ar', name: (r) => String(r.name_ar ?? '') },
  { keys: ['address_id'], table: 'addresses', cols: 'id, label, neighborhood_name', name: (r) => [r.label, r.neighborhood_name].filter(Boolean).join(' – ') },
]
/** The section's own table, for rows whose id is the record itself. */
const SELF: Record<string, string> = {
  products: 'product_id',
  customers: 'customer_id',
  technicians: 'technician_id',
  orders: 'order_id',
  service_requests: 'request_id',
  work_orders: 'work_order_id',
  categories: 'category_id',
  customer_devices: 'device_id',
  addresses: 'address_id',
}

export interface AuditRow {
  id: number
  actor: string | null
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  entity: string
  entity_id: string | null
  before: Rec | null
  after: Rec | null
  created_at: string
}

export async function resolveNames(rows: AuditRow[], known: Names): Promise<Names> {
  const want = new Map<number, Set<string>>()
  const add = (i: number, v: unknown) => {
    if (typeof v === 'string' && UUID.test(v) && !(v in known)) (want.get(i) ?? want.set(i, new Set()).get(i)!).add(v)
  }
  for (const r of rows) {
    for (const rec of [r.before, r.after]) {
      if (!rec) continue
      LOOKUPS.forEach((l, i) => l.keys.forEach((k) => add(i, rec[k])))
    }
    // Whoever made a change without a staff account is a customer.
    add(1, r.actor)
    const self = SELF[r.entity]
    if (self) add(LOOKUPS.findIndex((l) => l.keys.includes(self)), r.entity_id)
  }
  const out: Names = {}
  await Promise.all(
    [...want.entries()].map(async ([i, ids]) => {
      const l = LOOKUPS[i]
      const list = [...ids]
      for (let s = 0; s < list.length; s += 100) {
        const { data } = await supabase.from(l.table).select(l.cols).in('id', list.slice(s, s + 100))
        for (const r of (data ?? []) as unknown as Rec[]) {
          const n = l.name(r)
          if (n) out[String(r.id)] = n
        }
      }
    }),
  )
  return out
}

/** One value, as a person would say it. */
export function showValue(entity: string, key: string, v: unknown, names: Names): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا'
  if (key === 'status' && STATUS_BY_ENTITY[entity]?.[String(v)]) return STATUS_BY_ENTITY[entity][String(v)]
  if (key === 'kind' && KIND_BY_ENTITY[entity]?.[String(v)]) return KIND_BY_ENTITY[entity][String(v)]
  if (CODES[key]?.[String(v)]) return CODES[key][String(v)]
  if (key === 'amount_halalas') return sar(Number(v) / 100)
  if (MONEY.has(key) && v !== '' && !Number.isNaN(Number(v))) return sar(Number(v))
  if (PHONES.has(key)) return formatSaudiPhoneLocal(String(v))
  if (key === 'vat_rate') return `${Math.round(Number(v) * (Number(v) < 1 ? 100 : 1))}٪`
  if (key === 'lat' || key === 'lng') return Number(v).toFixed(5)
  if (typeof v === 'string' && UUID.test(v)) return names[v] ?? 'سجل مرتبط'
  if (typeof v === 'string' && ISO.test(v)) return when(v)
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object' || x === null)) return v.length ? v.join('، ') : '—'
    return `${v.length} عنصر`
  }
  if (typeof v === 'object') return 'تفاصيل تقنية'
  return String(v)
}

/** The record's own name: product name, order number, customer… */
export function recordTitle(r: AuditRow, names: Names): string {
  const x = (r.after ?? r.before ?? {}) as Rec
  const direct = x.name_ar ?? x.title_ar ?? x.full_name ?? x.order_number ?? x.number ?? x.request_number ?? x.label ?? x.name ?? x.title
  if (direct) return String(direct)
  if (r.entity_id && names[r.entity_id]) return names[r.entity_id]
  const pick = (k: string) => (typeof x[k] === 'string' && names[x[k] as string]) || ''
  switch (r.entity) {
    case 'stock_movements':
      return [KIND_BY_ENTITY.stock_movements[String(x.kind)] ?? '', x.qty != null ? `${x.qty} ×` : '', pick('product_id')].filter(Boolean).join(' ')
    case 'approvals':
      return [APPROVAL_KIND_LABELS[x.kind as keyof typeof APPROVAL_KIND_LABELS] ?? 'طلب موافقة', x.amount != null ? sar(Number(x.amount)) : ''].filter(Boolean).join(' · ')
    case 'customers':
      return x.phone ? formatSaudiPhoneLocal(String(x.phone)) : ''
    case 'payments':
    case 'payment_requests':
      return [x.amount_halalas != null ? sar(Number(x.amount_halalas) / 100) : x.amount != null ? sar(Number(x.amount)) : '', pick('order_id')].filter(Boolean).join(' · ')
    case 'device_filters':
      return [pick('filter_product_id'), pick('device_id')].filter(Boolean).join(' · ')
    case 'role_permissions':
      return [x.page ? String(x.page) : '', pick('role_id')].filter(Boolean).join(' · ')
    case 'reviews':
      return x.rating ? `${'★'.repeat(Number(x.rating))} ${x.author_name ?? ''}`.trim() : ''
    case 'addresses':
      return [x.neighborhood_name, pick('customer_id')].filter(Boolean).join(' · ')
    case 'work_days':
      return CODES.day_of_week[String(x.day_of_week)] ?? ''
    default:
      return pick('customer_id') || pick('product_id') || pick('order_id') || pick('request_id') || ''
  }
}

export function changedFields(r: AuditRow): { key: string; from: unknown; to: unknown }[] {
  if (r.action !== 'UPDATE' || !r.before || !r.after) return []
  return Object.keys(r.after)
    .filter((k) => !HIDDEN.has(k) && JSON.stringify(r.before![k]) !== JSON.stringify(r.after![k]))
    .map((k) => ({ key: k, from: r.before![k], to: r.after![k] }))
}

/** For an added or removed record: the filled-in fields, labelled. */
export function recordFields(r: AuditRow): { key: string; value: unknown }[] {
  const x = (r.after ?? r.before ?? {}) as Rec
  return Object.keys(x)
    .filter((k) => !HIDDEN.has(k) && x[k] !== null && x[k] !== '' && !(Array.isArray(x[k]) && (x[k] as unknown[]).length === 0))
    .map((k) => ({ key: k, value: x[k] }))
}
