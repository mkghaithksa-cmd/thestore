/** Home page builder sections and reviews (see the home_sections and reviews tables). */

export type HomeSectionKey =
  | 'announcement'
  | 'hero'
  | 'benefits'
  | 'categories'
  | 'featured'
  | 'promos'
  | 'bundles'
  | 'service'
  | 'reviews'
  | 'about'

export type Audience = 'all' | 'mecca' | 'outside'

export type BenefitIcon = 'tools' | 'shield' | 'lock' | 'truck' | 'drop' | 'phone' | 'star' | 'clock'

export interface BenefitItem {
  icon: BenefitIcon
  title: string
  text: string
}

/** Everything a section may carry; each section uses only its own fields. */
export interface HomeSectionConfig {
  /** announcement */
  text?: string
  starts_at?: string | null
  ends_at?: string | null
  /** hero (when no banners), service, about, announcement */
  link?: string
  button?: string
  /** service, about: path inside the banners bucket */
  image_path?: string | null
  /** benefits */
  items?: BenefitItem[]
  /** featured: chosen products in order; empty = all products marked featured */
  product_ids?: string[]
}

export interface HomeSection {
  id: string
  key: HomeSectionKey
  title_ar: string
  subtitle_ar: string
  is_visible: boolean
  sort_order: number
  audience: Audience
  config: HomeSectionConfig
  updated_at: string
  updated_by: string | null
}

export const HOME_SECTION_INFO: Record<HomeSectionKey, { label: string; hint: string }> = {
  announcement: { label: 'شريط إعلان علوي', hint: 'سطر قصير فوق الصفحة: عرض، أو رسالة، مع رابط ومدة.' },
  hero: { label: 'البنر الرئيسي', hint: 'السلايدر في أعلى الصفحة. بدون بنرات يظهر ترحيب بالعنوان والنص.' },
  benefits: { label: 'شريط المزايا', hint: 'أربع مزايا قصيرة تبني الثقة.' },
  categories: { label: 'التصنيفات بالصور', hint: 'مربعات التصنيفات الرئيسية، ولكل تصنيف صورة.' },
  featured: { label: 'منتجات مميزة', hint: 'تختار المنتجات وترتيبها، أو تُعرض المنتجات المعلَّمة «مميز».' },
  promos: { label: 'بنرات وسط الصفحة', hint: 'بنران جنب بعض لعروض ثانوية.' },
  bundles: { label: 'الباقات', hint: 'تُعرض الباقات المنشورة تلقائياً.' },
  service: { label: 'قسم الصيانة وتغيير الفلاتر', hint: 'دعوة لطلب الفلاتر أو الصيانة، مع صورة.' },
  reviews: { label: 'آراء العملاء', hint: 'التقييمات اللي ميّزتها من صفحة التقييمات.' },
  about: { label: 'عن غيث باختصار', hint: 'تعريف قصير وصورة ورابط لصفحة «من نحن».' },
}

export const AUDIENCE_LABELS: Record<Audience, string> = {
  all: 'الكل',
  mecca: 'داخل مكة فقط',
  outside: 'خارج مكة فقط',
}

export const BENEFIT_ICONS: { key: BenefitIcon; label: string }[] = [
  { key: 'tools', label: 'تركيب' },
  { key: 'shield', label: 'ضمان' },
  { key: 'lock', label: 'دفع آمن' },
  { key: 'truck', label: 'شحن' },
  { key: 'drop', label: 'ماء' },
  { key: 'phone', label: 'تواصل' },
  { key: 'star', label: 'جودة' },
  { key: 'clock', label: 'سرعة' },
]

/** Recommended image sizes for the builder's image spots (pixels). */
export const HOME_IMAGE_SIZES = {
  promo: { width: 1200, height: 600, label: 'بنر وسط الصفحة' },
  service: { width: 1200, height: 600, label: 'صورة قسم الصيانة' },
  about: { width: 1200, height: 800, label: 'صورة «عن غيث»' },
  category: { width: 600, height: 600, label: 'صورة التصنيف' },
} as const

/** Whether a section shows for this visitor (unknown location counts as Mecca, like the rest of the store). */
export function sectionShows(s: Pick<HomeSection, 'is_visible' | 'audience'>, inMecca: boolean): boolean {
  if (!s.is_visible) return false
  if (s.audience === 'mecca') return inMecca
  if (s.audience === 'outside') return !inMecca
  return true
}

export const MAX_MID_BANNERS = 2

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export interface Review {
  id: string
  product_id: string
  author_name: string
  city: string | null
  rating: number
  body: string
  status: ReviewStatus
  is_featured: boolean
  is_sample: boolean
  created_at: string
}

/** Columns the public may read (anon has column grants, so never select *). */
export const PUBLIC_REVIEW_COLUMNS = 'id, product_id, author_name, city, rating, body, status, is_featured, is_sample, created_at'

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'بانتظار المراجعة',
  approved: 'مقبول',
  rejected: 'مرفوض',
}
