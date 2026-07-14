import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// auth ใช้ localStorage (default) — ห้ามเปลี่ยนกลับเป็น sessionStorage (2026-07-14):
// sessionStorage แยกของใครของมันต่อแท็บ → เปิดหลายแท็บ = แต่ละแท็บถือ refresh token คนละก๊อปปี้
// พอ token หมุน (rotation) แท็บที่ถือ token เก่าจะโดน server ปฏิเสธ → หลุด login เงียบๆ
// (อาการ: แท็บใหม่จาก ctrl+click เห็นเลขฝั่ง DR ปกติ แต่เลขฝั่ง Main เป็น 0 + เมนูหาย)
// localStorage แชร์ session ข้ามแท็บ + supabase-js ประสานการ refresh ให้เอง
// ส่วนความปลอดภัยเครื่องส่วนกลางมี auto-logout idle 30 นาทีคุมอยู่แล้ว (useAutoLogout ใน App.jsx)
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Second project — Daily Report & PM data
const supabaseDrUrl  = import.meta.env.VITE_SUPABASE_DR_URL  || 'https://eyhclzkifitbhbljgoav.supabase.co'
const supabaseDrKey  = import.meta.env.VITE_SUPABASE_DR_KEY  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aGNsemtpZml0YmhibGpnb2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODExMDQsImV4cCI6MjA5MjQ1NzEwNH0.fHTA70fQ8yAvQuwAeM9HQ_UQjMdR3FUkxu_klvXs-h4'

export const supabaseDR = createClient(supabaseDrUrl, supabaseDrKey)
