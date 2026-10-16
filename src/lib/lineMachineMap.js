/* ══════════════════════════════════════════════════════════════════════════
   🗺️ lineMachineMap — โหลด "ผังไลน์ + หมุดเครื่อง + สถานะ PM ต่อเครื่อง" ที่เดียว (2026-10-16)

   ยกมาจาก `pages/MtnMachineLayout.jsx` (มุมมอง production) ให้ผังรวมโรงงาน (`FactoryMap` กล่องรายละเอียดไลน์)
   ใช้ตัวเดียวกัน — ห้ามมีตัวโหลด PM ต่อเครื่อง 2 ชุดที่ตัดสินสถานะต่างกัน
   · สถานะ PM = `resolvePlanDue` (lib/pmSchedule) — รู้จัก run_day · เฉพาะแผน active
   · หมุด = `machine_points` (Main) · รูป = `line_layouts` ของไลน์ ไม่มีถอยไปไลน์แม่
   ══════════════════════════════════════════════════════════════════════════ */
import { supabase, supabaseDR } from '../supabaseClient';
import { resolvePlanDue } from './pmSchedule';
import { isAmTeam } from '../utils/pmTeams';
import { getWorkDate } from '../utils/workDate';

// 'YYYY-MM-DD' → local-midnight Date (คณิตวันตรงปฏิทินไทย ไม่ใช่ UTC)
export function parseLocalDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** สถานะ PM ต่อ checklist ของอุปกรณ์ (module mtn) → { [jigId]: [{dept, am, status, nextDue, freq, clName}] } */
export async function loadPmForJigs(jigIds) {
  const out = {};
  jigIds.forEach(id => { out[id] = []; });
  if (!jigIds.length) return out;
  const { data: cls, error: e1 } = await supabaseDR.from('checklists').select('id, equipment_id, department, frequency, name').eq('module', 'mtn').in('equipment_id', jigIds);
  if (e1) throw e1;
  const clIds = (cls || []).map(c => c.id);
  let plans = [];
  // ⚠️ เฉพาะแผน active (เดิมไม่กรอง = แผนที่ปิดไปแล้วยังระบายสีหมุด) · select ครบให้ resolvePlanDue รู้ cycle_basis
  if (clIds.length) {
    const { data, error } = await supabaseDR.from('pm_plans').select('checklist_id, interval_days, next_due_date, last_done_at, cycle_basis, is_active, deferred_to, deferred_at').in('checklist_id', clIds).eq('is_active', true);
    if (error) throw error;
    plans = data || [];
  }
  const planBy = Object.fromEntries(plans.map(p => [p.checklist_id, p]));
  const todayStr = getWorkDate();
  for (const cl of (cls || [])) {
    const plan = planBy[cl.id];
    /* 🔴 สูตรกลาง resolvePlanDue — รู้จัก run_day แล้ว (audit 08/10)
       เดิมคิดเอง `last_done + interval` ⇒ AM รายวันขึ้นหมุดแดง "เกินกำหนด" ทุกวันจันทร์ */
    const due = resolvePlanDue({ frequency: cl.frequency, plan: plan || null, todayStr });
    (out[cl.equipment_id] ||= []).push({ dept: cl.department, am: isAmTeam(cl.department), status: due.status,
      nextDue: due.dueYmd ? parseLocalDate(due.dueYmd) : null, freq: cl.frequency, clName: cl.name });
  }
  return out;
}

/** รูปผังของไลน์ — ของตัวเองก่อน ไม่มีถอยไปไลน์แม่ → { image, owner } */
export async function loadLineLayoutImage(lineName, parentName) {
  const { data: lay } = await supabase.from('line_layouts').select('image_url').eq('line_name', lineName).maybeSingle();
  if (lay?.image_url) return { image: lay.image_url, owner: lineName };
  if (parentName) {
    const { data: pl } = await supabase.from('line_layouts').select('image_url').eq('line_name', parentName).maybeSingle();
    if (pl?.image_url) return { image: pl.image_url, owner: parentName };
  }
  return { image: null, owner: null };
}

/**
 * หมุดเครื่องของไลน์ + ชื่อ + checklist PM ต่อเครื่อง
 * @param {string[]} pointLines  ไลน์ที่หมุดอยู่บนรูปเดียวกัน
 * @returns {Promise<{ points:object[], info:{[machineNo]:{name:string, checklists:object[]}} }>}
 */
export async function loadLineMachines(pointLines) {
  const names = (pointLines || []).filter(Boolean);
  if (!names.length) return { points: [], info: {} };
  const { data: mp, error: e0 } = await supabase.from('machine_points').select('id, machine_no, pos_top, pos_left, line_name').in('line_name', names);
  if (e0) throw e0;
  const points = mp || [];
  const machineNos = [...new Set(points.map(p => p.machine_no).filter(Boolean))];
  if (!machineNos.length) return { points, info: {} };
  // จับด้วย machine_no ที่อยู่บนผังจริง (ไม่ผูก line ตรงเป๊ะ) — ไลน์ใหญ่ที่วางเครื่องของลูกบนผัง parent ได้ชื่อครบ
  const { data: machines, error: e1 } = await supabaseDR.from('machines').select('id, machine_no, machine_name').in('machine_no', machineNos);
  if (e1) throw e1;
  const nameByNo = {}, noById = {};
  (machines || []).forEach(m => { if (m.machine_no) nameByNo[m.machine_no] = m.machine_name; if (m.id) noById[m.id] = m.machine_no; });
  const { data: jigs, error: e2 } = await supabaseDR.from('jigs').select('id, name, machine_no, machine_id').eq('module', 'mtn');
  if (e2) throw e2;
  const jigOnMachine = (jigs || []).map(j => ({ ...j, _mno: j.machine_no || noById[j.machine_id] || null })).filter(j => j._mno && machineNos.includes(j._mno));
  const jigById = Object.fromEntries(jigOnMachine.map(j => [j.id, j]));
  const pm = await loadPmForJigs(jigOnMachine.map(j => j.id));
  const info = {};
  machineNos.forEach(no => { info[no] = { name: nameByNo[no] || '', checklists: [] }; });
  for (const [jid, cls] of Object.entries(pm)) {
    const jig = jigById[jid]; if (!jig || !info[jig._mno]) continue;
    cls.forEach(c => info[jig._mno].checklists.push({ ...c, eqName: jig.name || '-' }));
  }
  return { points, info };
}
