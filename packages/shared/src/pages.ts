/** Store pages the client writes from the dashboard (see the store_pages table). */
export type StorePageSlug = 'about' | 'shipping' | 'returns' | 'warranty' | 'privacy' | 'terms'

export interface StorePage {
  id: string
  slug: StorePageSlug
  title_ar: string
  body: string
  is_published: boolean
  sort_order: number
  updated_at: string
  updated_by: string | null
}

/** Default titles and order; used for footer links even before a page is published. */
export const STORE_PAGES: { slug: StorePageSlug; title: string; hint: string }[] = [
  { slug: 'about', title: 'من نحن', hint: 'قصة المؤسسة، وخبرتها، ووش يميزها.' },
  { slug: 'shipping', title: 'الشحن والتوصيل', hint: 'مدة التوصيل داخل مكة والشحن لباقي المدن، والرسوم.' },
  { slug: 'returns', title: 'الإلغاء والاسترداد', hint: 'متى يقدر العميل يلغي أو يرجع، وكيف يسترد مبلغه.' },
  { slug: 'warranty', title: 'الضمان', hint: 'مدة ضمان الأجهزة، وما يشمله وما لا يشمله.' },
  { slug: 'privacy', title: 'سياسة الخصوصية', hint: 'البيانات اللي نجمعها (الجوال، العنوان، الموقع) وكيف نستخدمها.' },
  { slug: 'terms', title: 'الشروط والأحكام', hint: 'شروط استخدام المتجر والشراء.' },
]

export const isStorePageSlug = (s: string | undefined): s is StorePageSlug => STORE_PAGES.some((p) => p.slug === s)

export type PageBlock = { kind: 'h'; text: string } | { kind: 'p'; text: string } | { kind: 'ul'; items: string[] }

/**
 * The page text format, kept simple for the client:
 * a blank line starts a new paragraph, "## " starts a heading, "- " a list item.
 * Rendered as plain text (never as HTML), so nothing typed can inject markup.
 */
export function parsePageBody(body: string): PageBlock[] {
  const blocks: PageBlock[] = []
  let para: string[] = []
  let list: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join('\n') })
    if (list.length) blocks.push({ kind: 'ul', items: list })
    para = []
    list = []
  }
  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
    } else if (line.startsWith('## ') || line.startsWith('# ')) {
      flush()
      blocks.push({ kind: 'h', text: line.replace(/^#+\s*/, '') })
    } else if (/^[-•*]\s+/.test(line)) {
      if (para.length) {
        blocks.push({ kind: 'p', text: para.join('\n') })
        para = []
      }
      list.push(line.replace(/^[-•*]\s+/, ''))
    } else {
      if (list.length) {
        blocks.push({ kind: 'ul', items: list })
        list = []
      }
      para.push(line)
    }
  }
  flush()
  return blocks
}
