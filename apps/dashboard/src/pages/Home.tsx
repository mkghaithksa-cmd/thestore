import { useParams } from 'react-router-dom'
import { STAFF_PAGES, type StaffPage } from '@ghaith/shared'
import { RequirePage } from '../components/Layout'
import { useStaffAuth } from '../lib/staffAuth'

export function Home() {
  const { me } = useStaffAuth()
  return (
    <RequirePage page="dashboard">
      <div className="ph">
        <div>
          <h1>أهلاً {me?.profile.full_name}</h1>
          <p>دورك: {me?.roleName}</p>
        </div>
      </div>
      <div className="notice">
        <b>لوحة الإدارة قيد البناء.</b>
        <span className="muted">الصفحات المتاحة لك تظهر في القائمة حسب صلاحيات دورك.</span>
      </div>
    </RequirePage>
  )
}

/** Placeholder for pages built in later days. */
export function ComingSoon() {
  const { page } = useParams()
  const meta = STAFF_PAGES.find((p) => p.key === page)
  if (!meta) return <div className="notice">الصفحة غير موجودة.</div>
  return (
    <RequirePage page={meta.key as StaffPage}>
      <div className="ph">
        <h1>{meta.label}</h1>
      </div>
      <div className="notice">
        <b>هذه الصفحة تُبنى في الأيام القادمة من الخطة.</b>
      </div>
    </RequirePage>
  )
}
