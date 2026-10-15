/* ─────────────────────────────────────────────────────────────────────────────
   ชั้นหมุดอุปกรณ์บนผังไลน์ — Machine (ทีม MTN) | Jig/Fixture (ทีม JIG MTN)   (2026-10-14 · คำสั่ง user)

   ปัญหา: robot ส่วนใหญ่มีจิ๊กติดที่ปลายแขน (end of arm) ⇒ หมุดเครื่องกับหมุดจิ๊กวางทับกันจนอ่านไม่ออก
   ⇒ ผังโชว์ทีละชั้น เลือกด้วยปุ่มบน rail ขวา

   🔴 ตัดสินชั้นจาก `machines.equipment_kind` (ทะเบียน DR) เท่านั้น — ห้ามเดาจากชื่อ/เลข ("JHYD…" = จิ๊ก?)
      และห้ามใช้ `mtn_dept` (CLAUDE.md §KPI ช่าง)
   · เทียบเลขเครื่องด้วย `machineKey()` (RB114 = RB-114) · คีย์เดียวที่ชี้ไปหลายชนิด = ไม่รู้
   · ชั้น jig = `jig` · ชั้น machine = ชนิดอื่นทั้งหมด (machine/facility/die)
   · 🔴 ไม่อยู่ในทะเบียน / ชนิดว่าง = `unknown` → วาดในชั้น machine (ไม่หายจากผัง) แต่จอต้องนับให้เห็น
   ⚠️ pure — ห้าม import supabase
   ───────────────────────────────────────────────────────────────────────────── */
import { machineKey } from './machineNo.js';

export const MAP_LAYERS = ['machine', 'jig'];

/** machines rows → Map(key → equipment_kind | null(กำกวม)) */
export function buildKindMap(machines = []) {
  const m = new Map();
  for (const r of (Array.isArray(machines) ? machines : [])) {
    const k = machineKey(r?.machine_no);
    if (!k) continue;
    const kind = r?.equipment_kind || null;
    if (!m.has(k)) m.set(k, kind);
    else if (m.get(k) !== kind) m.set(k, null);   // ชื่อเดียวกันแต่คนละชนิด = ไม่รู้
  }
  return m;
}

/** ชั้นของหมุด 1 จุด → { layer:'machine'|'jig', kind:string|null, known:boolean } */
export function layerOfPoint(machineNo, kindMap) {
  const kind = kindMap instanceof Map ? (kindMap.get(machineKey(machineNo)) ?? null) : null;
  if (kind === 'jig') return { layer: 'jig', kind, known: true };
  return { layer: 'machine', kind, known: kind != null };
}

/**
 * แยกหมุดเป็นชั้น + สรุปตัวนับให้จอ
 * @param {Array<{machine_no:string}>} points
 * @param {Map} kindMap   จาก buildKindMap · null = โหลดทะเบียนไม่ได้ (ทุกจุด unknown)
 * @returns {{ machine:Array, jig:Array, unknown:Array, layerOf:(p)=>string }}
 */
export function splitPointLayers(points = [], kindMap = null) {
  const out = { machine: [], jig: [], unknown: [] };
  const byPoint = new Map();
  for (const p of (Array.isArray(points) ? points : [])) {
    const r = layerOfPoint(p?.machine_no, kindMap);
    out[r.layer].push(p);
    if (!r.known) out.unknown.push(p);
    byPoint.set(p, r.layer);
  }
  return { ...out, layerOf: (p) => byPoint.get(p) || 'machine' };
}
