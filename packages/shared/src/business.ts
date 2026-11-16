/** Business details shown on the store (from the approved brand identity). */
export const BUSINESS = {
  legalName: 'مؤسسة تنقية غيث لأجهزة تحلية المياه',
  shortName: 'تنقية غيث',
  tagline: 'أجهزة تحلية المياه المنزلية والمطاعم — تركيب، صيانة، قطع غيار',
  phones: ['0541588481', '0570572188'],
  email: 'm.k.ghaith2030@gmail.com',
  city: 'مكة المكرمة',
  address: 'مكة المكرمة - حي الفيحاء - طريق أم المؤمنين',
  commercialRegister: '7051132293',
} as const

/** tel: link for a Saudi mobile written locally (05xxxxxxxx). */
export function telHref(local: string): string {
  return `tel:+966${local.replace(/^0/, '')}`
}
