import { createClient } from '@supabase/supabase-js'
import { setActor, getActor, actorFields, applyStepActors } from './utils/actorStamp'

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
  'repair_wi_registry',      // ทะเบียน QRs ↔ WI ซ่อม (WI-PD3-069 §6) — doc_control แก้เองได้ ต้องรู้ว่าใครแก้
  'prod_problem_reports',    // ใบรายงานปัญหาการผลิต FM-PD1-019 (เก็บ 1 ปี) — เอกสารคุณภาพ ต้องสอบกลับได้
  'line_part_levels',   // min/max พาร์ทต่อไลน์ — ค่าที่คนตั้งเอง ต้องรู้ว่าใครแก้เมื่อไหร่
  'line_delivery_points',   // จุดส่งงานหน้าไลน์ (QR ESM:D) — ลูปสโตร์เฟส 4 (2026-09-03)
  'press_setup_rules',   // กฎเวลาเปลี่ยนรุ่นงานปั๊ม — ตัวเลขมาจากช่างปั๊ม ต้องรู้ว่าใครแก้เมื่อไหร่ (2026-09-25)
])
// ═══ คอลัมน์ "ผู้ทำงานแต่ละขั้น" ฝั่ง DR — 2026-09-16 ════════════════════════════════════
// ต่างจาก updated_by_* ข้างบน: อันนั้นคือ "ใครกดเซฟแถวนี้ล่าสุด" · อันนี้คือ "ใครทำขั้นตอนนี้"
// (ใครเปิดกะ · ใครยืนยันใบผลิต · ใครซ่อม · ใครตรวจรับ · ใครอนุมัติ · ใครจ่ายของ)
//
// wrapper เติม uid ให้อัตโนมัติ **เฉพาะเมื่อชื่อที่กำลังเขียน = ชื่อคนที่กำลังกด** เท่านั้น
// ชื่อคนอื่น (เลือกจาก PersonSelect) → หน้าเป็นคนส่ง uid มาเอง ที่นี่จะไม่เดาให้
//   ⇒ ดู applyStepActors() ใน actorStamp.js สำหรับกฎ "เขียนชื่อ = เขียน uid ทับเสมอ"
//
// ⚠️ คอลัมน์ uid ในลิสต์นี้ต้องมีจริงในฐาน (migration 20260916_actor_uid_phase2_workflow.sql)
const DR_STEP_ACTORS = {
  production_sessions: [['opened_by_name','opened_by_uid'], ['closed_by_name','closed_by_uid'],
    ['close_requested_by_name','close_requested_by_uid'], ['close_reject_by_name','close_reject_by_uid']],
  prod_orders: [['opened_by','opened_by_uid'], ['confirmed_by','confirmed_by_uid'], ['reopened_by','reopened_by_uid']],
  prod_order_qty_updates: [['logged_by','logged_by_uid']],
  downtime_logs: [['reported_by_name','reported_by_uid'], ['call_mtn_by','call_mtn_by_uid'],
    ['fix_by','fix_by_uid'], ['followup_by','followup_by_uid']],
  defect_logs: [['reported_by_name','reported_by_uid'], ['fix_by','fix_by_uid'], ['followup_by','followup_by_uid']],
  mtn_orders: [['reported_by_name','reported_by_uid'], ['reporter_prod','reporter_prod_uid'],
    ['reporter_qa','reporter_qa_uid'], ['accepted_by','accepted_by_uid'],
    ['tech_main','tech_main_uid'], ['tech_secondary','tech_secondary_uid'],
    ['checker_name','checker_uid'], ['qa_checker','qa_checker_uid'], ['qa_skipped_by','qa_skipped_by_uid'],
    ['ho_reporter','ho_reporter_uid'], ['ho_checker','ho_checker_uid'], ['approver_name','approver_uid'],
    ['dept_manager_name','dept_manager_uid'], ['plant_manager_name','plant_manager_uid'],
    ['cost_mgr_name','cost_mgr_uid'], ['satisfaction_by','satisfaction_by_uid'],
    ['mo_approved_by','mo_approved_by_uid']],
  mtn_order_parts: [['logged_by','logged_by_uid']],
  mtn_order_labor: [['worker_name','worker_uid'], ['logged_by','logged_by_uid']],
  mtn_order_handoffs: [['handed_by','handed_by_uid']],
  mtn_stock_txns: [['by_name','by_uid']],
  pm_plans: [['deferred_by','deferred_by_uid']],
  pm_plan_deferrals: [['by_name','by_uid']],
  pm_coordination_plans: [['created_by','created_by_uid']],
  fixture_shim_events: [['by_name','by_uid'], ['approved_by','approved_by_uid']],
  purchase_requests: [['ordered_by','ordered_by_uid'], ['received_by','received_by_uid']],
  line_stock_transactions: [['created_by','created_by_uid'], ['reviewed_by','reviewed_by_uid']],
  child_lot_requests: [['triggered_by','triggered_by_uid']],
  rack_requests: [['requested_by','requested_by_uid'], ['prepared_by','prepared_by_uid'],
    ['delivered_by','delivered_by_uid'], ['received_by','received_by_uid'], ['cancelled_by','cancelled_by_uid']],
  material_requests: [['requester_name','requester_uid'], ['made_by_name','made_by_uid'],
    ['approved_by_name','approved_by_uid'], ['received_by_name','received_by_uid'],
    ['recorded_by_name','recorded_by_uid'], ['checked_by_name','checked_by_uid']],
  customer_shipping_orders: [['shipped_by','shipped_by_uid'], ['created_by_name','created_by_uid']],
  demand_upload_batches: [['uploaded_by','uploaded_by_uid']],
  customer_pull_batches: [['uploaded_by','uploaded_by_uid']],
  kanban_deliveries: [['confirmed_by','confirmed_by_uid'], ['received_by','received_by_uid']],
  kanban_delivery_rounds: [['created_by','created_by_uid']],
  kanban_scans: [['scanned_by','scanned_by_uid']],
  kanban_targets: [['created_by','created_by_uid']],
  transport_round_assignments: [['assigned_by','assigned_by_uid']],
  quality_bin_records: [['reported_by','reported_by_uid'], ['qa_by','qa_by_uid'],
    ['repair_by','repair_by_uid'], ['disposed_by','disposed_by_uid']],
  prod_problem_reports: [['issued_by','issued_by_uid']],
  scrap_reports: [['inspector_name','inspector_uid'], ['requester_name','requester_uid'],
    ['approver_qa_name','approver_qa_uid'], ['approver_pd_name','approver_pd_uid'],
    ['approver_gm_name','approver_gm_uid'], ['sender_name','sender_uid'],
    ['receiver_name','receiver_uid'], ['created_by','created_by_uid']],
  improvements: [['created_by_name','created_by_uid']],
  vsm_maps: [['approved_by','approved_by_uid'], ['checked_by','checked_by_uid'], ['issued_by','issued_by_uid']],
  bom_items: [['created_by','created_by_uid']],
  parts_master: [['created_by','created_by_uid']],
  product_packaging: [['created_by','created_by_uid']],
  lot_post_configs: [['created_by','created_by_uid']],
}

// ═══ คอลัมน์ "ผู้ทำงานแต่ละขั้น" ฝั่ง Main — 2026-09-17 (เฟส 4) ══════════════════
// Main เป็น client ที่ login จริง (RLS รู้จัก auth.uid()) — แต่นั่นคือ "ใครเป็นคนกด"
// คนละเรื่องกับ "ใครเป็นผู้สอน/ผู้อนุมัติ/ผู้ตรวจ" ที่เก็บในแถว ⇒ ต้อง resolve จากชื่อเหมือนกัน
//
// ⚠️ wrapper นี้แตะเฉพาะตารางในลิสต์นี้ ตารางอื่นคืน query builder เดิมทั้งก้อน (ไม่แตะ auth/การอ่าน)
// ⚠️ คอลัมน์ uid ในลิสต์นี้ต้องมีจริงในฐาน (migration 20260916_actor_uid_phase2_workflow.sql ส่วน B)
//    ตรวจแล้ว 17/09: ครบทั้ง 48 คู่ — เพิ่มคู่ใหม่ต้อง migration ก่อนเสมอ ไม่งั้น write พัง 42703
// ตารางฝั่ง Main ที่หน้าเขียน updated_by_name เองอยู่แล้ว (BbsCheck) → เติม updated_by_uid ให้คู่กัน
const MAIN_AUDIT_TABLES = new Set(['bbs_sheets', 'bbs_observations', 'bbs_row_notes'])

const MAIN_STEP_ACTORS = {
  lpa_audits: [['auditor_name','auditor_uid']],
  bbs_sheets: [['inspector_name','inspector_uid']],
  safety_events: [['reported_by_name','reported_by_uid']],
  ojt_trainings: [['trainer_name','trainer_uid'], ['maker_name','maker_uid'],
    ['approver_name','approver_uid'], ['hr_name','hr_uid']],
  ojt_training_attendees: [['evaluator_name','evaluator_uid']],
  line_helpers: [['created_by_name','created_by_uid']],
  kpi_actuals: [['entered_by','entered_by_uid']],
  user_feedback: [['handled_by','handled_by_uid']],
  pokayoke_checks: [['checker_name','checker_uid']],
  pe_doc_sets: [['created_by_name','created_by_uid']],
  pe_doc_revisions: [['issued_by','issued_by_uid'], ['checked_by','checked_by_uid'], ['approved_by','approved_by_uid']],
  pe_change_requests: [['created_by','created_by_uid'], ['decided_by','decided_by_uid']],
  npi_projects: [['created_by_name','created_by_uid']],
  npi_tasks: [['created_by_name','created_by_uid']],
  npi_deliverables: [['approved_by','approved_by_uid']],
  npi_drawing_revisions: [['released_by','released_by_uid']],
  npi_change_requests: [['requested_by','requested_by_uid'], ['decided_by','decided_by_uid']],
  npi_tooling_plans: [['maker_name','maker_uid']],
  qa_inspection_sheets: [['inspector_name','inspector_uid'], ['created_by','created_by_uid'], ['closed_by','closed_by_uid']],
  qa_inspection_results: [['recorded_by','recorded_by_uid']],
  qa_inspection_pieces: [['recorded_by','recorded_by_uid']],
  qa_inspection_actions: [['action_by','action_by_uid'], ['recorded_by','recorded_by_uid']],
  qa_ncr: [['disposition_by','disposition_by_uid'], ['created_by','created_by_uid'], ['closed_by','closed_by_uid']],
  qa_capa: [['created_by','created_by_uid']],
  qa_customer_claims: [['created_by','created_by_uid'], ['closed_by','closed_by_uid']],
  qa_measurements: [['created_by','created_by_uid']],
  qa_parts: [['created_by','created_by_uid']],
  qa_characteristics: [['created_by','created_by_uid']],
  qa_instruments: [['cal_by','cal_by_uid']],
  wip_replenish_requests: [['requested_by','requested_by_uid'], ['delivered_by','delivered_by_uid'],
    ['picked_by_name','picked_by_uid'], ['received_by_name','received_by_uid'],
    ['decided_by_name','decided_by_uid'], ['hold_by_name','hold_by_uid']],
}

// ตัวตนผู้ใช้เก็บที่ actorStamp.js จุดเดียว (ห้ามเก็บซ้ำที่นี่ — เคยมี 2 เจ้าของแล้ว drift)
// setDrActorName คงไว้เพื่อ backward-compat ของผู้เรียกเดิม → ส่งต่อให้ setActor
export const setDrActorName = (name) => { setActor(getActor().uid, name) }

/* ตัว stamp ร่วมของทั้งสอง client — ห่อ insert/update/upsert แล้วเติมคอลัมน์คนทำก่อนส่ง
   ตารางที่ไม่อยู่ในลิสต์ = คืน query builder เดิมตรงๆ (ไม่มี overhead ไม่มีผลข้างเคียง) */
function withActorStamp(client, { audit, steps }) {
  const orig = client.from.bind(client)
  client.from = (table) => {
    const qb = orig(table)
    const pairs = steps?.[table]
    const isAudit = !!audit?.has(table)
    if (!isAudit && !pairs) return qb
    const stampOne = (v) => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return v
      let out = v
      if (isAudit) {
        // actorFields() คืน {} เมื่อยังไม่รู้ตัวตน → ไม่ทับค่าเดิมด้วย null
        const f = actorFields('updated_by')
        if (Object.keys(f).length) out = { ...out, ...f }
      }
      if (pairs) out = applyStepActors(pairs, out, getActor())
      return out
    }
    const stamp = (values) => (Array.isArray(values) ? values.map(stampOne) : stampOne(values))
    for (const m of ['update', 'upsert', 'insert']) {
      const o = qb[m].bind(qb)
      qb[m] = (values, opts) => o(stamp(values), opts)
    }
    return qb
  }
}

withActorStamp(supabaseDR, { audit: DR_AUDIT_TABLES, steps: DR_STEP_ACTORS })
withActorStamp(supabase, { audit: MAIN_AUDIT_TABLES, steps: MAIN_STEP_ACTORS })
