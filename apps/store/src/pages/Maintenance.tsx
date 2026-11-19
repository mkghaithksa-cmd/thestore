import { Link } from 'react-router-dom'
import { BUSINESS, telHref } from '@ghaith/shared'
import { useAuth } from '../lib/auth'
import { usePageMeta } from '../lib/seo'

/** Shared entry to fault reports and maintenance (home strip, account page). */
export function ServiceLinks({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`svc-cards${compact ? ' compact' : ''}`}>
      <Link to="/service/new?kind=emergency" className="svc-card urgent">
        <span className="svc-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z" /></svg>
        </span>
        <span>
          <b>عندك عطل في الجهاز؟</b>
          <small>بلّغنا وفني يزورك. تسريب، ضعف ضغط، الجهاز ما يشتغل…</small>
        </span>
      </Link>
      <Link to="/service/new?kind=maintenance" className="svc-card">
        <span className="svc-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" /></svg>
        </span>
        <span>
          <b>احجز صيانة وتغيير فلاتر</b>
          <small>اختر اليوم والفترة، ونتصل فيك نأكد الموعد.</small>
        </span>
      </Link>
      <Link to="/devices" className="svc-card">
        <span className="svc-ico" aria-hidden="true">
          <svg viewBox="0 0 24 24"><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 9h6M9 13h6M9 17h4" /></svg>
        </span>
        <span>
          <b>أجهزتي ومواعيد الفلاتر</b>
          <small>شوف متى يحين تغيير كل فلتر.</small>
        </span>
      </Link>
    </div>
  )
}

/** /maintenance — public page: what we offer and where to start. */
export function Maintenance() {
  usePageMeta('الصيانة والبلاغات', 'بلّغ عن عطل في جهاز تنقية المياه أو احجز تغيير الفلاتر داخل مكة المكرمة، ونتصل فيك نأكد الموعد.')
  const { session } = useAuth()
  return (
    <div className="stack">
      <div className="stack-sm">
        <h1 className="page-h">الصيانة والبلاغات</h1>
        <p className="muted">خدمة الصيانة والزيارات داخل مكة المكرمة. تختار اليوم والفترة (الصباح أو المساء)، ونحدد الساعة ونتصل فيك نأكدها.</p>
      </div>
      <ServiceLinks />
      {session && (
        <Link to="/service" className="link">
          طلبات الصيانة السابقة ←
        </Link>
      )}
      <div className="card stack-sm">
        <b>تفضّل الاتصال؟</b>
        <span className="muted">كلمنا ونسجّل البلاغ عنك.</span>
        <div className="row wrapr">
          {BUSINESS.phones.map((p) => (
            <a key={p} href={telHref(p)} dir="ltr" className="btn sm ghost">
              {p}
            </a>
          ))}
        </div>
      </div>
      <ul className="svc-notes muted">
        <li>بلاغ العطل بدون دفع مسبق. رسوم الفحص تندفع عند الزيارة.</li>
        <li>إذا احتاج الجهاز قطع غيار نعطيك السعر قبل ما نركّبها.</li>
        <li>الأجهزة اللي اشتريتها منا تظهر في «أجهزتي» مع مواعيد تغيير الفلاتر، ونذكّرك قبل موعدها.</li>
      </ul>
    </div>
  )
}
