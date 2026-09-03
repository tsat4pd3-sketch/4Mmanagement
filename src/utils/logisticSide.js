/*
  ฝั่งงาน Logistic — ขาเข้า / ขาออก / แผนงาน&ข้อมูล   (2026-09-03 · คำสั่ง user)
  ═══════════════════════════════════════════════════════════════════════════
  ฝ่าย Logistic & Sales มี 7 แผนกย่อย แบ่งความรับผิดชอบเป็น 3 ฝั่ง:

    📥 ขาเข้า (Inbound)  — Store
       ของจาก supplier + ชิ้นส่วนที่คุมภายใน: 3xx (ซื้อนอก) · 5xx (raw) · 2xx (ผลิตเอง)

    📤 ขาออก (Outbound)  — Warehouse · Delivery · Rack Center
       ทุกอย่างที่ "เกี่ยวพันกับลูกค้า": FG 1xx · รอบส่งลูกค้า · ภาชนะ/packaging

    🧭 แผนงาน & ข้อมูล   — Sales · Planner · Billing
       ไม่ได้ถือของ แต่คุม/ประสานข้อมูลระหว่าง ขาเข้า ↔ ผลิต ↔ ขาออก
       (Sales รับข้อมูลลูกค้า · Planner วางแผนผลิต + เรียกงานจาก supplier · Billing ออกบิลผ่าน SAP)

  ⚠️⚠️ ความต่าง Warehouse กับ Store (user ย้ำให้จำ 2026-09-03 — ห้ามสลับ)
       Warehouse = ที่เก็บ **ชิ้นส่วน FG 1xx** รอส่งลูกค้า  → ขาออก
       Store     = คุม **2xx / 3xx / 5xx**                  → ขาเข้า
     สองคำนี้คนละแผนก คนละฝั่ง คนละความรับผิดชอบ — ในโค้ด/จอ/เอกสารต้องเรียกให้ตรงเสมอ

  ⚠️ "ไม่รู้" ต้องเป็นคำตอบของตัวเอง ห้ามยัดเข้าฝั่งใดฝั่งหนึ่งเงียบๆ
     เลข 9xx (เลขภายในที่ทีมตั้งเอง ดู CLAUDE.md ตาราง MAT SAP) และเลขพาร์ทลูกค้า
     (MB3B-… ที่ยังไม่ resolve เป็นเลข SAP) **จัดฝั่งไม่ได้** → คืน null
     แล้วจอต้องโชว์เป็น "ไม่ระบุฝั่ง" พร้อมจำนวน — หลักเดียวกับ coverage.unknown ใน Delivery
     (ข้อมูลจริง 2026-09-03: line_stock_summary 106 แถว มี 3 แถวที่เป็นเลขลูกค้า)

  ต่อยอดบน src/utils/matPrefix.js — แยกด้วย **เลขตัวแรกตัวเดียว** ห้ามเทียบ 3 ตัวแรก
*/
import { matDigit, MAT_CLASSES } from './matPrefix.js';   // .js เพื่อให้ node:test resolve ได้ (bundler ไม่สน)

/** เลขตัวแรก → ฝั่ง · ไม่มีในตารางนี้ = จัดฝั่งไม่ได้ (null) */
const DIGIT_SIDE = {
  '1': 'outbound',   // FG            → Warehouse + Delivery
  '2': 'inbound',    // child ผลิตเอง → Store
  '3': 'inbound',    // child ซื้อนอก → Store
  '5': 'inbound',    // raw material  → Store
  // '9' (เลขภายใน) จงใจไม่ใส่ — ยังไม่มี routing SAP บอกไม่ได้ว่าไหลทางไหน
};

export const SIDES = [
  {
    key: 'inbound', icon: '📥', label: 'ขาเข้า (Inbound)', short: 'ขาเข้า', color: '#38bdf8',
    owner: 'Store',
    desc: 'ของเข้าโรงงาน + ชิ้นส่วนภายใน · 3xx ซื้อนอก · 5xx raw · 2xx ผลิตเอง',
  },
  {
    key: 'outbound', icon: '📤', label: 'ขาออก (Outbound)', short: 'ขาออก', color: '#f59e0b',
    owner: 'Warehouse · Delivery · Rack Center',
    desc: 'ทุกอย่างที่เกี่ยวพันกับลูกค้า · FG 1xx · รอบส่ง · ภาชนะ/packaging',
  },
  {
    key: 'control', icon: '🧭', label: 'แผนงาน & ข้อมูล', short: 'แผนงาน', color: '#a78bfa',
    owner: 'Sales · Planner · Billing',
    desc: 'คุม/ประสานข้อมูลระหว่าง ขาเข้า ↔ ผลิต ↔ ขาออก (ไม่ได้ถือของ)',
  },
];

/** ฝั่งของรายการที่จัดฝั่งไม่ได้ — เป็นสถานะของตัวเอง ห้ามนับรวมเข้าฝั่งใดฝั่งหนึ่ง */
export const UNKNOWN_SIDE = {
  key: 'unknown', icon: '❔', label: 'ไม่ระบุฝั่ง', short: 'ไม่ระบุ', color: '#94a3b8',
  owner: '—',
  desc: 'เลขภายใน 9xx หรือเลขพาร์ทลูกค้าที่ยังไม่จับคู่ MAT SAP — ตัดสินฝั่งไม่ได้',
};

export const sideMeta = (key) => SIDES.find(s => s.key === key) || (key === 'unknown' ? UNKNOWN_SIDE : null);
export const sideLabel = (key) => sideMeta(key)?.label || UNKNOWN_SIDE.label;
export const sideColor = (key) => sideMeta(key)?.color || UNKNOWN_SIDE.color;

/**
 * mat → ฝั่ง  ('inbound' | 'outbound' | null)
 * null = จัดฝั่งไม่ได้ (เลข 9xx / เลขลูกค้า / ว่าง) — **ห้ามแปลงเป็นฝั่งใดฝั่งหนึ่ง**
 */
export const sideOfMat = (mat) => DIGIT_SIDE[matDigit(mat)] ?? null;

/** ใช้กับตัวกรอง: mat เข้าเกณฑ์ฝั่งที่เลือกไหม · sel ว่าง = ผ่านหมด · sel='unknown' = เฉพาะที่จัดฝั่งไม่ได้ */
export const sideMatches = (mat, sel) => {
  if (!sel) return true;
  const s = sideOfMat(mat);
  return sel === 'unknown' ? s == null : s === sel;
};

/**
 * แตกรายการเป็น 3 กอง — ใช้ทำตัวนับบนชิปกรอง
 * matOf: (row) => mat_no   (default = row.mat_no)
 * คืน { inbound, outbound, unknown } เป็น array ของแถวเดิม
 */
export function splitBySide(rows, matOf = (r) => r?.mat_no) {
  const out = { inbound: [], outbound: [], unknown: [] };
  for (const r of rows || []) out[sideOfMat(matOf(r)) || 'unknown'].push(r);
  return out;
}

/** ประเภท MAT ที่อยู่ในฝั่งนั้น — ใช้เขียนคำอธิบายบนจอ ไม่ให้ hardcode "3xx/5xx/2xx" ซ้ำ */
export const matClassesOfSide = (side) =>
  MAT_CLASSES.filter(c => DIGIT_SIDE[c.digit] === side);
