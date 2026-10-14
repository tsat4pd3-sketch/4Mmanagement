/* 🏭 ชนิดของ "หน่วย" ในทะเบียน `production_lines` — src/utils/unitKind.js (2026-10-13 · คำสั่ง user)
 *
 * ที่มา: *"office pd4 เราเห็น user อยากใช้ระบบเช็คชื่อ แต่สร้างเป็นผังออฟฟิส
 *   ซึ่งไม่ใช่ไลน์ผลิต มันจะทำให้ระบบงง"*
 *
 * `production_lines` เป็นทางเดียวที่ผูกคนเข้าระบบเช็คชื่อได้ ⇒ หน่วยงานที่ไม่ได้ผลิต
 * (สำนักงาน · งานแก้ไข · งานเคลือบที่ยังไม่เปิดเดิน) ถูกสร้างเป็น "ไลน์" ตามไปด้วย
 * ⇒ โผล่ใน dropdown ของจอผลิตทุกจอ และถูกนับเป็นไลน์ในตัวหาร
 *
 * ── ⚠️ มี 2 แกนที่ชื่อคล้ายกัน ห้ามสับสน ───────────────────────────────────────────
 *   `production_lines.line_type` = **ชนิดกระบวนการ** ของไลน์ผลิต (stamping/laser/…)
 *                                  `src/utils/lineTypes.js` · ว่างได้ = ยังไม่จัดชนิด
 *   `production_lines.unit_kind` = **"เป็นไลน์ผลิตหรือเปล่า"** (ไฟล์นี้)
 *   ⇒ ไลน์ที่ `line_type` ว่าง **ยังเป็นไลน์ผลิต** — ห้ามเอา `line_type` ว่างไปตีความว่าไม่ผลิต
 *
 * 🔴 **กฎเหล็ก: จอผลิตต้องกรองด้วย `productionUnits()` เท่านั้น ห้ามเทียบชื่อไลน์เอง**
 *    (แผนผลิต · OEE · Daily Report · LPA · AM · Poka-Yoke · ความจุกะ)
 *    เทียบชื่อเอง = ไลน์ที่ตั้งใหม่ชื่ออื่นหลุดเข้าจอผลิตอีกรอบ · มีด่าน `unit-kind-no-name-match`
 *
 * ✅ **จอที่ต้องเห็นทุกหน่วย — ห้ามกรอง:** เช็คชื่อ · ผังองค์กร · ทะเบียนไลน์ (`/line-setup`)
 *    · จอที่ "เลือกคน" · กำลังคนรวมบริษัท — ให้**แยกกลุ่มให้เห็น** แทนการซ่อน
 *
 * 🔴 **ค่าว่าง/ไม่รู้จัก = ไลน์ผลิต** (default ของคอลัมน์) — fail-open ทางเดียวกับ `staffKind.js`:
 *    พลาดแล้ว "โผล่เกิน" (เห็นแล้วรู้) ดีกว่า "ไลน์ผลิตหายจากจอ" (ไม่มีใครรู้)
 */

export const UNIT_PRODUCTION = 'production';
export const UNIT_SUPPORT    = 'support';

export const UNIT_KINDS = [
  { key: UNIT_PRODUCTION, label: '🏭 ไลน์ผลิต',      desc: 'มีแผนผลิต · เปิดกะ · คิด OEE · ต้องตรวจรายวัน (AM/LPA/Poka-Yoke)' },
  { key: UNIT_SUPPORT,    label: '🗂️ หน่วยสนับสนุน', desc: 'สำนักงาน/งานสนับสนุน — ใช้เช็คชื่อ + ผังองค์กรได้ แต่ไม่โผล่ในจอผลิต' },
];

export const unitKindLabel = (k) => (k === UNIT_SUPPORT ? UNIT_KINDS[1].label : UNIT_KINDS[0].label);

/** true = เป็นไลน์ผลิตจริง (ค่าว่าง/ไม่รู้จัก = true ตาม default ของคอลัมน์) */
export const isProductionUnit = (line) => line?.unit_kind !== UNIT_SUPPORT;

/** true = หน่วยสนับสนุน (ไม่ใช่ไลน์ผลิต) */
export const isSupportUnit = (line) => line?.unit_kind === UNIT_SUPPORT;

/* 🔴 ตัวกรองทั้ง 3 ต้องทน `null` — ผู้เรียกส่ง `null` ได้จริงเมื่อทะเบียนไลน์ยังโหลดไม่เสร็จ
   หรือโหลดไม่สำเร็จ (`loadLinesRes()` คืน rows ว่าง + ธง) · `= []` ของ default param
   ครอบแค่ `undefined` **ไม่ครอบ `null`** ⇒ จอขาวทั้งหน้า (มีเทสคุม) */
const rows = (lines) => (Array.isArray(lines) ? lines : []);

/** เหลือเฉพาะไลน์ผลิต — ตัวกรองมาตรฐานของ "จอผลิต" */
export const productionUnits = (lines) => rows(lines).filter(isProductionUnit);

/** เหลือเฉพาะหน่วยสนับสนุน */
export const supportUnits = (lines) => rows(lines).filter(isSupportUnit);

/**
 * แยก 2 กลุ่มในครั้งเดียว — สำหรับจอที่ต้อง "แสดงทั้งคู่แต่แยกให้เห็น" (เช่น เช็คชื่อ)
 * @returns {{ production: object[], support: object[] }}
 */
export function splitUnitKinds(lines) {
  const production = [], support = [];
  for (const l of rows(lines)) (isSupportUnit(l) ? support : production).push(l);
  return { production, support };
}
