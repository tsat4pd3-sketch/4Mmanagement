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

export { STAFF_SUPPORT };
