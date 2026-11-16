import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** Error carrying the function's error code (see STAFF_ERROR_MESSAGES). */
export class FunctionError extends Error {
  code: string
  details: Record<string, unknown>
  constructor(code: string, details: Record<string, unknown> = {}) {
    super(code)
    this.code = code
    this.details = details
  }
}

/** Calls an Edge Function and returns its JSON, or throws FunctionError. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (!error) return data as T
  if (error instanceof FunctionsHttpError) {
    const payload = await error.context.json().catch(() => ({}))
    throw new FunctionError(payload.error ?? 'server_error', payload)
  }
  throw new FunctionError('server_error')
}

/** Extracts our error code from a database function error message. */
export function rpcErrorCode(message: string | undefined): string {
  const known = [
    'forbidden', 'invalid_code', 'invalid_phone', 'invalid_name', 'invalid_role',
    'phone_taken', 'locked_admin', 'not_found', 'cannot_change_self',
  ]
  return known.find((k) => message?.includes(k)) ?? 'server_error'
}
