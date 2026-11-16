const base = import.meta.env.BASE_URL

/** Ghaith logo (coloured on light, white on dark) with the console label. */
export function BrandMark() {
  return (
    <div className="brand">
      <img src={`${base}brand/logo-color.png`} className="logo-color" alt="غيث" width="400" height="222" />
      <img src={`${base}brand/logo-white.png`} className="logo-white" alt="" aria-hidden="true" width="400" height="217" />
      <span>لوحة الإدارة</span>
    </div>
  )
}
