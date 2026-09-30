/* ═══════════════════════════════════════════════════════════════════════════
   กันเปิดใบแจ้งซ่อม "ซ้ำ" บนเครื่องเดียวกัน — pure (2026-09-30 · คำสั่ง user)

   ที่มา (วัดจริง 30/09 · ใบเปิดอยู่ 261 ใบ): มีใบที่เครื่อง+อาการ+วันเดียวกัน
   ถูกเปิดซ้ำ 12 กลุ่ม · ที่หนักคือ **ซ้ำข้ามทีม** — ปัญหาเดียวถูกเปิดทั้งฟอร์ม
   production และฟอร์ม maintenance/jig คนละใบ แล้วทั้งสองทีมวิ่งไปทำงานเดียวกัน:
     17/09 SP-80/NF93 · Stationary มีปัญหา    → 3 ใบ (maintenance + production)
     15/09 RB-115     · Sensor / Reed         → 3 ใบ (jig_maintenance + production)
     16/09 STANLEY-01 · ปืนยิงรีเวทชำรุด      → 2 ใบ (maintenance + production)

   🔴 กฎที่ยึด
   1. **เตือน ห้ามบล็อก** — เครื่องเดียวเสียซ้ำ 2 เรื่องในวันเดียวเกิดได้จริง
      (LS-04 เลเซอร์ 18/09 มี 4 ใบ ซึ่งอาจถูกต้องทั้งหมด) ตัดสินแทนคนหน้างานไม่ได้
   2. **เทียบเครื่องด้วย `machineKey()` เท่านั้น** (`utils/machineNo.js`) — `SW10` กับ
      `SW-10` คือเครื่องเดียวกัน เทียบ string ตรงๆ = เตือนไม่ขึ้นเงียบๆ
   3. **"จบแล้ว" ใช้ `MO_DONE_STATUSES` จาก `mtnStepPerm.js` ห้ามเขียนลิสต์ซ้ำ**
      (เพิ่มสถานะจบใหม่ทีไร ที่เขียนเองจะตกหล่นทุกครั้ง)
   4. **รับ `now` เป็นพารามิเตอร์** — เทสรอบ "นาฬิกา +400 วัน" ใน `npm test` จะพัง
      ถ้าอ่าน `Date.now()` เอง
   5. **เครื่องว่าง = ไม่เตือน** คืน [] — ห้ามเดาจากไลน์อย่างเดียว (ทั้งไลน์มีใบเปิด
      อยู่หลายสิบใบเป็นเรื่องปกติ เตือนทุกครั้ง = คนเลิกอ่าน)
   ═══════════════════════════════════════════════════════════════════════════ */
import { machineKey } from './machineNo.js';
import { MO_DONE_STATUSES } from './mtnStepPerm.js';

/** ใบนี้ยังเปิดอยู่ไหม — ก๊อปตรรกะ `isMoOpen` แต่รับ status ดิบ (ใบในลิสต์เป็น row ย่อ) */
const isOpen = (o) => !MO_DONE_STATUSES.includes(String(o?.status || '').trim());

/** วันที่ค้าง (ปัดลง) — ค่าที่อ่านไม่ได้คืน null ห้ามคืน 0 (0 = "เพิ่งแจ้ง" ซึ่งโกหก) */
export function daysOpen(iso, now = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((now - t) / 86400000));
}

/**
 * ใบที่เปิดค้างอยู่บน "เครื่องเดียวกัน" กับที่กำลังจะแจ้ง
 *
 * @param {Array} orders   ใบทั้งหมดที่หน้าโหลดไว้แล้ว (ไม่ยิงคิวรีเพิ่ม — egress 0)
 * @param {string} machineNo เลขเครื่องที่ผู้แจ้งเลือก
 * @param {object} opts    { now, excludeId }
 * @returns {Array} ใบซ้ำ เรียงเก่าสุดก่อน + ฟิลด์ `_days`
 */
export function findOpenOnMachine(orders, machineNo, { now = Date.now(), excludeId = null } = {}) {
  const key = machineKey(machineNo);
  if (!key) return [];                                   // ยังไม่เลือกเครื่อง = ไม่เตือน
  return (Array.isArray(orders) ? orders : [])
    .filter(o => o && o.id !== excludeId && isOpen(o) && machineKey(o.machine_no) === key)
    .map(o => ({ ...o, _days: daysOpen(o.report_at, now) }))
    .sort((a, b) => String(a.report_at || '').localeCompare(String(b.report_at || '')));
}

/**
 * ระดับความน่าสงสัย — ใช้เลือกสีกล่องเตือน
 * · `cross`  = มีใบของ**ทีมอื่น** เปิดค้างบนเครื่องนี้ ⇒ เสี่ยงทำงานซ้ำซ้อนจริง (แดง)
 * · `same`   = มีแต่ใบของทีมเดียวกัน ⇒ อาจเป็นคนละอาการ (เหลือง)
 * · `none`   = ไม่มี
 * 🔴 `myDept` ว่าง = ตัดสินไม่ได้ว่าข้ามทีมไหม → ถือเป็น `same` (เตือนอ่อนกว่า)
 *    **ห้ามเดาว่าเป็น cross** — เตือนแดงผิดบ่อยๆ คนจะเลิกอ่านทั้งกล่อง
 */
export function dupLevel(dups, myDept) {
  if (!dups.length) return 'none';
  const mine = String(myDept || '').trim();
  if (!mine) return 'same';
  return dups.some(o => String(o.mtn_dept || '').trim() && String(o.mtn_dept).trim() !== mine) ? 'cross' : 'same';
}
