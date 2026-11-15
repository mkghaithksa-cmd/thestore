import type { Customer } from '@ghaith/shared'
import { supabase } from './supabase'

/** The signed-in customer's row (RLS returns only their own). */
export async function fetchMyCustomer(): Promise<Customer | null> {
  const { data, error } = await supabase.from('customers').select('*').maybeSingle()
  if (error) throw error
  return data as Customer | null
}

export interface ProfileInput {
  full_name: string
  email: string | null
}

/** Completes the short profile: name, optional email, privacy consent. */
export async function completeMyProfile(id: string, input: ProfileInput): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .update({
      full_name: input.full_name.trim(),
      email: input.email?.trim() || null,
      privacy_accepted_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data as Customer
}
