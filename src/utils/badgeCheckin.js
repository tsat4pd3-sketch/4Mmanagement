/* ══ 🪪 badgeCheckin — เช็คชื่อด้วยการสแกน QR บนบัตรพนักงาน (2026-10-27 · คำสั่ง user) ══════════════════════
   QR บนบัตรพนักงาน TSAT = **รหัสพนักงานล้วน** (เช่น "2101864" — ตรงกับ "รหัส" ที่พิมพ์บนบัตร) ⇒ จับคู่กับ
   `employees.employee_id_code` (วัดจริง 27/10: active 245 คน มีรหัสครบ ไม่ซ้ำ · 7 หลัก 185 · แบบมีตัวอักษร 60 เช่นพนักงานรับเหมา)

   🔴 กติกา:
   · จับคู่ **ตรงเป๊ะ** หลังปรับรูป (ตัวพิมพ์/ช่องว่าง/ขีด) เท่านั้น — ห้ามจับแบบ "มีเลขนี้อยู่ข้างใน" (คลาสเดียวกับ exactScanMatch)
   · สแกน = **ติ๊ก "มางาน" บนจอ ไม่ได้บันทึกลงฐาน** — คนยังต้องกดบันทึก (ผ่าน popup "บันทึกในนามใคร" เหมือนเดิม)
   · คนที่มีในทะเบียนแต่ไม่อยู่ในรายชื่อที่แสดง (คนละไลน์/กะ/ตัวกรอง) = **ไม่ติ๊กให้** บอกเหตุผล — ห้ามเช็คชื่อข้ามรายชื่อเงียบๆ
   · ลาเต็มวันอยู่แล้วแต่มาสแกนบัตร = มาจริง ⇒ ล้างการลา (กติกาเดียวกับเลือก "ไม่ลา" ใน setLeaveType) · ลาครึ่งวัน = คงการลาไว้
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */

/** ปรับรูปรหัสพนักงานก่อนเทียบ — ตัด ช่องว่าง/ขีด/ขึ้นบรรทัด · ตัวพิมพ์ใหญ่ */
export const normBadgeCode = (s) => String(s ?? '').replace(/[\s\-_]/g, '').toUpperCase();

/** หาพนักงานจากรหัสบนบัตร · ไม่เจอ/เจอเกิน 1 คน = null (ห้ามเดา) */
export function findByBadge(employees, raw) {
  const q = normBadgeCode(raw);
  if (!q) return null;
  const hits = (employees || []).filter(e => e?.employee_id_code && normBadgeCode(e.employee_id_code) === q);
  return hits.length === 1 ? hits[0] : null;
}

/** record การเช็คชื่อหลังสแกนบัตร = มางาน (ลาเต็มวัน → ล้างการลา · ลาครึ่งวันคงไว้) */
export function markPresentRecord(rec = {}) {
  const fullDayLeave = !!rec.leave_type && (rec.leave_duration || 'full') === 'full';
  return fullDayLeave
    ? { ...rec, is_present: true, leave_type: '', leave_duration: '', leave_period: '', leave_hours: '' }
    : { ...rec, is_present: true };
}

/**
 * ตัดสินผลการสแกน 1 ครั้ง
 * @param {{ employees: object[], displayedIds: Set<any>, attendance: object, raw: string }} a
 * @returns {{ kind: 'marked'|'already'|'not_shown'|'unknown', emp?: object, record?: object }}
 *   marked = ติ๊กให้แล้ว (record = ค่าใหม่) · already = มางานอยู่แล้ว · not_shown = มีในทะเบียนแต่ไม่อยู่ในรายชื่อที่แสดง ·
 *   unknown = ไม่พบรหัสนี้ในรายชื่อที่โหลดมา
 */
export function badgeScanOutcome({ employees, displayedIds, attendance, raw }) {
  const emp = findByBadge(employees, raw);
  if (!emp) return { kind: 'unknown' };
  if (!displayedIds?.has(emp.id)) return { kind: 'not_shown', emp };
  const cur = attendance?.[emp.id] || {};
  if (cur.is_present && !(cur.leave_type && (cur.leave_duration || 'full') === 'full')) return { kind: 'already', emp };
  return { kind: 'marked', emp, record: markPresentRecord(cur) };
}
