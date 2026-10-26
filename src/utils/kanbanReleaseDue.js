/* ═══ 📉 "ถึงจุดต้องปล่อยคัมบัง" — พาร์ทที่สต็อกถึง/ต่ำกว่าขั้นต่ำ (2026-10-26 · feedback สโตร์)

   สโตร์แจ้งในใบ E-Production TSAT P4 (หัวข้อ "บอร์ดคัมบัง สโตร์ → 2. รอปล่อยเข้าไลน์"):
     *"ให้แสดงรายการที่ สต็อกต่ำกว่าหรือเท่ากับค่า min เพื่อที่ให้สโตร์ทราบถึงสถานะงาน
       ที่จะต้องปล่อยคัมบังเข้าไลน์ผลิต (ปัจจุบัน ขึ้นบางรายการ)"*

   🔴 ทำไมเดิม "ขึ้นบางรายการ" — คิวใบล็อตบนบอร์ด **สร้างจากความต้องการ ไม่ใช่จาก min**
      (trigger `fn_explode_child_demand`) ต้องครบ 3 ข้อถึงจะมีใบ:
        ① มีใบผลิต FG ถูกปิดเป็น `confirmed` ② พาร์ทอยู่ใน `bom_items` ของ FG ใบนั้น
        ③ ยอดสะสมใน `child_demand_accumulator` ถึง `kanban_standards.lot_size`
      วัดจริง 26/10 (DR): `kanban_standards` ที่ `is_active` = **458 แถว** แต่
      **250 แถวไม่ได้ตั้ง `lot_size`** ⇒ สะสมไปเรื่อยๆ **ไม่มีวันออกใบ** ·
      ตัวสะสมค้างอยู่ 169 แถว (66 แถวค้างถาวรเพราะไม่มี lot_size) · บอร์ดมีใบ pending แค่ 24
      ⇒ ของที่ "ใกล้หมด" แต่ยังไม่มีใครสั่ง FG รอบใหม่ = **ไม่โผล่ที่ไหนเลย**

   ไฟล์นี้จึงเป็น "ชั้นที่ 2" ที่มองจากยอดคงเหลือตรงๆ — **ไม่แตะคิวใบเดิม ไม่สร้างใบให้เอง**
   (ระบบเสนอ คนตัดสิน — หลักเดียวกับ `LinePartCallPanel.suggest`)

   🔴 กฎความซื่อสัตย์ของจอ (CLAUDE.md §OBEYA):
   · ไม่ได้ตั้ง min = **ไม่เฝ้า** (ไม่เดาให้) → `noMin` ให้จอเขียนบอกว่ามีกี่ตัว
   · ไม่รู้ว่าไลน์ไหนผลิต → `noLine` · อ่านยอดไม่ได้ (ไม่มีแถวสต็อก) → `unknown`
     **ห้ามบีบเป็น 0 = "ของหมด"** (ลิสต์ว่าง 2 ความหมาย · กฎเขียน DB ข้อ 12)
   · พาร์ทที่มีใบล็อตค้างอยู่แล้ว ไม่ใช่ "ต้องปล่อยเพิ่ม" → แยกเป็น `alreadyQueued`

   🔑 **คลังที่เอามาเทียบ ต้องใช้ `refStockOf()` ตัวเดียวกับแผงฝั่งไลน์** — ของที่ไลน์ผลิตเองอ้าง
      ยอด "คลังปลายทางตามกฎรับเข้า" (STORE / FG WAREHOUSE) · พาร์ทโหมด 🔧 ปิดล็อต อ้างยอดที่ไลน์ตัวเอง
      (ยอดเข้าทางปิดล็อตซึ่งลงที่ชื่อไลน์ผลิต) — ห้ามเขียนกติกาคลังชุดที่ 2 ที่นี่

   pure — ไม่แตะ DB/React · เทส `__tests__/kanbanReleaseDue.test.mjs`
   ═══════════════════════════════════════════════════════════════════════════════ */

import { refStockOf, inflowDestOf } from './partRefStock.js';

const key = (s) => String(s ?? '').trim();
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * @param {object} p
 * @param {Array}  p.stds      kanban_standards: { mat_no, min_qty, max_qty, lot_size }
 * @param {Array}  p.products  ทะเบียนสินค้า: { mat_no, line_name, is_active, is_operation }
 * @param {Array}  p.rules     stock_inflow_rules
 * @param {(loc:string, mat:string) => number|null} p.stockAt  ยอดคงเหลือ — **ไม่มีแถว = null ห้ามคืน 0**
 * @param {Set|Array} p.openMats  MAT ที่มีใบล็อตค้างอยู่แล้ว (pending/producing)
 * @returns {{ due:Array, alreadyQueued:Array, unknown:Array, noMin:Array, noLine:Array }}
 */
export function releaseDueRows({ stds = [], products = [], rules = [], stockAt = () => null, openMats = [] } = {}) {
  const open = openMats instanceof Set ? openMats : new Set([...(openMats || [])].map(key));
  const prodOf = new Map();
  const opMats = new Set();        // ชั้น OP = ขั้นตอนกลางทาง ไม่เคยเข้าคลัง ⇒ ไม่มี min ให้เฝ้า
  for (const p of products || []) {
    if (!p || p.is_active === false) continue;
    const m = key(p.mat_no);
    if (!m) continue;
    if (p.is_operation) { opMats.add(m); continue; }
    if (!prodOf.has(m)) prodOf.set(m, p);
  }

  const due = [], alreadyQueued = [], unknown = [], noMin = [], noLine = [];
  for (const s of stds || []) {
    const mat = key(s?.mat_no);
    if (!mat) continue;
    const min = num(s.min_qty);
    if (min == null) { noMin.push(mat); continue; }          // ไม่ตั้ง min = ไม่เฝ้า (ไม่เดาให้)
    /* คลังที่เอามาเทียบ:
       · รู้ว่าไลน์ไหนผลิต ⇒ `refStockOf()` (กติกาเดียวกับแผงฝั่งไลน์)
       · 🔴 **ไม่อยู่ใน Product Master ก็ยังเฝ้าได้** — พาร์ทลูกจำนวนมากมีแต่ใน BOM/ทะเบียนคัมบัง
         (วัด 26/10: ตั้ง min ไว้ 367 แถว แต่มีแถวใน dr_products แค่ 138)
         ⇒ ถอยไปใช้ "คลังปลายทางตามกฎรับเข้า" ซึ่งตอบได้โดยไม่ต้องรู้ไลน์
       · ไม่รู้ทั้งคู่ = ตอบไม่ได้ว่าดูคลังไหน → `noLine` (ให้จอเขียนบอก ห้ามเงียบ) */
    if (opMats.has(mat) && !prodOf.has(mat)) { noLine.push(mat); continue; }
    const prod = prodOf.get(mat);
    const loc = prod
      ? refStockOf(mat, { lineName: prod.line_name, products, rules }).loc
      : inflowDestOf(mat, rules);
    if (!loc) { noLine.push(mat); continue; }
    const lineName = prod?.line_name || null;
    const have = num(stockAt(loc, mat));
    if (have == null) { unknown.push({ mat_no: mat, line_name: lineName, loc, min }); continue; }
    if (have > min) continue;
    const max = num(s.max_qty);
    const lot = num(s.lot_size);
    const row = {
      mat_no: mat, part_name: prod?.name || null, line_name: lineName, loc,
      have, min, max, lot_size: lot,
      /* เติมให้ถึง max → ไม่ตั้ง max ใช้ขนาดล็อต → ไม่มีทั้งคู่ = ให้คนกรอกเอง (null ห้ามเดา) */
      suggestQty: max != null ? Math.max(0, Math.round(max - have)) : lot,
      shortage: Math.max(0, Math.round(min - have)),
    };
    (open.has(mat) ? alreadyQueued : due).push(row);
  }
  /* เรียง "วิกฤตก่อน" = เหลือเทียบกับ min น้อยที่สุดมาก่อน (min = 0 กันหารศูนย์) */
  const rank = (r) => (r.min > 0 ? r.have / r.min : (r.have <= 0 ? -1 : 0));
  due.sort((a, b) => rank(a) - rank(b));
  alreadyQueued.sort((a, b) => rank(a) - rank(b));
  return { due, alreadyQueued, unknown, noMin, noLine };
}

/** MAT ที่มีใบล็อตค้างอยู่ (pending/producing) — ใช้เป็น `openMats` */
export const openLotMats = (lotRequests = []) =>
  new Set((lotRequests || [])
    .filter(l => l && (l.status === 'pending' || l.status === 'producing'))
    .map(l => key(l.child_mat_no)).filter(Boolean));
