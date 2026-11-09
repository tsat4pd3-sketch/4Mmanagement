/* 🔩 ขั้น OP "กินอะไร" (2026-11-08 · คำสั่ง user · เลือก "ถูกต้องตามมาตรฐาน" = ที่เก็บเดียว)
   user: *"ใน SAP 10105769 ตัดเบอร์ 5 (ท่อเหล็ก) ตรง แต่หน้างานต้องเอาเหล็กไปดัด+ตัดเลเซอร์ก่อน — เป็น OP
          ที่ไม่มีใน BOM และแก้ BOM ไม่ได้"* · *"แม่ที่มีลูกตัวเดียว ตั้งได้เลย เปิดผลิตขั้น OP ก็เบิกลูกเลย"*
   · ของที่ขั้น OP กิน = **BOM ของแถวขั้น OP เอง** (`/products` แท็บ BOM — ของฝั่ง ESM ไม่แตะ BOM SAP ของแม่)
   · ยังไม่ผูก + แม่มีลูก**ตัวเดียว** = ขั้นนี้กินลูกตัวนั้น (`auto_single` · user เคาะ 06/11)
   · ยังไม่ผูก + แม่มีลูกหลายตัว = `unset` → จอต้องเตือน **ห้ามเดาว่ากินตัวไหน**
   · ใบของแม่ = ลูกตาม BOM SAP **หักตัวที่ขั้น OP ของมันกินไปแล้ว** (ไม่งั้นเบิกเหล็กซ้ำ 2 รอบ)
   pure — เทส `__tests__/opInputs.test.mjs` */

const k = (s) => String(s ?? '').trim();

/** ขั้นนี้เป็น "ขั้นแรกของโซ่" ไหม (09/11) — ขั้นถัดไปในโซ่ (HYDROFORM → LASER-345) รับของจากขั้นก่อนหน้า ไม่กินลูกของแม่
 * แม่มีขั้นเดียว = ใช่ · หลายขั้น = ต้องมี `op_seq` ครบทุกขั้นแล้วตัวนี้น้อยสุด · ลำดับไม่ครบ = ไม่รู้ = ไม่ใช่ (ห้ามเดา)
 * @param {{ op_seq?: number|null }} op @param {Array<{ op_seq?: number|null }>} siblings ทุกขั้นของแม่เดียวกัน (รวมตัวเอง) */
export function isFirstOpInChain(op, siblings = []) {
  const sib = (siblings || []).length ? siblings : [op];
  if (sib.length <= 1) return true;
  if (sib.some(x => x?.op_seq == null) || op?.op_seq == null) return false;
  return Number(op.op_seq) === Math.min(...sib.map(x => Number(x.op_seq)));
}

/** ของที่ขั้น OP กิน
 * @param {{ ownKids: Array<{mat_no, qty_per_unit}>, parentKids: Array, firstInChain?: boolean }} a
 *   firstInChain=false = ขั้นถัดไปในโซ่ ⇒ ไม่ใช้กฎลูกตัวเดียวอัตโนมัติ (ของมาจากขั้นก่อนหน้า)
 * @returns {{ kids: Array, via: 'op_bom'|'auto_single'|'unset'|'from_prev' }} */
export function opInputsOf({ ownKids = [], parentKids = [], firstInChain = true } = {}) {
  if ((ownKids || []).length) return { kids: ownKids, via: 'op_bom' };
  if (!firstInChain) return { kids: [], via: 'from_prev' };
  if ((parentKids || []).length === 1) return { kids: parentKids, via: 'auto_single' };
  return { kids: [], via: 'unset' };
}

/** ลูกของแม่ที่ยังต้องเบิกตอนเปิดใบแม่ = BOM SAP − ของที่ขั้น OP ของแม่กินไปแล้ว
 * @param {Array} parentKids  ลูกตรงของแม่ (fn_bom_direct_demand)
 * @param {Array<Array>} opKidLists  ผล opInputsOf().kids ของทุกขั้น OP ของแม่ตัวนี้ (unset = [] ไม่หักอะไร) */
export function parentKidsAfterOps(parentKids = [], opKidLists = []) {
  const eaten = new Set(opKidLists.flat().map(x => k(x?.mat_no)).filter(Boolean));
  return (parentKids || []).filter(x => !eaten.has(k(x?.mat_no)));
}
