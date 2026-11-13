/* 🪪 employeeIdentity.js — "สร้างตัวตนพนักงานใหม่" ต้องได้แถวหน้าตาเดียวกันทุกทางเข้า
 * (2026-10-26 · audit ตามคำสั่ง user: *"การสร้างตัวตนใส่ฐานข้อมูลจากหน้าจัดการสิทธิ์ มันตรงกันมั้ย"*)
 *
 * ── ปัญหาที่เจอตอน audit ─────────────────────────────────────────────────────────────
 * มี **2 ทางเข้า** ที่ insert `employees` คนละชุดฟิลด์ เขียนแยกกันคนละไฟล์:
 *   1. `/register`  (Register.jsx)        — ฟอร์มเต็ม: วันเริ่มงาน · ทีม · ไลน์ · รถรับส่ง · รูป
 *   2. `/add-user`  (AddUser.addEmployee) — ฟอร์มสั้นในโมดัลแก้ผู้ใช้: + ประเภทพนักงาน
 * 🔴 **`/register` ไม่เคยเขียน `staff_kind` เลย** ⇒ ตกไปที่ default `'shopfloor'` ของคอลัมน์
 *    ⇒ QA/วิศวกร/ธุรการ/สโตร์ ที่ถูกลงทะเบียนทางนี้ **ถูกนับเป็นกำลังคนหน้าไลน์เงียบๆ**
 *    (เข้าแผงสกิล · เข้าตัวหาร manpower · เข้า turnover) — ดู `staffKind.js` §แกนที่ 1
 *
 * ⇒ ทุกทางเข้าต้องประกอบแถวผ่าน `newEmployeeRow()` **ที่นี่ที่เดียว**
 *   เพิ่มคอลัมน์ใหม่ = เติมที่นี่ครั้งเดียว ทุกทางเข้าได้เหมือนกันทันที (มีด่าน `employee-identity-single-entry`)
 *
 * 🔴 ฟิลด์ที่ทางเข้าหนึ่งไม่มีช่องให้กรอก = ส่ง `undefined` มา แล้วได้ `null`
 *    **ห้ามให้ทางเข้าไหน "เดาค่า" แทนคน** — ค่าว่างที่คนเห็นว่าว่าง แก้ต่อได้ที่ `/operator`
 *    แต่ค่าที่ระบบเดาให้ ไม่มีใครรู้ว่าต้องไปแก้
 */
import { STAFF_SHOPFLOOR, STAFF_SUPPORT, SUPPORT_VALUES } from './staffKind.js';
import { sectionValueForSave, orgNodeIdFor, ORG_SRC_MANUAL } from './sectionScope.js';

/** คอลัมน์ที่ "ตัวตนพนักงานใหม่" ครอบคลุม — ด่านเทสอ้างชื่อนี้ ห้ามเปลี่ยนชื่อ export */
export const EMPLOYEE_IDENTITY_COLUMNS = [
  'employee_id_code', 'name', 'position', 'section', 'department',
  'org_node_id', 'org_node_src', 'staff_kind',
  'group_name', 'team', 'line_id', 'bus_route_id', 'start_date', 'image_url', 'created_by',
];

const nz = (v) => {
  const s = typeof v === 'string' ? v.trim() : v;
  return s === '' || s === undefined ? null : s;
};

/**
 * ประกอบแถว `employees` สำหรับ **คนใหม่** (insert เท่านั้น — แก้ของเดิมใช้จอ `/operator`)
 *
 * @param {object}   i
 * @param {string}   i.employeeIdCode  รหัสพนักงาน (คอลัมน์ not null — ยังไม่มีรหัสจริงให้ออกรหัสชั่วคราว)
 * @param {string}   i.name            ชื่อ-นามสกุล
 * @param {string}  [i.staffKind]      `shopfloor` | `technician` | `support` — **ไม่ส่ง = หน้างาน** (ตรงกับ default ของคอลัมน์)
 * @param {string}  [i.section]        ค่าดิบจากช่อง Section (รวม sentinel "ขึ้นตรงฝ่าย")
 * @param {string}  [i.department]
 * @param {Array}   [i.orgSections]    org_nodes kind='section' — ใช้หา `org_node_id`
 * @param {Array}   [i.orgDepts]       org_nodes kind='department'
 * @param {string}  [i.position] [i.groupName] [i.team] [i.busRouteId] [i.startDate] [i.imageUrl]
 * @param {string}  [i.lineId]
 * @param {string}  [i.createdBy]      auth user id
 * @returns {object} แถวพร้อม insert
 */
export function newEmployeeRow({
  employeeIdCode, name, staffKind, section, department, orgSections = [], orgDepts = [],
  position, groupName, team, lineId, busRouteId, startDate, imageUrl, createdBy,
} = {}) {
  const kind = nz(staffKind) || STAFF_SHOPFLOOR;
  /* 🔴 สายสนับสนุนไม่ผูกไลน์/ทีม — เป็น "คำสัญญาที่เขียนไว้บนจอ" ทั้ง 2 หน้า
     (ถ้าปล่อยให้ติดไลน์มาได้ เขาจะโผล่ในตัวหารกำลังคนของไลน์นั้นทันที) */
  const noLine = SUPPORT_VALUES.includes(kind);
  return {
    employee_id_code: String(employeeIdCode ?? '').trim(),
    name:             String(name ?? '').trim(),
    position:         nz(position),
    department:       nz(department),
    section:          sectionValueForSave(section),   // sentinel "ขึ้นตรงฝ่าย" → null (ตรงกับผังจริง)
    /* 🧭 แกนสังกัด — ผูกโหนดในผังตั้งแต่สร้าง ไม่ต้องรอ backfill มาเดาทีหลัง
       (docs/ORG-AXES-DECISION.md §5.1 · ข้อความ section/department ข้างบน = สำเนาไว้โชว์) */
    org_node_id:      orgNodeIdFor(section, department, orgSections, orgDepts),
    org_node_src:     ORG_SRC_MANUAL,
    staff_kind:       kind,
    group_name:       noLine ? null : nz(groupName),
    team:             noLine ? null : nz(team),
    line_id:          noLine ? null : nz(lineId),
    bus_route_id:     nz(busRouteId),
    start_date:       nz(startDate),
    image_url:        nz(imageUrl),
    created_by:       nz(createdBy),
  };
}

/** ข้อความใต้ฟอร์ม — ทางเข้าไหนก็พูดเรื่องเดียวกัน (ห้ามเขียนคำอธิบายชุดที่ 2 ในหน้า) */
export function staffKindHint(kind) {
  if (SUPPORT_VALUES.includes(kind)) {
    return 'สายสนับสนุน = ไม่ผูกไลน์/ทีม ⇒ ไม่ถูกนับเป็นกำลังคนหน้าไลน์ · ไม่มีแผงสกิล (ยังเช็คชื่อได้)';
  }
  if (kind && kind !== STAFF_SHOPFLOOR) {
    return 'ช่าง = เช็คชื่อได้ แต่ไม่ถูกนับเป็นกำลังคนของไลน์ผลิต (ช่างประจำไลน์ตั้งที่ line_technicians)';
  }
  return 'พนักงานหน้าไลน์ = ถูกนับในเช็คชื่อ/กำลังคน/แผงสกิล';
}

/* ── 🔁 "รหัสนี้มีอยู่แล้ว" ต้องตอบเป็นคน ไม่ใช่ชื่อ constraint (2026-11-09) ──────────────────────
 * เกิดจริง 09/11: หัวหน้า PD2 ลงทะเบียน 3 คน (2103622 เจนนิภา · 2103793 ขันทอง · 2103242 สุทธวีร์) ไม่ได้
 *   toast ขึ้น `duplicate key value violates unique constraint "employees_employee_id_code_key"`
 *   ทั้ง 3 คน **มีอยู่ในฐานแล้ว** (21–23/09 · 06/10) แต่เป็นสายสนับสนุน section ว่าง/PD1 และ 1 คนถูกปิดใช้งาน
 *   ⇒ `/operator` ของ PD2 กรองตาม scope จึงมองไม่เห็น ⇒ คิดว่ายังไม่มี ⇒ กดเพิ่ม ⇒ ชนรหัส ⇒ ตัน
 * 🔴 "มีอยู่ในฐานแต่มองไม่เห็น" ต้องถูกเขียนบนจอตรงๆ: ชื่อใคร · อยู่ส่วนไหน · ใช้งาน/ปิดอยู่ · ไปแก้ที่ไหน
 *   ทุกทางเข้าถามด้วย `findEmployeeByCode()` ก่อน insert และแปล 23505 ด้วย `isDuplicateEmployeeError()` (กันแข่งกันกด)
 *   RLS SELECT ของ employees = true สำหรับ authenticated ⇒ มองเห็นข้ามส่วนงานได้ (ตรวจ 09/11) */

/** คอลัมน์ที่ต้องใช้ตอบว่า "คนนี้คือใคร อยู่ไหน" — ด่านเทสอ้างชื่อนี้ */
export const EMPLOYEE_LOOKUP_COLUMNS = 'id, employee_id_code, name, section, department, staff_kind, is_active, position';

/** ค้นแถวเดิมด้วยรหัสพนักงาน (ตัดช่องว่าง · ไม่สนตัวพิมพ์) · คืน `{ row, error }` — `row` null = ไม่มี · `error` = อ่านไม่ได้ (ห้ามตีเป็น "ไม่มี") */
export async function findEmployeeByCode(client, code) {
  const c = String(code ?? '').trim();
  if (!c) return { row: null, error: null };
  const res = await client.from('employees').select(EMPLOYEE_LOOKUP_COLUMNS).ilike('employee_id_code', c).limit(2);
  if (res.error) return { row: null, error: res.error };
  const rows = res.data || [];
  return { row: rows.find(r => (r.employee_id_code || '').trim().toLowerCase() === c.toLowerCase()) || rows[0] || null, error: null };
}

/** Postgres 23505 บน unique ของรหัสพนักงาน (กรณีสองคนกดพร้อมกัน หลังด่านค้นหาผ่านแล้ว) */
export function isDuplicateEmployeeError(err) {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /employees_employee_id_code_key/.test(String(err.message || ''));
}

/**
 * ข้อความเมื่อรหัสซ้ำ — บอกว่า "ใคร · อยู่ไหน · สถานะ · แก้ที่ไหน" (pure · ใช้ทั้ง /register และ /add-user)
 * @param existing แถวจาก findEmployeeByCode (อาจ null = รู้แค่ว่าซ้ำ แต่อ่านแถวไม่ได้)
 * @param o.scopeSecs ขอบเขตส่วนงานของผู้ดู ([] = เห็นทั้งโรงงาน) — ใช้บอกว่า "อยู่นอกขอบเขตที่คุณเห็น"
 */
export function duplicateEmployeeText(existing, { code, scopeSecs = [] } = {}) {
  const c = String(code ?? existing?.employee_id_code ?? '').trim();
  if (!existing) {
    return `รหัส ${c} มีอยู่ในฐานพนักงานแล้ว แต่อ่านรายละเอียดไม่ได้ — ค้นรหัสนี้ที่ /operator ก่อน ห้ามเพิ่มซ้ำ`;
  }
  const where = existing.section
    ? `ส่วน ${existing.section}${existing.department ? ` · ${existing.department}` : ''}`
    : 'ยังไม่ระบุส่วนงาน';
  const kind = SUPPORT_VALUES.includes(existing.staff_kind) ? 'สายสนับสนุน'
    : existing.staff_kind && existing.staff_kind !== STAFF_SHOPFLOOR ? 'ช่าง' : 'หน้างาน';
  const inactive = existing.is_active === false;
  const outOfScope = scopeSecs.length > 0 && !scopeSecs.includes(existing.section);
  const status = inactive ? 'ถูกปิดใช้งานอยู่' : 'ใช้งานอยู่';
  const fix = inactive
    ? 'เปิดใช้งานกลับได้ที่ /operator (แท็บพนักงานพ้นสภาพ) แทนการเพิ่มใหม่'
    : outOfScope
      ? 'อยู่นอกขอบเขตที่คุณเห็น — ให้ admin ย้ายส่วนงาน/แผนกที่ /operator แล้วจะโผล่ในรายชื่อของคุณ'
      : 'แก้ข้อมูลเดิมที่ /operator แทนการเพิ่มใหม่';
  return `รหัส ${c} มีอยู่แล้ว: ${existing.name || '(ไม่มีชื่อ)'} · ${kind} · ${where} · ${status} — ${fix}`;
}

export { STAFF_SUPPORT };
