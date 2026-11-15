import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL ?? ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are empty. Copy .env.example to .env.local and fill them in.',
  )
}

// Placeholder values keep the app from crashing when env vars are missing;
// requests will simply fail until real values are provided.
export const supabase = createClient(
  url || 'http://localhost:54321',
  anonKey || 'public-anon-key-missing',
)
