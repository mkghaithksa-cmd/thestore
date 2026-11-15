# منصة غيث لتنقية المياه

مستودع موحّد (monorepo) يعتمد على npm workspaces، ويضم متجر العملاء ولوحة الإدارة والكود المشترك وإعدادات Supabase.

## هيكل المشروع

| المسار | الوصف |
| --- | --- |
| `apps/store` | متجر العملاء — React + Vite + TypeScript (المنفذ 5173) |
| `apps/dashboard` | لوحة الإدارة والموظفين — React + Vite + TypeScript (المنفذ 5174) |
| `packages/shared` | الحزمة المشتركة `@ghaith/shared`: الأنواع والثوابت (مثل نسبة الضريبة وحالات الطلب) |
| `supabase` | إعدادات Supabase المحلية، ولاحقًا الـ migrations والدوال |
| `docs` | الخطة (`ghaith-10-day-plan.md`) والنماذج الأولية بصيغة HTML في `docs/prototype` |

## المتطلبات

- Node.js 20 أو أحدث
- npm 10 أو أحدث

## التشغيل

```bash
npm install
```

```bash
npm run dev:store
```

```bash
npm run dev:dashboard
```

أوامر أخرى:

- `npm run build` — بناء جميع الحزم والتطبيقات
- `npm run typecheck` — فحص الأنواع في كل الحزم

## متغيرات البيئة

انسخ ملف `.env.example` في كل تطبيق إلى `.env.local` ثم املأ القيم:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## قاعدة الأسرار ⚠️

- مفتاح `service_role` الخاص بـ Supabase ومفاتيح Moyasar (السرية) **لا تُرفع إلى git أبدًا**، ولا توضع في أي متغير يبدأ بـ `VITE_` لأن هذه المتغيرات تصل إلى المتصفح.
- مكانها الوحيد: أسرار Supabase Edge Functions أو إعدادات الاستضافة (Cloudflare) على الخادم.
- ملفات `.env` و`.env.*` مستثناة في `.gitignore`؛ فقط `.env.example` (بقيم فارغة) يُرفع.
