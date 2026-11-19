// Day 8: maintenance, fault reports and appointments.

export type ServiceKind = 'emergency' | 'maintenance'
export type ServiceStatus = 'new' | 'scheduled' | 'in_progress' | 'done' | 'cancelled'
export type ServicePeriod = 'morning' | 'evening'
export type ContactOutcome = 'agreed' | 'postponed' | 'declined' | 'no_answer'
export type DeviceKind = 'under_sink' | 'central' | 'cooler' | 'other'

export const DEVICE_KIND_LABELS: Record<DeviceKind, string> = {
  under_sink: 'منقي تحت المغسلة',
  central: 'جهاز مركزي للبيت',
  cooler: 'برادة مياه',
  other: 'غير ذلك',
}

export interface ServiceRequest {
  id: string
  request_number: string
  kind: ServiceKind
  source: 'web' | 'phone'
  customer_id: string | null
  contact_name: string
  contact_phone: string
  device_id: string | null
  fault_type: string | null
  description: string | null
  photo_path: string | null
  preferred_date: string
  preferred_period: ServicePeriod
  address_id: string | null
  city: string
  neighborhood_name: string | null
  street: string | null
  lat: number | null
  lng: number | null
  inspection_fee: number
  status: ServiceStatus
  scheduled_at: string | null
  technician_id: string | null
  done_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  created_at: string
}

export interface ServiceRequestEvent {
  id: string
  request_id: string
  from_status: ServiceStatus | null
  to_status: ServiceStatus
  scheduled_at: string | null
  note: string | null
  created_at: string
}

export interface DeviceFilter {
  id: string
  device_id: string
  filter_product_id: string | null
  stage_number: number | null
  name_ar: string
  life_months: number
  last_changed_on: string
  next_due_on: string
  is_active: boolean
}

export const SERVICE_KIND_LABELS: Record<ServiceKind, string> = {
  emergency: 'بلاغ عطل',
  maintenance: 'صيانة دورية',
}

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  new: 'بانتظار تحديد الموعد',
  scheduled: 'تم تحديد الموعد',
  in_progress: 'الفني في الطريق / يشتغل',
  done: 'تمت الزيارة',
  cancelled: 'ملغي',
}

export const PERIOD_LABELS: Record<ServicePeriod, string> = {
  morning: 'الصباح',
  evening: 'المساء',
}

export const OUTCOME_LABELS: Record<ContactOutcome, string> = {
  agreed: 'وافق',
  postponed: 'أجّل',
  declined: 'رفض',
  no_answer: 'ما رد',
}

export const OPEN_SERVICE_STATUSES: ServiceStatus[] = ['new', 'scheduled', 'in_progress']

/** How far into its life a filter is (0–100+), by calendar days. */
export function filterUsage(f: Pick<DeviceFilter, 'last_changed_on' | 'next_due_on'>, today = new Date()): number {
  const start = Date.parse(f.last_changed_on)
  const end = Date.parse(f.next_due_on)
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  if (!(end > start)) return 100
  return Math.max(0, Math.round(((now - start) / (end - start)) * 100))
}

/** Whole days from today until the date (negative when overdue). */
export function daysUntil(isoDate: string, today = new Date()): number {
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((Date.parse(isoDate) - now) / 86400000)
}

export const SERVICE_ERRORS: Record<string, string> = {
  not_allowed: 'ما عندك صلاحية لهذا الإجراء.',
  invalid_kind: 'اختر نوع الطلب.',
  invalid_period: 'اختر الفترة: الصباح أو المساء.',
  invalid_fault_type: 'اختر نوع العطل من القائمة.',
  fault_type_required: 'اختر نوع العطل.',
  invalid_date: 'التاريخ غير صحيح.',
  day_off: 'هذا اليوم إجازة. اختر يوم عمل.',
  device_not_found: 'الجهاز غير موجود.',
  device_required: 'اختر الجهاز.',
  address_required: 'حدد موقع البيت.',
  outside_service_area: 'خدمة الصيانة والبلاغات داخل مكة فقط.',
  neighborhood_required: 'اكتب اسم الحي.',
  invalid_neighborhood: 'اسم الحي أو الشارع طويل.',
  too_many_open: 'عندك طلبين مفتوحين. انتظر انتهاء أحدها أو اتصل بنا.',
  device_has_open_request: 'هذا الجهاز عليه طلب مفتوح.',
  invalid_photo: 'تعذّر رفع الصورة.',
  description_too_long: 'الوصف طويل (1000 حرف كحد أقصى).',
  name_required: 'اكتب الاسم.',
  request_not_found: 'الطلب غير موجود.',
  cannot_cancel: 'ما يمكن إلغاء الطلب الحين. اتصل بنا.',
  invalid_transition: 'ما يمكن نقل الطلب لهذه الحالة.',
  technician_not_found: 'الفني غير موجود.',
  reason_required: 'اكتب السبب.',
  note_too_long: 'الملاحظة طويلة.',
  invalid_outcome: 'اختر رد العميل.',
  invalid_phone: 'رقم الجوال غير صحيح. اكتبه بالشكل 05xxxxxxxx.',
  product_not_found: 'المنتج غير موجود.',
  invalid_life: 'عمر الفلتر من 1 إلى 60 شهر.',
  filter_not_found: 'الفلتر غير موجود.',
  invalid_device_kind: 'اختر نوع الجهاز.',
  invalid_brand: 'اسم الشركة طويل (60 حرف كحد أقصى).',
  invalid_stages: 'عدد المراحل من 1 إلى 12.',
  too_many_devices: 'وصلت الحد الأعلى للأجهزة (20). تواصل معنا.',
  invalid_fault_types: 'كل نوع عطل من 2 إلى 40 حرف، وما تكون القائمة فاضية.',
}

export function serviceErrorMessage(message: string | undefined | null): string {
  const code = Object.keys(SERVICE_ERRORS)
    .sort((a, b) => b.length - a.length)
    .find((k) => message?.includes(k))
  return code ? SERVICE_ERRORS[code] : 'تعذّر تنفيذ الطلب. حاول مرة ثانية.'
}

/** Fill the WhatsApp reminder text from settings: {الاسم} {الجهاز} {الفلاتر} {الموعد}. */
export function fillReminder(template: string, v: { name: string | null; device: string; filters: string[]; due: string }): string {
  const due = new Date(v.due + 'T12:00:00Z').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', timeZone: 'Asia/Riyadh' })
  return template
    .split('{الاسم}').join(v.name ?? '')
    .split('{الجهاز}').join(v.device)
    .split('{الفلاتر}').join(v.filters.join('، '))
    .split('{الموعد}').join(due)
    .replace(/ +([،,.؟])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim()
}
