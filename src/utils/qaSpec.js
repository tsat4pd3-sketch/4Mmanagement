/**
 * qaSpec — "สเปคของจุดตรวจ" จุดเดียว (single source of truth · 2026-09-07)
 *
 * ปัญหาที่แก้ (เจอจริงจากจอ /qa 07/09): จุด `test` ตั้ง LSL 4 · Nominal 5 · USL 6 แต่ช่อง
 * "ข้อความตามแบบ" (`spec_text`) พิมพ์ว่า "5" → จอตรวจโชว์ "สเปค: 5 mm" ขณะที่ตัดสินอัตโนมัติ
 * ใช้ 4–6 ⇒ คนตรวจเห็นค่า 6.1 "ไม่ผ่าน" โดยไม่รู้ว่าเส้นอยู่ตรงไหน
 *   · สเปคถูกเก็บ 2 แบบ (ข้อความ + ตัวเลข) แล้วจอหนึ่งอ่านแบบหนึ่ง ตัวตัดสินอ่านอีกแบบ = drift
 *   · ตัวประกอบ label ยังเขียนซ้ำ 2 ไฟล์ (QaCheckSheet.specOf + ตาราง QAInspectionSetup)
 *
 * กติกา:
 *   1. จุด variable ที่ตั้ง limit ตัวใดตัวหนึ่ง → **ตัวเลข (nominal/lsl/usl) คือความจริง**
 *      label ต้องโชว์ช่วงที่ใช้ตัดสินเสมอ · `spec_text` เป็นแค่ "ข้อความตามแบบ" ประกอบ
 *   2. ไม่มี limit → ใช้ `spec_text` (จุด attribute หรือสเปคที่เป็นข้อความล้วน) → ไม่มีอีก = GO/NOGO / —
 *   3. ทุกจอ (ใบตรวจ · ตาราง setup · snapshot ลง qa_inspection_results) เรียก `specLabel` เท่านั้น
 *      ห้ามประกอบเองซ้ำ — ตัวตัดสิน `judgeVariable` อยู่ไฟล์นี้ด้วย ให้ label กับคำตัดสินอ่านค่าชุดเดียวกัน
 */

const num = (v) => (v == null || v === '' ? null : Number(v));
// รับ '' จาก input ในฟอร์มด้วย — ช่องว่างไม่ใช่ limit
const hasLimit = (it) => num(it?.lsl) != null || num(it?.usl) != null || num(it?.nominal) != null;
const fmt = (v) => (v == null ? null : String(v));

/** ช่วงที่ใช้ตัดสิน — "4 – 6" · ข้างเดียว = "≥ 4" / "≤ 6" · ไม่มี = null */
export function limitRange(it) {
  const lsl = num(it?.lsl), usl = num(it?.usl);
  if (lsl != null && usl != null) return `${fmt(lsl)} – ${fmt(usl)}`;
  if (lsl != null) return `≥ ${fmt(lsl)}`;
  if (usl != null) return `≤ ${fmt(usl)}`;
  return null;
}

/**
 * ข้อความสเปคที่ทุกจอต้องใช้
 *   variable + limit  → "5 (4 – 6) mm" · ไม่มี nominal → "4 – 6 mm" · มีแต่ nominal → "5 mm"
 *   ไม่มี limit       → spec_text (+หน่วย) · ไม่มีอีก → attribute = "GO / NOGO" · variable = "—"
 * @param {object} it  qa_inspection_items (หรือ draft ในฟอร์ม — รับค่า string จาก input ได้)
 */
export function specLabel(it) {
  if (!it) return '—';
  const unit = it.unit ? ` ${it.unit}` : '';
  if (it.item_type === 'variable' && hasLimit(it)) {
    const nominal = num(it.nominal), range = limitRange(it);
    const core = nominal != null && range ? `${fmt(nominal)} (${range})` : (range || fmt(nominal));
    return `${core}${unit}`;
  }
  const text = String(it.spec_text ?? '').trim();
  if (text) return `${text}${unit}`;
  return it.item_type === 'variable' ? (unit.trim() ? `—${unit}` : '—') : 'GO / NOGO';
}

/**
 * ตัดสินจุด variable จากค่าที่วัด — ทุกค่าต้องอยู่ในช่วง
 * @returns {'ok'|'ng'|null}  null = ตัดสินเองไม่ได้ (ไม่มี limit / ยังไม่กรอก / กรอกไม่ใช่ตัวเลข) — ห้ามแปลงเป็นผ่าน
 */
export function judgeVariable(it, values) {
  const lsl = num(it?.lsl), usl = num(it?.usl);
  if (lsl == null && usl == null) return null;
  const nums = (values || []).filter(v => v !== '' && v != null).map(Number);
  if (!nums.length || nums.some(Number.isNaN)) return null;
  const bad = nums.some(v => (lsl != null && v < lsl) || (usl != null && v > usl));
  return bad ? 'ng' : 'ok';
}
