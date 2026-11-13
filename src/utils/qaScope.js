/* ══ 🔬 qaScope.js — "QC คนนี้ตรวจคุณภาพให้หน่วยไหน" (2026-10-27 · คำสั่ง user) ═════════
 *
 * > *"QA ที่มาอยู่กับผลิต คือต้องอยู่ส่วน QA แต่หน้างาน ตรวจคุณภาพให้ไลน์ไหน
 * >  ไม่ควรขึ้นกับผลิตรึป่าว"*  → ใช่ · และ *"QA ต้องเห็นทั้งโรงงานในเรื่องของคุณภาพ"*
 *
 * ══ 🔴 3 แกนที่ห้ามปนกัน ═══════════════════════════════════════════════════════════════
 *   | คำถาม                 | เก็บที่                                        |
 *   | สังกัดใคร (บ้านจริง)  | `employees.section` = QA  (+ `profiles.section`) |
 *   | เห็นแค่ไหน            | `profiles.scope_depth='all'` — ทั้งโรงงาน       |
 *   | **ตรวจให้หน่วยไหน**   | **`qa_inspector_scopes` (ไฟล์นี้)**             |
 *
 * 🔴 **อ้างอิงเท่านั้น ไม่ใช่การย้ายสังกัด** — ห้ามเอาไปแตะ `employees.section` /
 *    `org_node_id` / `cost_center` · **ห้ามนับเป็นกำลังคนของไลน์** (QC = `staff_kind='support'`)
 *    หลักเดียวกับ `line_technicians` (ช่างประจำไลน์) และ `employee_flex_units` (คนวิ่งข้ามแผนก)
 *
 * 🔴 **ไม่ใช่ด่านสิทธิ์** — role `qa` ถือคีย์ `scope:all_units` อยู่แล้ว (ตั้งใจ ตามคำสั่ง user)
 *    ตารางนี้ตอบ "ใครรับผิดชอบหน่วยไหน" เพื่อมอบหมายงาน/แจ้งเตือน/รายงาน
 *    **ห้ามเอาไปใช้ใน `canWriteUnit`/`canWriteLine`** — ชั้น ③ มีเจ้าของแล้วที่ `writeScope.js`
 *
 * 🔴 **ทะเบียนว่าง = "ยังไม่ได้ตั้ง" ไม่ใช่ "ไม่รับผิดชอบอะไรเลย"** (`UNSET`)
 *    จอที่เอาไปกรอง ต้องเขียนบนจอว่ายังไม่ได้ตั้ง ห้ามโชว์เป็น "ไม่มีงาน"
 */

/** ผลลัพธ์ของ `qaCovers()` — จอต้องแยก 3 กรณี ห้ามยุบเป็น boolean */
export const QA_COVER = { YES: 'yes', NO: 'no', UNSET: 'unset' };

const norm = (s) => (s ?? '').toString().trim().toLowerCase();

/**
 * จัดแถวทะเบียนเป็น map: employee_id → Set(org_node_id)
 * @param {Array<{employee_id:string, org_node_id:string}>} rows
 */
export function qaScopeIndex(rows = []) {
  const by = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const emp = r?.employee_id, node = r?.org_node_id;
    if (!emp || !node) continue;
    if (!by.has(emp)) by.set(emp, new Set());
    by.get(emp).add(String(node));
  }
  return by;
}

/**
 * QC คนนี้รับตรวจโหนดนี้ไหม — **นับหน่วยที่อยู่ใต้โหนดที่เขาถืออยู่ด้วย**
 * (ถือ "ส่วน PD3" = รับตรวจทุกแผนก/กลุ่มใต้ PD3 — หลักเดียวกับ Cost Center ใน `ccScope.js`)
 *
 * @param {Map} idx         ผลจาก `qaScopeIndex()`
 * @param {string} empId    employees.id ของ QC
 * @param {string} nodeId   org_nodes.id ของหน่วยที่ถาม
 * @param {(id:string)=>string[]} ancestorsOf  คืน id ของแม่ไล่ขึ้นไป (รวมตัวเอง) — ไม่ส่ง = เทียบตรงตัว
 * @returns {'yes'|'no'|'unset'}
 */
export function qaCovers(idx, empId, nodeId, ancestorsOf) {
  const own = idx?.get?.(empId);
  if (!own || own.size === 0) return QA_COVER.UNSET;   // 🔴 ยังไม่ได้ตั้ง ≠ ไม่รับผิดชอบ
  if (!nodeId) return QA_COVER.NO;
  const chain = typeof ancestorsOf === 'function'
    ? [String(nodeId), ...(ancestorsOf(nodeId) || []).map(String)]
    : [String(nodeId)];
  return chain.some(id => own.has(id)) ? QA_COVER.YES : QA_COVER.NO;
}

/** ชื่อหน่วยที่ QC คนนี้รับตรวจ (เรียงตามที่ส่งมา) — ใช้โชว์บนจอ/ในรายงาน */
export function qaScopeNames(rows = [], empId, nodeNameOf) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r?.employee_id === empId)
    .map(r => nodeNameOf?.(r.org_node_id) || '')
    .filter(Boolean);
}

/** QC ที่รับตรวจหน่วยนี้ (ใช้ตอนอยากรู้ว่า "ไลน์นี้ใครดูแล") — คืน employee_id */
export function qaInspectorsOf(rows = [], nodeId) {
  const want = String(nodeId ?? '');
  if (!want) return [];
  return [...new Set((Array.isArray(rows) ? rows : [])
    .filter(r => String(r?.org_node_id) === want)
    .map(r => r.employee_id).filter(Boolean))];
}

/** ข้อความบอกสถานะบนจอ — **ห้ามเขียนชุดที่ 2 ในหน้า** */
export function qaCoverText(state, { who = 'QC คนนี้', unit = 'หน่วยนี้' } = {}) {
  if (state === QA_COVER.UNSET)
    return `ยังไม่ได้ตั้งว่า${who}รับตรวจหน่วยไหน — ตั้งที่ มาตรฐานการตรวจ → แท็บ QC ประจำไลน์`;
  if (state === QA_COVER.YES) return `${who}รับตรวจ${unit}`;
  return `${unit}ไม่ได้อยู่ในความรับผิดชอบของ${who}`;
}

/** สำหรับจอที่ต้องการชื่อ QC แบบ normalize เทียบกัน (ไม่ใช้ตัดสินสิทธิ์) */
export const sameQaPerson = (a, b) => !!a && norm(a) === norm(b);
