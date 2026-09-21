/* 👥 ประเภทพนักงานในทะเบียน `employees` — src/utils/staffKind.js (2026-09-21)
 *
 * ที่มา: user เคาะทางเลือก A (docs/IDENTITY-NOTIFY-DESIGN.md §5) —
 *   *"บัญชีที่เป็นคน indirect ที่อยู่แผนกซัพพอร์ท ที่ไม่ได้เกี่ยวกับ shopfloor เลย
 *     อย่างแผนก engineering, sales planner เค้าไม่ต้องมาเช็คชื่อ ไม่ได้ต้องอัพสกิล"*
 *
 * `employees` = ทะเบียนคน**ของทั้งบริษัท** (ไม่ใช่แค่คนหน้าไลน์) เพื่อให้ทุกบัญชีที่เป็นคน
 * ผูกตัวตนได้ ⇒ ตัวกรองแผนก/ส่วนงานของแจ้งเตือนใช้ได้จริง · ธงนี้คือตัวแยก 2 กลุ่ม
 *
 * 🔴 **กฎเหล็ก: จอที่ "นับคน" ต้องกรอง indirect ออกผ่านไฟล์นี้เท่านั้น ห้ามพิมพ์ `staff_kind` เองในหน้า**
 *    (เช็คชื่อ · สกิล · กำลังคน · turnover · จัดกะ · ยืมคนข้ามไลน์)
 *    ไม่กรอง = ธุรการ/QA/เซลล์ โผล่ในลิสต์เช็คชื่อและถูกนับเป็นกำลังคนหน้าไลน์ **เงียบๆ**
 *    มีด่าน regressionGuards สแกนไว้แล้ว
 *
 * ✅ **จอที่ "เลือกคน" ไม่ต้องกรอง** — ผู้แจ้งซ่อม · ผู้เข้าอบรม OJT · ผู้ถูกสังเกต BBS ·
 *    ผู้รับผิดชอบ action · คนขึ้นรถรับส่ง — คนทางอ้อมเป็นตัวเลือกที่ถูกต้องในบริบทพวกนี้
 *
 * ⚠️ แถวเดิมทุกแถวเป็น `direct` (default ของคอลัมน์) ⇒ เปิดใช้ตัวกรองแล้วตัวเลขเท่าเดิมเป๊ะ
 */

export const STAFF_DIRECT = 'direct';
export const STAFF_INDIRECT = 'indirect';

export const STAFF_KINDS = [
  { key: STAFF_DIRECT,   label: 'หน้าไลน์ / ช่าง',        desc: 'เช็คชื่อ · มีสกิล · นับเป็นกำลังคน' },
  { key: STAFF_INDIRECT, label: 'สายสนับสนุน (ทางอ้อม)', desc: 'QA · วิศวกรรม · ธุรการ · สโตร์ — ไม่เช็คชื่อ ไม่นับกำลังคน' },
];

export const staffKindLabel = (k) => STAFF_KINDS.find(s => s.key === k)?.label || STAFF_KINDS[0].label;

/** true = คนกลุ่มที่ต้องเช็คชื่อ/นับกำลังคน (ค่าว่าง/ไม่รู้จัก = นับเป็นหน้าไลน์ ตาม default ของคอลัมน์) */
export const isDirectStaff = (emp) => (emp?.staff_kind || STAFF_DIRECT) !== STAFF_INDIRECT;

/** กรองฝั่ง client — ใช้กับลิสต์ที่โหลดมาแล้ว */
export const directOnly = (rows = []) => rows.filter(isDirectStaff);

/**
 * กรองฝั่ง server — ต่อท้าย query builder ของ supabase-js
 *   `let q = supabase.from('employees').select(...); q = onlyDirectStaff(q)`
 * ใช้ `neq` (ไม่ใช่ `eq`) โดยตั้งใจ: แถวที่ค่าเพี้ยน/ค่าใหม่ในอนาคตยังถูกนับเป็นคนหน้าไลน์
 * ⇒ พลาดแล้ว "นับเกิน" (เห็นแล้วรู้) ดีกว่า "หายเงียบ" (ไม่มีใครรู้)
 */
export const onlyDirectStaff = (q) => q.neq('staff_kind', STAFF_INDIRECT);
