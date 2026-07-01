import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storage: window.sessionStorage },
})

// Second project — Daily Report & PM data
const supabaseDrUrl  = import.meta.env.VITE_SUPABASE_DR_URL  || 'https://eyhclzkifitbhbljgoav.supabase.co'
const supabaseDrKey  = import.meta.env.VITE_SUPABASE_DR_KEY  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aGNsemtpZml0YmhibGpnb2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODExMDQsImV4cCI6MjA5MjQ1NzEwNH0.fHTA70fQ8yAvQuwAeM9HQ_UQjMdR3FUkxu_klvXs-h4'

export const supabaseDR = createClient(supabaseDrUrl, supabaseDrKey)
