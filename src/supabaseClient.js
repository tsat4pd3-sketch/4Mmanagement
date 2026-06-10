import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Second project — Daily Report & PM data
// Set VITE_SUPABASE_DR_URL and VITE_SUPABASE_DR_KEY in your .env / hosting dashboard
// If using a single Supabase project, set both DR vars to the same values as above
const supabaseDrUrl  = import.meta.env.VITE_SUPABASE_DR_URL
const supabaseDrKey  = import.meta.env.VITE_SUPABASE_DR_KEY

if (!supabaseDrUrl || !supabaseDrKey) {
  console.error('[ESM] VITE_SUPABASE_DR_URL / VITE_SUPABASE_DR_KEY are not set. See docs/SETUP_GUIDE.md')
}

export const supabaseDR = createClient(supabaseDrUrl, supabaseDrKey)
