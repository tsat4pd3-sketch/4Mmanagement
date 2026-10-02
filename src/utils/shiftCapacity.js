/* ═══ ⏱️ ความจุกะ — "เปิดใบนี้แล้วจะเกินเวลากะไหม" ═══════════════════════════════════════
   ที่มา (2026-10-02 · feedback หน้างาน): *"ทั้งที่เปิดงานใหม่เครื่องใหม่ขนาน แต่ทำไมแจ้งเวลาเกิน"*

   ── บั๊กที่ทำให้ต้องมีไฟล์นี้ ────────────────────────────────────────────────────────────
   เดิม `calcCommittedMin()` ใน DailyReport บวก `qty × CT` ของ **ทุกใบในกะเรียงต่อกันเป็นสายเดียว**
   โดยไม่สนว่าไลน์นั้นเดินกี่เครื่องพร้อมกัน

   วัดกับกะจริง ASSEMBLY 1 · 02/10/26 (กะเช้า):
     · ใบที่ยังไม่ปิด 55 ใบ · 2,180 ชิ้น ⇒ บวกเรียงกันได้ **2,120 นาที**
     · ความจุกะหลังหักพัก ≈ 590 นาที ⇒ จอแจ้ง "เกินไป 1,605 นาที" **ตั้งแต่ใบที่ยังไม่เริ่มทำ**
     · แต่กะนั้นใช้ **6 เครื่องเดินขนาน** ⇒ ของจริง ≈ 2,120 ÷ 6 = **353 นาที/เครื่อง**
       = ใช้ความจุไปแค่ 60% · **ไม่ควรเตือนเลยสักครั้ง**
   และ `ASSEMBLY 1` ลงทะเบียนเป็น `flow_mode = 'parallel_machine'` อยู่แล้ว — ระบบ "รู้" ว่าขนาน
   (`computeLiveOee` ใช้ `parallelCap` ถูกต้องมาตลอด) แต่ **ด่านความจุไม่เคยอ่านค่านั้น**

   ผลเสียไม่ใช่แค่จอรก: modal บังคับเลือก "ส่งเป็นยอดค้างกะถัดไป / เปิด OT" ทุกใบ
   ⇒ คนกดมั่วจนกลายเป็นเสียงรบกวน แล้ววันที่เกินจริงก็ไม่มีใครเชื่ออีก

   🔴 กติกาของไฟล์นี้
   1. **`one_piece_flow` = บวกทั้งกะ** (คิวเดียว ทำทีละใบ) — พฤติกรรมเดิมเป๊ะ
   2. **`parallel_machine` = ภาระของ "เลนที่หนักที่สุด" ไม่ใช่ผลรวม** — กะจบเมื่อเครื่องที่ยาวสุดจบ
      · ใบที่ผูกเครื่องแล้ว = เข้าเลนของเครื่องนั้น
      · ใบที่ยังไม่ผูกเครื่อง = เกลี่ยลงทุกเลนเท่าๆ กัน (ประมาณการที่ดีที่สุดเมื่อยังไม่รู้)
   3. 🔴 **ไม่รู้ความจุ (`netAvailMin == null`) = ไม่เตือน** — "ไม่รู้" ไม่ใช่ "เกิน"
   4. 🔴 **ใบที่ไม่มี CT ไม่ถูกนับเข้าภาระ แต่ต้องคืน `unknownCt` ให้จอเขียนบอก** ห้ามเงียบ
      (เงียบ = จอบอกว่ายังว่าง ทั้งที่มีใบที่คำนวณไม่ได้ค้างอยู่)
   5. 🔴 **งานคู่ RH/LH นับเป็น shot เดียว** ผ่าน `pairLoadTotal` — กฎ "ชิ้น ≠ shot" ใน CLAUDE.md
      (ปั๊มทีเดียวได้ 2 ข้าง · บวกทั้งสองข้าง = ภาระ 2 เท่า)

   ไฟล์นี้ pure — ห้าม import supabase/react (จะได้เทสตรงๆ ได้)
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { pairLoadTotal } from './pairTotals.js';
import { flowModeOf } from './lineTypes.js';

const num = (v) => Number(v) || 0;
const key = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

/** สถานะใบที่ "ไม่กินความจุกะนี้แล้ว"
 *  carry_over = ตัดสินใจส่งไปกะถัดไปแล้ว · imported = ใบต้นทางที่ถูกรับไปกะอื่น · cancelled = ยกเลิก
 *  🔴 ห้ามตัด `confirmed` ออก — ใบที่ปิดแล้ว **กินเวลากะนี้ไปจริง** ต้องนับเป็นภาระเสมอ */
export const SPENT_STATUSES = ['cancelled', 'imported', 'carry_over'];

/**
 * ภาระต่อเลน (นาที) แยกตามเครื่อง + ส่วนที่ยังไม่ผูกเครื่อง
 * @param {Array} orders  ใบในกะ ({ mat_no, qty, machine_no, status })
 * @param {(mat:string)=>number} ctOf  CT (วินาที) ของ mat — ไม่รู้ให้คืน 0
 * @param {(mat:string)=>string|null} [pairOf]  pair_mat_no (งานคู่ RH/LH)
 * @returns {{ byLane: Map<string, number>, floating: number, unknownCt: number, totalMin: number }}
 */
export function loadByLane(orders = [], ctOf = () => 0, pairOf = () => null) {
  const lanes = new Map();          // machine_no → { mat → นาที }
  const free  = new Map();          // mat → นาที (ใบที่ยังไม่ผูกเครื่อง)
  let unknownCt = 0;

  (orders || []).forEach(o => {
    if (!o || SPENT_STATUSES.includes(o.status)) return;
    const mat = key(o.mat_no);
    const ct  = num(ctOf(mat));
    if (!(ct > 0)) { unknownCt += 1; return; }      // กฎ 4 — ไม่นับ แต่ต้องรายงาน
    const min = num(o.qty) * ct / 60;
    const mc  = key(o.machine_no);
    const bag = mc ? (lanes.get(mc) || lanes.set(mc, new Map()).get(mc)) : free;
    bag.set(mat, (bag.get(mat) || 0) + min);
  });

  // ยุบคู่ RH/LH ภายในแต่ละเลน (ชิ้น ≠ shot — กฎ 5)
  const byLane = new Map();
  lanes.forEach((bag, mc) => byLane.set(mc, pairLoadTotal(bag, pairOf)));
  const floating = pairLoadTotal(free, pairOf);
  let totalMin = floating;
  byLane.forEach(v => { totalMin += v; });
  return { byLane, floating, unknownCt, totalMin };
}

/**
 * ภาระที่ commit ไว้แล้วของ "เลนที่ใบใหม่จะไปลง"
 * @param {object} a
 * @param {Array}  a.orders
 * @param {Function} a.ctOf
 * @param {Function} [a.pairOf]
 * @param {string} [a.flowMode]       production_lines.flow_mode
 * @param {number} [a.parallelUnits]  จำนวนเลนที่เดินขนานได้ (จาก parallelUnitsOf) — ≥ 1
 * @param {string} [a.machineNo]      เครื่องที่ใบใหม่จะเปิด (null = ยังไม่เลือก)
 * @returns {{ committedMin:number, basis:'line'|'machine', lanes:number, lane:string|null, unknownCt:number, totalMin:number }}
 */
export function committedMin({ orders = [], ctOf = () => 0, pairOf = () => null,
                               flowMode, parallelUnits = 1, machineNo = null } = {}) {
  const { byLane, floating, unknownCt, totalMin } = loadByLane(orders, ctOf, pairOf);

  // กฎ 1 — สายเดียว: ผลรวมทั้งกะ คือคำตอบที่ถูกอยู่แล้ว
  if (flowModeOf(flowMode) !== 'parallel_machine') {
    return { committedMin: totalMin, basis: 'line', lanes: 1, lane: null, unknownCt, totalMin };
  }

  // กฎ 2 — เครื่องขนาน: ดูเลนที่ใบใหม่จะไปลง (ไม่ใช่ผลรวมทั้งไลน์)
  const lanes = Math.max(1, Number(parallelUnits) || 1, byLane.size);
  const share = floating / lanes;                          // ใบที่ยังไม่ผูกเครื่อง เกลี่ยเท่าๆ กัน
  const mc = key(machineNo);
  const mine = mc != null
    ? (byLane.get(mc) || 0)                                // รู้เครื่อง = เลนนั้นตรงๆ
    : Math.max(0, ...byLane.values()) || 0;                // ไม่รู้เครื่อง = เลนที่หนักสุด (ระวังไว้ก่อน)
  return { committedMin: mine + share, basis: 'machine', lanes, lane: mc, unknownCt, totalMin };
}

/**
 * ด่าน "เปิดใบนี้แล้วเกินเวลากะไหม"
 * @returns {null | { overMin:number, remainMin:number, newOrderMin:number, basis:string, lanes:number, lane:string|null, unknownCt:number }}
 *          null = ไม่เกิน **หรือ** ตัดสินไม่ได้ (กฎ 3: ไม่รู้ความจุ / ไม่รู้ CT ของใบใหม่ = ไม่เตือน)
 */
export function checkShiftCapacity({ netAvailMin, newQty, newCtSec, ...rest }) {
  if (netAvailMin == null) return null;                    // กฎ 3
  const ct = num(newCtSec);
  if (!(ct > 0)) return null;                              // ใบใหม่ไม่มี CT = คิดไม่ได้ ห้ามเดา
  const newOrderMin = num(newQty) * ct / 60;
  const c = committedMin(rest);
  const over = c.committedMin + newOrderMin - num(netAvailMin);
  if (!(over > 0)) return null;
  return {
    overMin: Math.round(over),
    remainMin: Math.round(Math.max(0, num(netAvailMin) - c.committedMin)),
    newOrderMin: Math.round(newOrderMin),
    basis: c.basis, lanes: c.lanes, lane: c.lane, unknownCt: c.unknownCt,
  };
}
