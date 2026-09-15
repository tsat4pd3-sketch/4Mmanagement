/* ══ matScope — "ไลน์นี้เปิดใบของพาร์ทไหนได้บ้าง" ═══════════════════════════════════════
   ที่มา (feedback user 2026-09-15 · ยืนหน้า LASER-345):
     *"ไลน์ย่อยยังจะเห็นพาร์ทของไลน์ย่อยอื่นหรอ เราว่าไม่น่านะ มันจะทำให้เกิด human error"*

   ⚠️ ตรวจแล้ว **ไลน์พี่น้องไม่เคยโผล่อยู่แล้ว** — `getLineFamily` ไล่ลงล่างจากตัวเองเท่านั้น
      (ไม่ไล่จาก ancestors) ⇒ family ของ LASER-345 = ตัวเอง + HYDROFORM (แม่) เท่านั้น
      5 รายการที่เห็นคือ **ของไลน์แม่** ไม่ใช่ของ LASER-789
   แต่ความกังวลเรื่อง human error ถูกต้อง: **จอไม่เคยบอกว่าพาร์ทนั้นผูกอยู่กับไลน์ไหน**
   คนหน้าไลน์จึงแยกไม่ออกว่า "อันนี้ของไลน์กู" หรือ "อันนี้ของแผนก/ไลน์แม่"

   กติกาที่ใช้ (ชั้นแข็ง ไม่ใช่ union แบน):
     1. `own`    — ไลน์นี้มีพาร์ทผูกไว้เอง ⇒ **ใช้แค่ของตัวเอง** ตัดทุกอย่างอื่นทิ้ง
     2. `parent` — ไลน์นี้ไม่มีของตัวเองเลย ⇒ ถอยไปใช้ของ**สายบน** (ไลน์แม่ = ระดับแผนก)
     3. `family` — ยังไม่มีอีก ⇒ ที่เหลือในครอบครัว (ลูก/หลานของตัวเอง)
   ⇒ ไลน์ที่ตั้ง master ถูกต้องจะไม่มีวันเห็นของไลน์อื่นเลย · ไลน์ที่ master ยังไม่ครบก็ยัง
     เปิดใบได้ (ไม่ย้อนกลับไปเป็นบั๊ก "ลิสต์ว่าง เปิดใบไม่ได้ทั้งกะ" ของ 2026-08-17)

   **ทุกแถวที่ไม่ใช่ของไลน์ตัวเองต้องติดป้ายเจ้าของบนจอเสมอ** — นั่นคือตัวกัน human error จริง
   (ซ่อนไม่ได้ เพราะบางไลน์มีแต่ของแม่ · แต่ต้องเห็นว่ามันไม่ใช่ของตัวเอง)

   ⚠️ ห้ามเอาไปใช้นับสต็อก — นี่คือแกน "เลือกอะไรได้" ไม่ใช่ "ของอยู่ที่ไหน"
      (กฎหน่วยย่อยที่สุด/leaf ใน lineHierarchy.js)                                          */
import { getAncestorNames, getLineFamilyNames } from './lineHierarchy.js';

const norm = (s) => (s ?? '').toString().trim().toLowerCase();

/**
 * @param {Array}  rows     รายการที่จะกรอง (kanban_standards / dr_products …)
 * @param {Array}  lines    production_lines ทั้งหมด
 * @param {string} lineName ไลน์ที่เปิดกะอยู่
 * @param {Function} ownerOf  แถว → ชื่อไลน์เจ้าของ (default = dr_products.line_name)
 * @returns {{rows:Array, scope:'own'|'parent'|'family'|'none', owners:string[]}}
 *          rows แต่ละตัวถูกแปะ `_owner` (ชื่อไลน์เจ้าของ) และ `_foreign` (ไม่ใช่ของไลน์นี้)
 */
export function scopeMatRows(rows, lines, lineName, ownerOf = (r) => r?.dr_products?.line_name) {
  const me = norm(lineName);
  const all = Array.isArray(rows) ? rows : [];
  if (!me || !all.length) return { rows: [], scope: 'none', owners: [] };

  const tag = (list) => list.map(r => ({ ...r, _owner: ownerOf(r) || '', _foreign: norm(ownerOf(r)) !== me }));
  const ownersOf = (list) => [...new Set(list.map(r => ownerOf(r)).filter(Boolean).filter(n => norm(n) !== me))];

  // 1) ของไลน์ตัวเอง — มีเมื่อไหร่ใช้แค่นี้ ไม่ต้องรอ `lines` โหลดเสร็จด้วย
  const own = all.filter(r => norm(ownerOf(r)) === me);
  if (own.length) return { rows: tag(own), scope: 'own', owners: [] };

  // 2) สายบน (ไลน์แม่ = ระดับแผนก) — ของที่แม่ถือไว้ ไลน์ลูกหยิบไปเปิดใบได้
  const anc = new Set(getAncestorNames(lines, lineName).map(norm));
  if (anc.size) {
    const up = all.filter(r => anc.has(norm(ownerOf(r))));
    if (up.length) return { rows: tag(up), scope: 'parent', owners: ownersOf(up) };
  }

  // 3) ที่เหลือในครอบครัว (ลูก/หลานของตัวเอง — getLineFamily ไม่รวมไลน์พี่น้องอยู่แล้ว)
  const fam = new Set(getLineFamilyNames(lines, lineName).map(norm));
  const rest = all.filter(r => fam.has(norm(ownerOf(r))));
  return rest.length
    ? { rows: tag(rest), scope: 'family', owners: ownersOf(rest) }
    : { rows: [], scope: 'none', owners: [] };
}

export default scopeMatRows;
