// Cloudflare Pages worker for the store (copied to dist/_worker.js at build).
//
// The store is a single-page app, so Google, WhatsApp and X would all see the
// same empty page. For the public pages this worker puts the right title,
// description, picture and product data into the HTML before it is sent, and
// it serves /sitemap.xml and /robots.txt from the live catalog.
//
// Only the paths in _routes.json reach it; everything else (assets, the
// admin dashboard) is served by Pages directly. Any failure falls back to the
// plain page, so the store never breaks because of this file.
//
// Only the public Supabase URL and publishable key are used here (replaced at
// build time). They are already public in the store's JavaScript.

const SB_URL = '__SUPABASE_URL__'
const SB_KEY = '__SUPABASE_KEY__'

const SITE = 'غيث لتنقية المياه'
const DEFAULT_DESC =
  'أجهزة تنقية وتحلية المياه المنزلية وفلاترها وقطع غيارها، مع التركيب والصيانة داخل مكة المكرمة والشحن لكل مدن المملكة.'
const PAGES = {
  about: 'من نحن',
  shipping: 'الشحن والتوصيل',
  returns: 'الإلغاء والاسترداد',
  warranty: 'الضمان',
  privacy: 'سياسة الخصوصية',
  terms: 'الشروط والأحكام',
}
const PRIVATE = ['/cart', '/login', '/account', '/orders']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function sb(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' },
    cf: { cacheTtl: 300, cacheEverything: true },
  })
  if (!r.ok) throw new Error(`supabase ${r.status}`)
  return r.json()
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function clip(text, n = 160) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}

function imageUrl(p) {
  const first = [...(p.images || [])].sort((a, b) => a.sort_order - b.sort_order)[0]
  if (first) return `${SB_URL}/storage/v1/object/public/product-images/${first.storage_path}`
  return p.image_url || null
}

/** Everything a page says about itself: Google, link previews and structured data. */
function headTags({ title, description, url, image, type = 'website', noindex = false, jsonLd = null, price = null }) {
  const t = [
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:site_name" content="${esc(SITE)}">`,
    `<meta property="og:locale" content="ar_SA">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta name="twitter:card" content="${type === 'product' ? 'summary_large_image' : 'summary'}">`,
  ]
  if (image) t.push(`<meta property="og:image" content="${esc(image)}">`, `<meta name="twitter:image" content="${esc(image)}">`)
  if (price != null) {
    t.push(`<meta property="product:price:amount" content="${price.toFixed(2)}">`, `<meta property="product:price:currency" content="SAR">`)
  }
  if (noindex) t.push(`<meta name="robots" content="noindex, follow">`)
  if (jsonLd) t.push(`<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`)
  return t.join('\n')
}

async function metaFor(url) {
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const origin = url.origin
  const logo = `${origin}/brand/logo-color.png`
  const base = { url: origin + path, image: logo }

  if (path === '/') {
    return {
      ...base,
      title: `${SITE} | أجهزة وفلاتر وصيانة في مكة`,
      description: DEFAULT_DESC,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Store',
        name: SITE,
        url: origin + '/',
        logo,
        image: logo,
        address: { '@type': 'PostalAddress', addressLocality: 'مكة المكرمة', addressCountry: 'SA' },
        areaServed: 'SA',
      },
    }
  }

  if (path === '/products') {
    const cat = url.searchParams.get('cat')
    if (cat && /^[a-z0-9-]{1,60}$/.test(cat)) {
      const [c] = await sb(`categories?select=name_ar,slug&slug=eq.${cat}&limit=1`)
      if (c) {
        return {
          ...base,
          url: `${origin}/products?cat=${encodeURIComponent(c.slug)}`,
          title: `${c.name_ar} | ${SITE}`,
          description: clip(`تسوّق ${c.name_ar} من ${SITE}: أسعار شاملة الضريبة، والتركيب داخل مكة المكرمة، والشحن لكل مدن المملكة.`),
        }
      }
    }
    return { ...base, title: `كل المنتجات | ${SITE}`, description: clip(`أجهزة تحلية ومنقيات، وفلاتر، وقطع غيار، وباقات توفير. ${DEFAULT_DESC}`) }
  }

  const prod = path.match(/^\/products\/([^/]+)$/)
  if (prod) {
    const key = decodeURIComponent(prod[1])
    const filter = UUID.test(key) ? `id=eq.${key}` : /^[A-Za-z0-9-]{1,40}$/.test(key) ? `sku=ilike.${key}` : null
    const [rows, settings] = await Promise.all([
      filter
        ? sb(
            `products?select=id,sku,name_ar,name_en,description_ar,price_before_vat,image_url,model,manufacturer:manufacturers(name),category:categories(name_ar),images:product_images(storage_path,sort_order)&status=eq.published&${filter}&limit=1`,
          )
        : [],
      sb('settings?select=vat_rate&id=eq.1'),
    ])
    const p = rows[0]
    if (!p) return { ...base, status: 404, noindex: true, title: `المنتج غير متوفر | ${SITE}`, description: DEFAULT_DESC }
    const vat = Number(settings[0]?.vat_rate ?? 0.15)
    const price = Math.round(Number(p.price_before_vat) * (1 + vat) * 100) / 100
    const image = imageUrl(p)
    const pageUrl = `${origin}/products/${encodeURIComponent(p.sku)}`
    const description = clip(p.description_ar || `${p.name_ar} بسعر ${price} ر.س شامل الضريبة. ${DEFAULT_DESC}`)
    return {
      url: pageUrl,
      image: image || logo,
      type: 'product',
      price,
      title: `${p.name_ar} | ${SITE}`,
      description,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.name_ar,
        ...(p.name_en ? { alternateName: p.name_en } : {}),
        sku: p.sku,
        ...(p.model ? { model: p.model } : {}),
        ...(p.manufacturer ? { brand: { '@type': 'Brand', name: p.manufacturer.name } } : {}),
        ...(p.category ? { category: p.category.name_ar } : {}),
        description,
        ...(image ? { image: [image] } : {}),
        offers: {
          '@type': 'Offer',
          url: pageUrl,
          priceCurrency: 'SAR',
          price: price.toFixed(2),
          availability: 'https://schema.org/InStock',
          itemCondition: 'https://schema.org/NewCondition',
          seller: { '@type': 'Organization', name: SITE },
        },
      },
    }
  }

  if (path === '/maintenance') {
    return {
      ...base,
      title: `الصيانة والبلاغات | ${SITE}`,
      description: clip('بلّغ عن عطل في جهاز تنقية المياه أو احجز تغيير الفلاتر داخل مكة المكرمة، ونتصل فيك نأكد الموعد. بدون دفع مسبق.'),
    }
  }

  const page = path.match(/^\/pages\/([a-z]+)$/)
  if (page && PAGES[page[1]]) {
    const [row] = await sb(`store_pages?select=title_ar,body&slug=eq.${page[1]}&is_published=eq.true&limit=1`)
    const title = row?.title_ar || PAGES[page[1]]
    const text = row?.body ? row.body.replace(/^#+\s*|^-\s*/gm, '') : ''
    return { ...base, title: `${title} | ${SITE}`, description: clip(text || `${title} في ${SITE}.`), noindex: !row }
  }

  if (PRIVATE.includes(path)) return { ...base, title: SITE, description: DEFAULT_DESC, noindex: true }
  return null
}

async function renderPage(request, env) {
  const url = new URL(request.url)
  // Single-page app: every route is the same index.html.
  const shell = await env.ASSETS.fetch(new Request(new URL('/', url), request))
  let meta = null
  try {
    meta = await metaFor(url)
  } catch {
    return shell
  }
  if (!meta || !shell.ok) return shell
  const tags = headTags(meta)
  const out = new HTMLRewriter()
    .on('title', { element: (e) => e.setInnerContent(meta.title) })
    .on('meta[name="description"]', { element: (e) => e.remove() })
    .on('meta[property^="og:"]', { element: (e) => e.remove() })
    .on('head', { element: (e) => e.append(tags, { html: true }) })
    .transform(shell)
  const headers = new Headers(out.headers)
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate')
  return new Response(out.body, { status: meta.status || 200, headers })
}

async function sitemap(url) {
  const origin = url.origin
  const [products, categories, pages] = await Promise.all([
    sb('products?select=sku,updated_at&status=eq.published&order=created_at'),
    sb('categories?select=slug&order=sort_order'),
    sb('store_pages?select=slug,updated_at&is_published=eq.true'),
  ])
  const entry = (loc, lastmod) =>
    `  <url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${String(lastmod).slice(0, 10)}</lastmod>` : ''}</url>`
  const lines = [
    entry(`${origin}/`),
    entry(`${origin}/products`),
    entry(`${origin}/maintenance`),
    ...categories.map((c) => entry(`${origin}/products?cat=${encodeURIComponent(c.slug)}`)),
    ...products.map((p) => entry(`${origin}/products/${encodeURIComponent(p.sku)}`, p.updated_at)),
    ...pages.map((p) => entry(`${origin}/pages/${p.slug}`, p.updated_at)),
  ]
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join('\n')}\n</urlset>\n`
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}

function robots(url) {
  // The admin path is hidden on purpose: it sends its own noindex header and is not listed here.
  const body = ['User-agent: *', 'Allow: /', ...PRIVATE.map((p) => `Disallow: ${p}`), '', `Sitemap: ${url.origin}/sitemap.xml`, ''].join('\n')
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') return env.ASSETS.fetch(request)
      if (url.pathname === '/robots.txt') return robots(url)
      if (url.pathname === '/sitemap.xml') return await sitemap(url)
      return await renderPage(request, env)
    } catch {
      return env.ASSETS.fetch(request)
    }
  },
}
