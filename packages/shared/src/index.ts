/**
 * Default VAT rate for Saudi Arabia (15%).
 * The live value is overridden by the `settings` table in Supabase.
 */
export const VAT_RATE = 0.15

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
