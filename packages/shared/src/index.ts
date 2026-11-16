// VAT, fees and service areas are read from the `settings` tables only —
// never hard-coded here.

export type ProductType = 'device' | 'filter' | 'part' | 'service' | 'bundle'

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'preparing'
  | 'shipped'
  | 'installing'
  | 'delivered'
  | 'completed'
  | 'cancelled'

export * from './catalog'
export * from './customer'
export * from './staff'
export * from './business'
export * from './location'
export * from './pages'
