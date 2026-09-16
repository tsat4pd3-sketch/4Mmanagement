import { createClient } from '@supabase/supabase-js'
import { setActor, getActor, actorFields } from './utils/actorStamp'

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

// ═══ DR actor stamping (traceability) — 2026-07-24 · เพิ่ม uid 2026-09-16 ═══════════════════
// DR เป็น anon เสมอ → ฐานข้อมูลไม่รู้ว่าใครแก้ · trigger fn_audit อ่าน updated_by_name/_uid เป็น actor
// ที่นี่ wrap supabaseDR.from ให้ฝัง updated_by_name + updated_by_uid ของ user ปัจจุบัน อัตโนมัติ
// ทุก update/upsert/insert ของตาราง master ที่มี audit — ครอบทุกหน้าในทีเดียว ไม่ต้องไล่แก้ handler รายจุด
//
// ⚠️ ตารางในลิสต์นี้ต้องมี **ทั้ง** updated_by_name และ updated_by_uid ไม่งั้น write พัง
//    migration: 20260724_dr_updated_by_name.sql (ชื่อ) + 20260916_actor_uid_dr_phase1.sql (uid)
//    เพิ่มตารางเข้าลิสต์นี้ = ต้องเพิ่มคอลัมน์ทั้งสองในฐานก่อนเสมอ
//
// 🔴 uid ที่ stamp จากตรงนี้ไม่ใช่หลักฐานที่ verify ฝั่ง server ได้ (client เป็น anon ส่งอะไรมาก็ได้)
//    มันคือคีย์สำหรับ "นับคน/join" ให้รายงานตอบถูก — ไม่ใช่ลายเซ็น ดู src/utils/actorStamp.js
export const DR_AUDIT_TABLES = new Set([
  'dr_products','kanban_standards','checklists','jig_checkpoints','jigs','pm_plans','machines',
  'dr_defect_types','dr_downtime_types','machine_types','process_types','container_types',
  'mtn_technicians','mtn_spare_parts','mtn_spare_categories','mtn_problem_types','mtn_repair_types','mtn_labor_rates','mtn_item_types',
  'pm_daily_line_targets','pm_facility_areas','pm_checking_methods','pm_checkpoint_categories',
  'ship_to_plants','shipping_workflow_steps','dt_alert_config','stock_inflow_rules','lot_post_configs',
  'kanban_calc_settings','kanban_targets','product_packaging','scrap_defect_types',
  'energy_monthly',
  'machine_automation_levels','machine_operation_modes',
  'die_sets','equipment_die','die_op_types','die_storage_areas','storage_zones','storage_locations',
  'part_routings',
  'quality_bin_records',
  'line_part_levels',   // min/max พาร์ทต่อไลน์ — ค่าที่คนตั้งเอง ต้องรู้ว่าใครแก้เมื่อไหร่
  'line_delivery_points',   // จุดส่งงานหน้าไลน์ (QR ESM:D) — ลูปสโตร์เฟส 4 (2026-09-03)
])
// ตัวตนผู้ใช้เก็บที่ actorStamp.js จุดเดียว (ห้ามเก็บซ้ำที่นี่ — เคยมี 2 เจ้าของแล้ว drift)
// setDrActorName คงไว้เพื่อ backward-compat ของผู้เรียกเดิม → ส่งต่อให้ setActor
export const setDrActorName = (name) => { setActor(getActor().uid, name) }

const _drFrom = supabaseDR.from.bind(supabaseDR)
supabaseDR.from = (table) => {
  const qb = _drFrom(table)
  if (!DR_AUDIT_TABLES.has(table)) return qb
  const stamp = (values) => {
    // actorFields() คืน {} เมื่อยังไม่รู้ตัวตน → spread แล้วไม่เปลี่ยนอะไร (ไม่ทับค่าเดิมด้วย null)
    const f = actorFields('updated_by')
    if (!Object.keys(f).length || !values || typeof values !== 'object') return values
    if (Array.isArray(values)) return values.map(v => (v && typeof v === 'object' && !Array.isArray(v)) ? { ...v, ...f } : v)
    return { ...values, ...f }
  }
  for (const m of ['update', 'upsert', 'insert']) {
    const orig = qb[m].bind(qb)
    qb[m] = (values, opts) => orig(stamp(values), opts)
  }
  return qb
}
