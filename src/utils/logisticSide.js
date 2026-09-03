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

/* ═══ ชั้น 3 — ฝั่งของ "คน/หน่วยงาน" (2026-09-04) ═════════════════════════════════
   ป้าย `org_nodes.logistic_side` ติดที่แผนก (7 แผนกใต้ Planning&Store) แล้วลูกตกทอด
   (หลักเดียวกับ `org_nodes.division` — orgDivisions.js) · บัญชีได้ฝั่งจาก
   `profiles.logistic_sides[]` (ตั้งตรง) หรือตกทอดจากแผนกของพนักงานที่ผูก
   ⚠️ ห้ามเดาฝั่งจากชื่อแผนก/ชื่อ role ในโค้ด — ยึดป้ายที่ผังเสมอ (โรงงานอื่นเรียกไม่เหมือนกัน)
   ⚠️ "ว่าง = ไม่จำกัด" โดยตั้งใจ: บัญชีที่ยังไม่ถูกตั้งฝั่งเห็นทุกฝั่งเหมือนก่อนมีฟีเจอร์นี้
      (ล็อกคนออกจากงานตัวเองไม่ได้ — กฎ "กรอง scope แล้วไม่เหลือ = ห้ามคืนลิสต์ว่าง") */

export const SIDE_KEYS = SIDES.map(s => s.key);

const normStr = (v) => String(v ?? '').trim().toLowerCase();

/** ล้างค่าให้เหลือเฉพาะ key ที่ถูกต้อง ไม่ซ้ำ · รับ null/ค่าเพี้ยนได้ (ข้อมูลจาก DB/sessionStorage) */
export function normalizeSides(arr) {
  const out = [];
  for (const v of Array.isArray(arr) ? arr : []) {
    const k = normStr(v);
    if (SIDE_KEYS.includes(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/** ฝั่งของ node หนึ่งในผัง — ไม่ได้ติดป้ายเอง = ตกทอดจากแม่ (กัน loop ที่ 10 ชั้น) */
export function sideOfNode(nodeId, orgNodes) {
  if (!nodeId || !orgNodes?.length) return null;
  const byId = new Map(orgNodes.map(n => [n.id, n]));
  let cur = byId.get(nodeId);
  for (let i = 0; cur && i < 10; i++) {
    const s = normStr(cur.logistic_side);
    if (SIDE_KEYS.includes(s)) return s;
    cur = cur.parent_id ? byId.get(cur.parent_id) : null;
  }
  return null;
}

/** ฝั่งของพนักงาน 1 คน — ยึด **แผนก** ก่อน (ป้ายอยู่ระดับแผนก · section 'Planning&Store' ไม่มีป้ายโดยตั้งใจ)
 *  ไม่มีแผนก/แผนกไม่มีป้าย ค่อยดู section (เผื่อโรงงานอื่นติดป้ายที่ระดับส่วน) */
export function sideOfEmployee(emp, orgNodes) {
  if (!emp || !orgNodes?.length) return null;
  const dep = normStr(emp.department);
  const sec = normStr(emp.section);
  if (dep) {
    const n = orgNodes.find(x => x.kind === 'department' && normStr(x.code || x.name) === dep)
           || orgNodes.find(x => x.kind === 'department' && normStr(x.name) === dep);
    const s = n && sideOfNode(n.id, orgNodes);
    if (s) return s;
  }
  if (sec) {
    const n = orgNodes.find(x => x.kind === 'section' && normStr(x.code || x.name) === sec);
    const s = n && sideOfNode(n.id, orgNodes);
    if (s) return s;
  }
  return null;
}

/** ฝั่งที่บัญชีนี้ทำ — [] = ไม่จำกัด
 *    1. explicitSides (profiles.logistic_sides — admin ตั้งที่ /add-user) ถ้ามี = source of truth
 *    2. ไม่มีค่อยตกทอดจากแผนกของพนักงานที่ผูก (derivedSide จาก sideOfEmployee)
 *    3. ไม่มีทั้งคู่ = [] เห็นทุกฝั่ง (backward-compatible กับบัญชีเดิมทั้งหมด) */
export function sidesForUser(explicitSides, derivedSide) {
  const ex = normalizeSides(explicitSides);
  if (ex.length) return ex;
  const d = normStr(derivedSide);
  return SIDE_KEYS.includes(d) ? [d] : [];
}

/** ฝั่งของเมนู 1 รายการ — จาก `side` ใน NAV_GROUP_META ของหมวดหลัก + หมวด alsoIn (หน้าที่คาบ 2 ฝั่ง)
 *  หมวดที่ไม่ใช่ Logistic ไม่มี side → [] = หน้ากลาง ไม่ถูกกรองด้วยฝั่ง */
export function pageSidesOf(item, groupMeta) {
  const out = [];
  for (const g of [item?.group, item?.alsoIn]) {
    const s = g && groupMeta?.[g]?.side;
    if (s && SIDE_KEYS.includes(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

/** เข้าหน้านี้ได้ตามฝั่งไหม — userSides ว่าง = ไม่จำกัด · pageSides ว่าง = หน้ากลาง ผ่านเสมอ
 *  ⚠️ เป็นชั้น "จำกัดเพิ่ม" ทับสิทธิ์ role เท่านั้น — ไม่เคยเปิดหน้าที่ role ไม่มีสิทธิ์ให้ */
export function sideAllows(pageSides, userSides) {
  const u = normalizeSides(userSides);
  if (!u.length) return true;
  const p = normalizeSides(pageSides);
  if (!p.length) return true;
  return p.some(s => u.includes(s));
}

/** ค่าเริ่มต้นของชิปกรองพาร์ทในหน้า — บัญชีที่อยู่ฝั่งเดียว (ขาเข้า หรือ ขาออก) เปิดหน้ามาเห็นของฝั่งตัวเองก่อน
 *  control (Sales/Planner/Billing) ไม่ถือของ → ไม่กำหนด · หลายฝั่ง/ไม่จำกัด → '' (ทั้งหมด) */
export function defaultSideFilter(userSides) {
  const mat = normalizeSides(userSides).filter(s => s === 'inbound' || s === 'outbound');
  return mat.length === 1 ? mat[0] : '';
}
