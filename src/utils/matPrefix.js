/*
  ประเภทพาร์ทจาก MAT SAP — single source of truth (2026-08-13)
  ═══════════════════════════════════════════════════════════
  ⚠️ แยกด้วย **เลขตัวแรกตัวเดียว** ห้ามเทียบ 3 ตัวแรก ('100'/'200'/'300'/'500')

  เหตุผล: เลข SAP รันต่อเนื่องจนทะลุช่วงเดิมไปแล้ว — FG วิ่งจาก 100xxxxx ไปเป็น
  101xxxxx (ข้อมูลจริง 2026-08-13: 10100286 / 10100333 / 10100379 …) พอโค้ดเทียบ
  '100' ของพวกนี้ถูกกรองตกทั้งที่เป็น FG → ผู้ใช้ค้นไม่เจอ (user แจ้ง)
  ช่วงเลขจะขยับได้อีกเรื่อยๆ แต่ "เลขตัวแรก" คือแกนที่ SAP การันตีว่าไม่เปลี่ยน

  ตรงกับกฎ MAT SAP ใน CLAUDE.md และกฎฝั่ง DB (stock_inflow_rules ใช้ prefix '1'/'2'
  · route_buy_parts ใช้ like '3%'/'5%') — ทั้งสองฝั่งเป็นเลขตัวเดียวอยู่แล้ว
*/

export const MAT_CLASSES = [
  { digit: '1', key: 'fg',       label: 'FG (ส่งลูกค้า)',                short: 'FG',           color: '#22c55e' },
  { digit: '2', key: 'child',    label: 'Child Part (ผลิตเอง)',          short: 'Child (ผลิต)', color: '#3b82f6' },
  { digit: '3', key: 'buy',      label: 'Child Part (ซื้อนอก)',          short: 'Child (ซื้อ)', color: '#f59e0b' },
  { digit: '5', key: 'raw',      label: 'Raw Material',                  short: 'Raw Mat',      color: '#a78bfa' },
  // เบอร์ 9 = เลขภายในที่ทีมงานตั้งเอง (พาร์ทพิเศษที่ยังไม่มี routing ใน SAP)
  // ไม่ใช่เลขผิด/เลขรอแก้ — ดู CLAUDE.md ตาราง MAT SAP (user ยืนยัน 2026-08-10)
  { digit: '9', key: 'internal', label: 'เลขภายใน (ยังไม่มี routing SAP)', short: 'ภายใน',      color: '#94a3b8' },
];

/** เลขตัวแรกของ mat (string ว่างถ้าไม่มีค่า) */
export const matDigit = (mat) => String(mat ?? '').trim().charAt(0);

/* ⚠️⚠️ เลข MAT SAP จริง = **ตัวเลขล้วน 8 หลัก** เท่านั้น (user ยืนยัน 2026-08-31 "ปกติ mat sap
   จริงๆจะ 8 หลัก · อย่าง 127 ไม่ใช่ mat sap") — ตรวจกับข้อมูลจริงในรีโปแล้ว: MAT ทุกตัวเป็น 8 หลักเป๊ะ
   (10100333 · 20058626 · 50031601 · 90031601 …) · 7 หลักที่เจอคือ "เลขเคลม" · 10 หลักคือ cost center

   ทำไมต้องมีตัวนี้: `dr_products.mat_no` **ไม่ได้เก็บแต่เลข SAP** — ชั้น Operation ใช้ช่องเดียวกัน
   เก็บ "ชื่อขั้นตอน" (`127 (M6 มีเกลียว)` · `E024 …` · `M6 ไม่มีเกลียว` · `291+088`)
   เอา "ตัวแรก" ไปตีความจึงป้ายผิดสนิท — `127 (M6 มีเกลียว)` เคยถูกป้ายว่า **FG ส่งลูกค้า**
   ⇒ ไม่ใช่เลข SAP = **ตอบไม่ได้ว่าประเภทไหน คืน null ห้ามเดา** (หลัก "ไม่รู้ ≠ ไม่ใช่") */
export const isSapMat = (mat) => /^\d{8}$/.test(String(mat ?? '').trim());

/** class จาก "เลขประเภท" ตรงๆ — ใช้กับค่าใน dropdown / `material_category` (รับค่าเก่า '200' ด้วย)
 *  ⚠️ คนละตัวกับ `matClassOf` ที่รับ "เลข MAT" — ห้ามสลับกัน */
export const classByDigit = (d) => MAT_CLASSES.find(c => c.digit === matDigit(d)) || null;

/** class ของ "เลข MAT" — ไม่ใช่เลข SAP 8 หลัก = คืน null (ไม่เดาจากตัวแรก) */
export const matClassOf = (mat) => (isSapMat(mat) ? classByDigit(matDigit(mat)) : null);

export const matColor = (mat) => matClassOf(mat)?.color || 'var(--muted)';
export const matLabel = (mat) => matClassOf(mat)?.short || '—';

/** FG = เลข SAP ที่ขึ้นต้นด้วย 1 (ห้ามจ่ายเข้าไลน์/สโตร์ — หักผ่าน Delivery ทางเดียว)
 *  ⚠️ ต้องเป็นเลข SAP จริงด้วย ไม่งั้นชื่อขั้นตอนที่ขึ้นต้นด้วย 1 จะถูกกันเป็น FG ทั้งที่ไม่ใช่ */
export const isFgMat = (mat) => isSapMat(mat) && matDigit(mat) === '1';

/**
 * ใช้กับตัวกรอง: mat เข้าเกณฑ์ประเภทที่เลือกไหม
 * รับได้ทั้ง '1' และค่าเก่าแบบ '100' (เผื่อ state/localStorage ที่ค้างจากเวอร์ชันก่อน)
 * — เทียบเฉพาะตัวแรกเสมอ
 *
 * ⚠️ **ตั้งใจให้ "หลวม" ไม่เช็ค isSapMat** — ตัวกรองมีหน้าที่ *ไม่ซ่อนของ* ส่วนป้ายกำกับ
 * (`matClassOf`/`matLabel`) มีหน้าที่ *ไม่โกหก* → ของที่ไม่ใช่เลข SAP ยังค้นเจอได้ แต่ไม่ถูกติดป้ายประเภท
 * จอที่อยากคง "ของที่ตัดสินไม่ได้" ไว้เสมอ ให้เช็ค `isSapMat` เองที่ตัวกรองของหน้านั้น
 * (เช่น picker วัสดุจุด WIP — ดู `filterWipMatByCat`)
 */
export const matMatches = (mat, sel) => !sel || matDigit(mat) === String(sel).charAt(0);
