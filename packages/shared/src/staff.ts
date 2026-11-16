/** Admin console pages, in sidebar order. Keys match role_permissions.page. */
export const STAFF_PAGES = [
  { key: 'dashboard', label: 'لوحة الإدارة' },
  { key: 'orders', label: 'الطلبات والمتجر' },
  { key: 'appointments', label: 'المواعيد والبلاغات' },
  { key: 'work_orders', label: 'أوامر العمل' },
  { key: 'customers', label: 'العملاء والأجهزة' },
  { key: 'payments', label: 'المدفوعات والعهد' },
  { key: 'inventory', label: 'المخزون' },
  { key: 'catalog', label: 'المنتجات والكتالوج' },
  { key: 'reports', label: 'التقارير' },
  { key: 'users_roles', label: 'المستخدمون والأدوار' },
  { key: 'settings', label: 'الإعدادات والتكاملات' },
  { key: 'audit_log', label: 'سجل التدقيق' },
] as const

export type StaffPage = (typeof STAFF_PAGES)[number]['key']
export type PermissionAction = 'view' | 'add' | 'edit' | 'approve'

export const PERMISSION_ACTIONS: { key: PermissionAction; label: string }[] = [
  { key: 'view', label: 'عرض' },
  { key: 'add', label: 'إضافة' },
  { key: 'edit', label: 'تعديل' },
  { key: 'approve', label: 'اعتماد' },
]

export interface RolePermission {
  role_id: string
  page: StaffPage
  can_view: boolean
  can_add: boolean
  can_edit: boolean
  can_approve: boolean
}

export interface Role {
  id: string
  name: string
  is_locked: boolean
  is_active: boolean
  created_at: string
}

export interface StaffProfile {
  user_id: string
  full_name: string
  phone: string
  role_id: string
  is_active: boolean
  failed_attempts: number
  locked_until: string | null
  created_at: string
  updated_at: string
}

export const STAFF_CODE_LENGTH = 6
export const STAFF_MAX_ATTEMPTS = 5
export const STAFF_LOCK_MINUTES = 15

/** Arabic text for error codes returned by staff functions. */
export const STAFF_ERROR_MESSAGES: Record<string, string> = {
  invalid: 'رقم الجوال أو الرمز غير صحيح.',
  locked: `تم قفل الدخول مؤقتاً بعد ${STAFF_MAX_ATTEMPTS} محاولات خاطئة. حاول بعد ${STAFF_LOCK_MINUTES} دقيقة.`,
  disabled: 'هذا الحساب موقوف. تواصل مع مدير النظام.',
  forbidden: 'ليست لديك صلاحية لهذا الإجراء.',
  invalid_code: 'الرمز يجب أن يكون 6 أرقام.',
  invalid_phone: 'رقم الجوال غير صحيح (05XXXXXXXX).',
  invalid_name: 'أدخل الاسم الكامل.',
  invalid_role: 'اختر دوراً صحيحاً.',
  phone_taken: 'هذا الرقم مسجل لموظف آخر.',
  locked_admin: 'لا يمكن تعديل حساب مدير النظام إلا من صاحبه.',
  cannot_change_self: 'لا يمكنك تغيير دورك أو إيقاف حسابك بنفسك.',
  not_found: 'الموظف غير موجود.',
  already_bootstrapped: 'تم إنشاء مدير النظام مسبقاً.',
  unauthorized: 'انتهت الجلسة. سجّل الدخول من جديد.',
  server_error: 'حدث خطأ في الخادم. حاول مرة أخرى.',
}

export function staffErrorMessage(code: string | undefined | null): string {
  return (code && STAFF_ERROR_MESSAGES[code]) || STAFF_ERROR_MESSAGES.server_error
}

/** Random 6-digit staff code (uses the browser/Node crypto API). */
export function generateStaffCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000
  return String(n).padStart(STAFF_CODE_LENGTH, '0')
}

/**
 * The dashboard is published inside the store site under this hard-to-guess
 * path. It is not a security measure on its own: access is protected by the
 * staff code and by permission checks in the database.
 */
export const DASHBOARD_BASE_PATH = '/gh-ops-7k2/'
