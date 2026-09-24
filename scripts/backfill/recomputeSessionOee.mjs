/* ══════════════════════════════════════════════════════════════════════════════════
   คำนวณ OEE ของกะที่ปิดแล้วใหม่ ด้วย **สูตรจริงของระบบ** (`computeSessionOee` · oee.js §8)

   🔴 ทำไมต้องเป็นสคริปต์นี้ ไม่ใช่ SQL: เขียนสูตร OEE ซ้ำใน SQL = มีสูตร 2 ชุด (ผิดกฎ CLAUDE.md)
      สคริปต์นี้ import ตัวเดียวกับที่หน้าปิดกะใช้ ⇒ ผลที่ได้ = ผลที่ระบบจะได้ 100%

   โหมด:
     --verify        ตรวจว่าสูตรปัจจุบันคำนวณกะที่ปิดหลัง <since> ได้ตรงกับที่ stamp ไว้ (ไม่เขียนอะไร)
     --plan <ids>    แสดงผลก่อน/หลังของกะที่ระบุ (ไม่เขียนอะไร)
     --apply <ids>   เขียนจริง (ต้องมี --start HH:MM ต่อ id ผ่านไฟล์ plan)
   ══════════════════════════════════════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js';
import { computeSessionOee, sumDefectQty } from '../../src/utils/oee.js';

const DR_URL = 'https://eyhclzkifitbhbljgoav.supabase.co';
const DR_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aGNsemtpZml0YmhibGpnb2F2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODExMDQsImV4cCI6MjA5MjQ1NzEwNH0.fHTA70fQ8yAvQuwAeM9HQ_UQjMdR3FUkxu_klvXs-h4';
export const dr = createClient(DR_URL, DR_KEY);

/** master ที่ทุกกะใช้ร่วมกัน — โหลดรอบเดียว */
export async function loadMaster() {
  const [prodR, kbR, brkR, mcR] = await Promise.all([
    dr.from('dr_products').select('mat_no, name, p_no, cycle_time_sec, pair_mat_no, process_type'),
    dr.from('kanban_standards').select('mat_no, dr_products(name, p_no, cycle_time_sec, process_type)').eq('is_active', true),
    dr.from('break_policies').select('shift, process_type, start_time, duration_min, ot_scope').eq('is_active', true),
    dr.from('machines').select('machine_no, line_name, process_type, is_active'),
  ]);
  for (const [n, r] of [['dr_products', prodR], ['kanban_standards', kbR], ['break_policies', brkR], ['machines', mcR]])
    if (r.error) throw new Error(`โหลด ${n} ไม่สำเร็จ: ${r.error.message}`);
  return { products: prodR.data || [], kanbanStds: kbR.data || [], breakPolicies: brkR.data || [], machines: mcR.data || [] };
}

/** process_type ของกะ — ตรรกะเดียวกับ `sessionProcessType()` ใน DailyReport */
function processTypeOf(session, orders, master) {
  const lineMachines = master.machines.filter(m => m.line_name === session.line_name && m.process_type);
  if (lineMachines.length) {
    const c = {}; lineMachines.forEach(m => { c[m.process_type] = (c[m.process_type] || 0) + 1; });
    const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    if (top) return top[0];
  }
  const c = {};
  orders.forEach(o => {
    const pt = master.kanbanStds.find(s => s.mat_no === o.mat_no)?.dr_products?.process_type;
    if (pt) c[pt] = (c[pt] || 0) + 1;
  });
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || 'common';
}

/** คำนวณกะเดียว — startTime/endTime ว่าง = ใช้ค่าที่อยู่ในแถว */
export async function recompute(session, master, lineCfg, { startTime = null, endTime = null } = {}) {
  const [ordR, dtR, defR] = await Promise.all([
    dr.from('prod_orders').select('id, mat_no, status, qty, qty_actual, opened_at, confirmed_at, stopped_at').eq('session_id', session.id),
    dr.from('downtime_logs').select('id, session_id, duration_min, started_at, ended_at, machine_no, dr_downtime_types(name_th, category)').eq('session_id', session.id),
    dr.from('defect_logs').select('id, qty_ng, qty_suspect, is_trial, dr_defect_types(name_th, excl_from_q)').eq('session_id', session.id),
  ]);
  for (const [n, r] of [['prod_orders', ordR], ['downtime_logs', dtR], ['defect_logs', defR]])
    if (r.error) throw new Error(`กะ ${session.id} โหลด ${n} ไม่สำเร็จ: ${r.error.message}`);
  const orders = ordR.data || [], downtimes = dtR.data || [], defects = defR.data || [];
  const cfg = lineCfg[session.line_name] || {};
  return computeSessionOee({
    session, orders, downtimes,
    ngQty: sumDefectQty(defects, 'line'),
    products: master.products, kanbanStds: master.kanbanStds, breakPolicies: master.breakPolicies,
    processType: processTypeOf(session, orders, master),
    lineFlow: cfg,
    machineCount: new Set(master.machines
      .filter(m => m.line_name === session.line_name && m.is_active !== false).map(m => m.machine_no)).size,
    startTime: startTime || session.start_time,
    endTime: endTime || session.end_time,
  });
}

export const pct = (v) => (v == null ? null : parseFloat((v * 100).toFixed(2)));
