/* ═══ ประวัติการซ่อมรายเครื่อง — สรุปตัวเลขจากใบ MO ของเครื่องเดียว (pure) ═══════════════════
   2026-10-19 · MTN REQUEST ข้อ "สร้างฟอร์มประวัติการซ่อมของแต่ละเครื่องจักร รอฟอร์มจาก MTN"
   ⇒ ทำ **จอดูข้อมูล** ก่อน (ข้อมูลมีครบในใบ MO แล้ว) · ใบพิมพ์รอฟอร์มจริงจากทีม MTN
     (ตอนทำต้อง register `/doc-forms` · อ่านตัวเลขจากไฟล์นี้ ห้ามคิดใหม่ในใบพิมพ์)

   แหล่งข้อมูล: RPC `mtn_orders_by_machine(no)` (DR) — จับคู่เลขเครื่องด้วย `machine_key()`
     ⇒ SW10 / SW-10 / sw 10 = เครื่องเดียวกัน (กฎ `snapMachineNo`) · จอต้องบอกว่ามีกี่สะกด

   🔴 กฎ:
     · เวลาซ่อมของช่าง = `techRepairMin()` (หักช่วงอยู่กับ supplier) — **ห้ามลบเวลาเองที่นี่**
       ไม่ใช่ downtime ของเครื่อง (อันนั้นอยู่ `downtime_logs` · /mtn-analysis) — จอต้องติดป้ายที่มา
     · วัดไม่ได้ = null ห้ามเป็น 0 · ค่าเฉลี่ยต้องบอกว่าหารจากกี่ใบ (n)
     · ค่าใช้จ่าย = `orderCostTotal()` (mtnMoForm) · ใบที่ไม่มีใครกรอกเงิน = ไม่นับ (ไม่ใช่ 0 บาท)
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { isMoOpen } from './mtnStepPerm.js';
import { techRepairMin, vendorState } from './mtnVendor.js';
import { orderCostTotal } from './mtnMoForm.js';
import { assignedTechsOf, prNumbersOf, repairPathMeta } from './mtnPurchase.js';
import { isVague, UNGROUPED_LABEL } from './unclassified.js';

const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** ชื่อปัญหาของใบ — กลุ่ม > หัวข้อย่อย · ว่าง/กำกวม = ป้ายกลาง (ไม่เดา) */
export function problemLabelOf(o) {
  const g = String(o?.problem_group || '').trim();
  const c = String(o?.problem_characteristic || '').trim();
  if (g && !isVague(g)) return c && !isVague(c) ? `${g} · ${c}` : g;
  if (c && !isVague(c)) return c;
  return UNGROUPED_LABEL;
}

/**
 * @param orders  ใบ MO ของเครื่อง (จาก RPC — ครบทุกคอลัมน์)
 * @param opts    { prsBy: {orderId:[pr]}, laborBy, partsBy, now }
 */
export function summarizeMachineHistory(orders = [], { prsBy = {}, laborBy = null, partsBy = null, now = Date.now() } = {}) {
  const rows = (orders || []).map(o => {
    const labor = laborBy ? (laborBy[o.id] || []) : null;
    const parts = partsBy ? (partsBy[o.id] || []) : null;
    return {
      o,
      at: o.report_at || null,
      open: isMoOpen(o),
      problem: problemLabelOf(o),
      techs: assignedTechsOf(o),
      prNos: prNumbersOf(o, prsBy[o.id] || []),
      path: repairPathMeta(o.repair_path),
      vendor: vendorState(o) !== 'none',
      techMin: o.status === 'rejected' ? null : techRepairMin(o, now),
      cost: orderCostTotal(o, labor, parts),
    };
  }).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

  const live = rows.filter(r => r.o.status !== 'rejected');
  const tm = live.map(r => r.techMin).filter(v => v != null);
  const costs = live.map(r => r.cost).filter(v => v != null);
  const byType = {}; const byProb = {};
  for (const r of live) {
    const t = r.o.repair_type || 'ไม่ระบุประเภท';
    byType[t] = (byType[t] || 0) + 1;
    byProb[r.problem] = (byProb[r.problem] || 0) + 1;
  }
  const spellings = [...new Set((orders || []).map(o => String(o.machine_no || '').trim()).filter(Boolean))];
  return {
    rows,
    total: live.length,
    rejected: rows.length - live.length,
    open: live.filter(r => r.open).length,
    bm: live.filter(r => /breakdown/i.test(r.o.repair_type || '')).length,
    vendor: live.filter(r => r.vendor).length,
    techMinAvg: avg(tm), techMinN: tm.length,
    costTotal: costs.length ? costs.reduce((s, x) => s + x, 0) : null, costN: costs.length,
    byType: Object.entries(byType).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n),
    // ป้ายกลาง (ยังไม่จัดกลุ่ม) ไปท้ายเสมอ — ห้ามขึ้นอันดับ 1 (กฎ "อื่นๆ ห้ามขึ้นอันดับ 1")
    topProblems: Object.entries(byProb).map(([k, n]) => ({ k, n }))
      .sort((a, b) => (a.k === UNGROUPED_LABEL) - (b.k === UNGROUPED_LABEL) || b.n - a.n),
    spellings,
    lastAt: rows[0]?.at || null,
  };
}
