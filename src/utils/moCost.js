/* ══ 🔧 moCost — "ค่าซ่อมจากใบ MO" สำหรับบอร์ด Obeya แกน C (2026-11-27 · คำสั่ง user) ═══════════════════════
   user: "ใช้ค่าที่ช่างกรอก · นับตอนผู้แจ้งอนุมัติรับมอบ"
   · ยอดต่อใบ = `orderCostTotal()` (utils/mtnMoForm.js) ตัวเดียวกับใบ MO/ใบพิมพ์ — แถวรายคน/รายอะไหล่ก่อน ไม่มีค่อยถอยไป labor_cost/parts_cost
   · วันที่นับ = `ho_at` (ผู้แจ้งรับมอบ) ตามปฏิทินไทย (`bkkDateStr`) · ไม่นับ cancelled/rejected
   · ใบที่ยังไม่ลงค่าใช้จ่าย = ไม่ใช่ 0 — นับแยก `nNoCost` ให้จอเขียน · pure · เทส `__tests__/moCost.test.mjs` */
import { orderCostTotal } from './mtnMoForm.js';
import { bkkDateStr } from './workDate.js';

export const MO_COST_EXCLUDED_STATUSES = ['cancelled', 'rejected'];

/** วันที่นับของใบ = วันรับมอบตามเวลาไทย · ไม่มี ho_at = null (ไม่นับ) */
export const moCostDateOf = (o) => (o?.ho_at ? bkkDateStr(o.ho_at) : null);

/**
 * @param {object} p
 * @param {Array} p.orders        แถว mtn_orders { id, status, ho_at, line_name, labor_cost, parts_cost }
 * @param {Object} [p.laborByOrder]  order_id → แถว mtn_order_labor[]
 * @param {Object} [p.partsByOrder]  order_id → แถว mtn_order_parts[]
 * @returns {{ baht:number, n:number, nCost:number, nNoCost:number, byDate:Object }}
 */
export function moCostOf({ orders = [], laborByOrder = {}, partsByOrder = {} } = {}) {
  const out = { baht: 0, n: 0, nCost: 0, nNoCost: 0, byDate: {} };
  for (const o of orders || []) {
    if (!o || MO_COST_EXCLUDED_STATUSES.includes(o.status)) continue;
    const d = moCostDateOf(o);
    if (!d) continue;
    out.n++;
    const total = orderCostTotal(o, laborByOrder[o.id] || null, partsByOrder[o.id] || null);
    if (total == null) { out.nNoCost++; continue; }
    out.nCost++;
    out.baht += total;
    const b = out.byDate[d] || (out.byDate[d] = { baht: 0, n: 0 });
    b.baht += total; b.n++;
  }
  out.baht = Math.round(out.baht);
  return out;
}

/** โหมดปี — จากแถว RPC `obeya_mo_cost_rollup` { m, line, n, n_nocost, labor, parts } (กรองขอบเขตแล้ว) → rows { m, mo } สำหรับ axisCostYear */
export function moCostYearRows(rows = []) {
  const byM = {}; let n = 0, nNoCost = 0;
  for (const r of rows || []) {
    if (!r?.m) continue;
    n += Number(r.n) || 0; nNoCost += Number(r.n_nocost) || 0;
    byM[r.m] = (byM[r.m] || 0) + (Number(r.labor) || 0) + (Number(r.parts) || 0);
  }
  return { rows: Object.entries(byM).map(([m, mo]) => ({ m, dt: 0, ng: 0, ot: 0, mo: Math.round(mo) })), n, nNoCost };
}
