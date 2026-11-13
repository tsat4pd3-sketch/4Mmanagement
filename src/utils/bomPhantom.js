/* ═══ 🫧 ของลม (phantom assembly) — "คอนเฟิมแม่ ตัดลูก ไม่ตัดหลาน" ════════════════════
   4/11 · คำสั่ง user: *"ตามหลักการ สร้าง bom ใน sap ... คอนเฟิมแม่ ตัดลูก ไม่ตัดหลาน
   ถ้าลูกไม่พอ ลูกต้องไปผลิตเอง"*

   การตัดสต็อกจริงอยู่ที่ trigger `fn_explode_child_demand` (DR · บน `prod_orders`) ซึ่ง
   ตัด **ลูกตรงชั้นเดียว** ผ่าน `fn_bom_direct_demand(mat)` · ของลมไม่ถูกตัดในฐานะตัวมันเอง
   แต่ลูกของมันถูกดึงขึ้นมาตัดที่ชั้นแม่แทน (หลัก SAP special procurement 50)

   🔴 ทะเบียนของลม = `bom_phantom_mats` (DR) **ที่เดียว** · ครอบทั้ง mat ที่อยู่/ไม่อยู่ใน
      `dr_products` (ลูกกลางส่วนใหญ่ยังไม่ได้ลงทะเบียนสินค้า ⇒ ธงอยู่บน dr_products ไม่ได้)
   🔴 ไฟล์นี้ pure ล้วน — ตัดสินใจอะไรไม่ได้นอกจากจัดกลุ่ม/ตีป้าย · **จอห้ามคิดเกณฑ์เอง**
   🔴 จอนี้ชี้อย่างเดียว + ติ๊กทะเบียน — **ห้ามแก้/ลบ `bom_items` ให้เอง** (PE เป็นเจ้าของข้อมูล)
   ═══════════════════════════════════════════════════════════════════════════════════ */

/** ป้ายผลการจัดกลุ่ม — tone อ่านผ่าน statusColor() ที่จอ ห้ามตั้ง hex ที่นี่ */
export const PHANTOM_VERDICTS = {
  op:        { rank: 1, tone: 'none', label: 'ขั้น OP',          hint: 'เป็นขั้นงาน (is_operation) = ของลมโดยอัตโนมัติ ไม่ต้องติ๊ก' },
  confirmed: { rank: 2, tone: 'good', label: 'ของลม (ยืนยันแล้ว)', hint: 'PE ยืนยันแล้ว — ลูกของมันถูกดึงขึ้นมาตัดที่ชั้นแม่' },
  seeded:    { rank: 3, tone: 'warn', label: 'ของลม (ระบบเดา)',   hint: 'ระบบเดาจาก "ไม่เคยมีใบผลิตของตัวเอง" — PE ต้องมายืนยัน' },
  real:      { rank: 4, tone: 'good', label: 'ของจริง',           hint: 'มีใบผลิตของตัวเอง ⇒ ใบของมันตัดลูกของมันเอง' },
  gap:       { rank: 0, tone: 'bad',  label: '🔴 โซ่ขาด',          hint: 'ไม่ใช่ของลม แต่ไม่เคยมีใบผลิตของตัวเอง ⇒ ลูกของมันจะไม่ถูกตัดที่ไหนเลย' },
};

export const phantomRank = (v) => PHANTOM_VERDICTS[v]?.rank ?? 9;

/**
 * ตีป้ายลูกกลาง 1 ตัว
 * @param {object} f  { inRegistry, seeded, isOperation, ownOrders, hasOwnSheet }
 *   ownOrders = จำนวนใบผลิตของตัวเองที่ระเบิดได้จริง · **null/undefined = ยังไม่รู้ ห้ามเดาเป็น 0**
 * @returns {'op'|'confirmed'|'seeded'|'real'|'gap'|'unknown'}
 */
export function classifyIntermediate(f = {}) {
  const { inRegistry, seeded, isOperation, ownOrders } = f;
  if (isOperation) return 'op';
  if (inRegistry) return seeded ? 'seeded' : 'confirmed';
  if (ownOrders == null) return 'unknown';      // อ่านไม่ได้ = ไม่ตัดสิน (จอต้องเขียนบอก)
  return ownOrders > 0 ? 'real' : 'gap';
}

/** นับรายกลุ่ม + ตัวที่ตัดสินไม่ได้ (จอต้องโชว์ ห้ามกลืน) */
export function phantomCounts(rows = []) {
  const c = { op: 0, confirmed: 0, seeded: 0, real: 0, gap: 0, unknown: 0, total: 0 };
  for (const r of rows) {
    const v = r?.verdict || 'unknown';
    if (c[v] == null) c[v] = 0;
    c[v] += 1; c.total += 1;
  }
  return c;
}

/** เรียง: โซ่ขาดก่อน → รอยืนยัน → ที่เหลือ · ในกลุ่มเดียวกันเรียงตามเลข mat */
export function sortIntermediates(rows = []) {
  return [...rows].sort((a, b) =>
    phantomRank(a.verdict) - phantomRank(b.verdict) ||
    String(a.mat_no || '').localeCompare(String(b.mat_no || '')));
}
