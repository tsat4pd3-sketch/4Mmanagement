import { createClient } from '@supabase/supabase-js'

// ไปเอา URL และ Anon Key มาจากหน้า Project Settings -> API ใน Supabase
const supabaseUrl = 'https://ewhdfqwfwofivojtsizn.supabase.co' // วาง URL ของคุณตรงนี้
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3aGRmcXdmd29maXZvanRzaXpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODA5NjYsImV4cCI6MjA5MjQ1Njk2Nn0.mGrLjRFmtNtpyAu3aBduKqixyb3AjQDCid06qpBzrxw' // วาง Anon Key ของคุณตรงนี้

export const supabase = createClient(supabaseUrl, supabaseAnonKey)