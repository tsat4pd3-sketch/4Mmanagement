/* ══ 🔧 "ชั่วโมงหยุดก้อนนี้ เป็นเครื่องเสียที่ช่างรับผิดชอบไหม" ══════  2026-11-13
   คำสั่ง user: *"ทำข้อ 2 ติดธงในทะเบียนประเภท downtime"*

   ── ที่มา (วัดจริง ต.ค. 2026 · downtime นอกแผนที่ปิดแล้ว) ────────────────────
   KPI ทางการนับ **ทุกแถวที่ไม่ใช่ planned** เข้า Machine Break Down / MTTR / MTBF ของทีมช่าง
   โดยไม่สนว่าช่างเคยถูกเรียกไหม ⇒ ช่างแบกชั่วโมงที่ไม่เคยถูกเรียก **813.6 ชม. (78.8%)**
   และในก้อนนั้นมี **"แก้ไขปัญหาคุณภาพ" + "แก้ไขคุณภาพระหว่างผลิต" รวม 107.6 ชม.**
   ซึ่งไม่ใช่เครื่องเสียเลย · บวก "ปรับแม่พิมพ์ / ปรับ Clearance" 34.4 ชม. ที่เป็นงานปรับตั้ง

   ── ทำไมต้องเป็น "ธงในทะเบียน" ไม่ใช่เดาจากคำ ──────────────────────────────
   🔴 กฎโปรเจค §"อื่นๆ/ไม่ระบุ" ข้อ 5: **เดาหมวดจากคำ = ท่าสุดท้าย · ห้ามเดา taxonomy**
      ชื่อประเภทอย่าง "อื่นๆ (นอกแผน)" (108 ชม. · อันดับ 1) เดาไม่ได้เลยว่าของใคร
   ⇒ ให้ **คนที่รู้งานติ๊กครั้งเดียวในทะเบียน** (`dr_downtime_types.is_machine_breakdown`)
      แล้วทุกจอใช้ธงนั้นร่วมกัน — ไม่มีใครเขียนเกณฑ์ชุดที่ 2

   ── 🔴 3 สถานะ ห้ามยุบเหลือ 2 ────────────────────────────────────────────────
     `yes`   (true)  = ของช่าง — เข้า Machine Break Down ฝั่งช่าง
     `no`    (false) = **ไม่ใช่ของช่าง** (คุณภาพ · ปรับตั้ง · รอของ) — ยังเป็นไลน์หยุดของผลิตเต็มๆ
     `unset` (null)  = **ยังไม่มีใครติ๊ก ≠ ไม่ใช่ของช่าง**
   🔴 `unset` ต้องเป็นถังที่ **มองเห็นบนจอ** และ **ไม่ถูกนับเข้าฝั่งใดฝั่งหนึ่ง**
      ถ้าเดาว่า unset = ไม่ใช่ของช่าง ⇒ ตัวเลขช่างดีขึ้นฟรีทันทีโดยไม่มีใครตัดสินใจ
      ถ้าเดาว่า unset = ของช่าง ⇒ เหมือนไม่ได้ทำอะไรเลย
   🔴 **ธงนี้ไม่แตะเลขทางการ** — KPI ที่ส่งกลุ่มยังใช้ไลน์หยุดเต็มเหมือนเดิม
      (กลุ่มเป็นเจ้าของนิยาม · ESM = ที่ผลิตตัวเลข Actual) · ธงนี้ให้ "อีกมุมหนึ่ง" คู่กันเท่านั้น   */

/** 3 สถานะของธง — ลำดับนี้คือลำดับบนจอ */
export const MB_FLAGS = Object.freeze([
  { key: 'yes',   label: 'ของช่าง (เครื่องเสีย)', short: 'ของช่าง',      value: true,
    hint: 'นับเข้า Machine Break Down ฝั่งช่าง เช่น Robot Alarm · Sensor · แม่พิมพ์ชำรุด' },
  { key: 'no',    label: 'ไม่ใช่ของช่าง',        short: 'ไม่ใช่ของช่าง', value: false,
    hint: 'ไลน์หยุดจริงแต่ไม่ใช่เครื่องเสีย เช่น แก้ไขปัญหาคุณภาพ · ปรับตั้ง · รอของ' },
  { key: 'unset', label: 'ยังไม่ระบุ',           short: 'ยังไม่ระบุ',    value: null,
    hint: 'ยังไม่มีใครตัดสิน — ชั่วโมงจะอยู่ถังแยก ไม่ถูกนับให้ฝั่งไหน' },
]);

export const mbFlagMeta = (key) => MB_FLAGS.find(f => f.key === key) || MB_FLAGS[2];

/**
 * ธงของประเภท downtime หนึ่งแถว
 * @param {object|null} dtType แถวจาก `dr_downtime_types`
 * @returns {'yes'|'no'|'unset'}
 * 🔴 `undefined` (คิวรีไม่ได้ select คอลัมน์มา) = `unset` เหมือน null — **ห้ามเดาเป็น yes**
 */
export function mbFlagOf(dtType) {
  const v = dtType?.is_machine_breakdown;
  if (v === true) return 'yes';
  if (v === false) return 'no';
  return 'unset';
}

/** ค่าที่จะเก็บลงฐานจากคีย์บนจอ — `unset` = `null` (ห้ามเก็บ false แทน) */
export function mbValueForDb(key) {
  const m = MB_FLAGS.find(f => f.key === key);
  return m ? m.value : null;
}

/**
 * แยกชั่วโมงเป็น 3 ถังตามธง — ใช้ตอนสรุปรายเดือน
 * @param {Array} rows [{ flag:'yes'|'no'|'unset', hr:number }]
 * @returns {{ yesHr, noHr, unsetHr, totalHr, decidedPct:number|null }}
 * 🔴 `decidedPct` = ตัดสินไปแล้วกี่ % ของชั่วโมง — `null` เมื่อยังไม่มีชั่วโมงเลย (ห้ามคืน 0)
 */
export function splitByMbFlag(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const sum = (k) => list.filter(r => r?.flag === k)
    .reduce((s, r) => s + (Number(r?.hr) || 0), 0);
  const yesHr = sum('yes'), noHr = sum('no'), unsetHr = sum('unset');
  const totalHr = yesHr + noHr + unsetHr;
  return {
    yesHr, noHr, unsetHr, totalHr,
    decidedPct: totalHr > 0 ? ((yesHr + noHr) / totalHr) * 100 : null,
  };
}
