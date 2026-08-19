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

/** คืน entry ของ MAT_CLASSES หรือ null ถ้าไม่เข้าเกณฑ์ไหนเลย (ไม่เดา) */
export const matClassOf = (mat) => MAT_CLASSES.find(c => c.digit === matDigit(mat)) || null;

export const matColor = (mat) => matClassOf(mat)?.color || 'var(--muted)';
export const matLabel = (mat) => matClassOf(mat)?.short || '—';

/** FG = ขึ้นต้นด้วย 1 (ห้ามจ่ายเข้าไลน์/สโตร์ — หักผ่าน Delivery ทางเดียว) */
export const isFgMat = (mat) => matDigit(mat) === '1';

/**
 * ใช้กับตัวกรอง: mat เข้าเกณฑ์ประเภทที่เลือกไหม
 * รับได้ทั้ง '1' และค่าเก่าแบบ '100' (เผื่อ state/localStorage ที่ค้างจากเวอร์ชันก่อน)
 * — เทียบเฉพาะตัวแรกเสมอ
 */
export const matMatches = (mat, sel) => !sel || matDigit(mat) === String(sel).charAt(0);
