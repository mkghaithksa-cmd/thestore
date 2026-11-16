import { useEffect } from 'react'

export const SITE_NAME = 'غيث لتنقية المياه'
export const DEFAULT_DESCRIPTION =
  'أجهزة تنقية وتحلية المياه المنزلية وفلاترها وقطع غيارها، مع التركيب والصيانة داخل مكة المكرمة والشحن لكل مدن المملكة.'

function setDescription(text: string) {
  let el = document.querySelector<HTMLMetaElement>('meta[name="description"]')
  if (!el) {
    el = document.createElement('meta')
    el.name = 'description'
    document.head.appendChild(el)
  }
  el.content = text
}

/**
 * Title and description while moving inside the store. The first load already
 * has them from the server (apps/store/seo/worker.js); this keeps them right
 * after in-app navigation, which is also what Google sees when it runs the page.
 */
export function usePageMeta(title: string | null, description?: string | null) {
  useEffect(() => {
    if (!title) return
    document.title = title === SITE_NAME ? title : `${title} | ${SITE_NAME}`
    const d = (description || DEFAULT_DESCRIPTION).replace(/\s+/g, ' ').trim()
    setDescription(d.length > 160 ? d.slice(0, 159).trimEnd() + '…' : d)
    return () => {
      document.title = SITE_NAME
      setDescription(DEFAULT_DESCRIPTION)
    }
  }, [title, description])
}
