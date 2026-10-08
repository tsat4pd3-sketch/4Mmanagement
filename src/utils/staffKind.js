/* 👥 ประเภทพนักงานในทะเบียน `employees` — src/utils/staffKind.js (2026-09-21 · เปลี่ยนชื่อค่า 23/09)
 *
 * ที่มา: user เคาะทางเลือก A (docs/IDENTITY-NOTIFY-DESIGN.md §5) —
 *   *"บัญชีที่เป็นคน indirect ที่อยู่แผนกซัพพอร์ท ที่ไม่ได้เกี่ยวกับ shopfloor เลย
 *     อย่างแผนก engineering, sales planner เค้าไม่ต้องมาเช็คชื่อ ไม่ได้ต้องอัพสกิล"*
 *
 * `employees` = ทะเบียนคน**ของทั้งบริษัท** (ไม่ใช่แค่คนหน้าไลน์) เพื่อให้ทุกบัญชีที่เป็นคน
 * ผูกตัวตนได้ ⇒ ตัวกรองแผนก/ส่วนงานของแจ้งเตือนใช้ได้จริง · ธงนี้คือตัวแยก 2 กลุ่ม
 *
 * ── ⚠️ มีแกน direct/indirect **อีกแกนหนึ่ง** ห้ามสับสน (docs/ORG-AXES-DECISION.md §5.4) ──
 *   `org_nodes.labor_type` = ราย**แผนก** · ตอบ "คิดต้นทุนเป็นแรงงานตรงไหม" (ภาษาบัญชี)
 *   `employees.staff_kind` = ราย**คน**   · ตอบ "เช็คชื่อ/นับกำลังคนไหม"      (ไฟล์นี้)
 *   **ขัดกันจริงที่ช่าง MTN:** labor_type = indirect แต่ staff_kind = shopfloor (เช็คชื่อครบ 25/25)
 *   ⇒ 23/09 เปลี่ยนชื่อค่าฝั่งนี้เป็น shopfloor/support เพื่อเลิกชนกัน (ความหมายเดิมทุกประการ)
 *   ⇒ **ห้ามเอา 2 แกนนี้มาแทนกัน · ห้าม sync หากัน · และห้ามใช้ตัดสินสิทธิ์/ผู้รับแจ้งเตือน**
 *
 * 🔴 **กฎเหล็ก: จอที่ "นับคน" ต้องกรอง support ออกผ่านไฟล์นี้เท่านั้น ห้ามพิมพ์ `staff_kind` เองในหน้า**
 *    (เช็คชื่อ · สกิล · กำลังคน · turnover · จัดกะ · ยืมคนข้ามไลน์)
 *    ไม่กรอง = ธุรการ/QA/เซลล์ โผล่ในลิสต์เช็คชื่อและถูกนับเป็นกำลังคนหน้าไลน์ **เงียบๆ**
 *    มีด่าน `src/utils/__tests__/staffKindGuard.test.mjs` สแกนไว้แล้ว
 *
 * ✅ **จอที่ "เลือกคน" ไม่ต้องกรอง** — ผู้แจ้งซ่อม · ผู้เข้าอบรม OJT · ผู้ถูกสังเกต BBS ·
 *    ผู้รับผิดชอบ action · คนขึ้นรถรับส่ง — คนสายสนับสนุนเป็นตัวเลือกที่ถูกต้องในบริบทพวกนี้
 *
 * 🔴 **จอ "ทะเบียน/แก้ข้อมูล" (`/operator`) ห้ามกรอง — ต้องเห็นทุกคน** ไม่งั้นเปิดแก้เขาไม่ได้
 *    (เกิดจริง 23/09) · ให้ผู้ใช้กรองเองด้วยชิป 🧑‍🏭 หน้างาน / 🗂️ สนับสนุน แทน
 */

export const STAFF_SHOPFLOOR = 'shopfloor';
export const STAFF_SUPPORT   = 'support';

/* ค่าเก่าก่อน 23/09 — ยังอ่านเจอได้จากแถวที่แท็บเก่าเขียนช่วง deploy (check constraint ยังรับอยู่)
   ⇒ ตัวอ่านทุกตัวในไฟล์นี้ต้องเข้าใจทั้ง 2 ชุดเสมอ ห้ามเทียบ === ค่าเดียว */
const LEGACY_SUPPORT = 'indirect';

/** ค่าที่ถือว่า "ไม่นับเป็นกำลังคนหน้างาน" — ใหม่ + เก่า */
export const SUPPORT_VALUES = [STAFF_SUPPORT, LEGACY_SUPPORT];

export const STAFF_KINDS = [
  { key: STAFF_SHOPFLOOR, label: '🧑‍🏭 หน้างาน / ช่าง', desc: 'เช็คชื่อ · มีสกิล · นับเป็นกำลังคน' },
  { key: STAFF_SUPPORT,   label: '🗂️ สายสนับสนุน',      desc: 'QA · วิศวกรรม · ธุรการ · สโตร์ — ไม่เช็คชื่อ ไม่นับกำลังคน' },
];

export const staffKindLabel = (k) =>
  (k === STAFF_SUPPORT || k === LEGACY_SUPPORT) ? STAFF_KINDS[1].label : STAFF_KINDS[0].label;

/** true = คนกลุ่มที่ต้องเช็คชื่อ/นับกำลังคน (ค่าว่าง/ไม่รู้จัก = นับเป็นหน้างาน ตาม default ของคอลัมน์) */
export const isShopfloorStaff = (emp) => !SUPPORT_VALUES.includes(emp?.staff_kind || STAFF_SHOPFLOOR);

/** กรองฝั่ง client — ใช้กับลิสต์ที่โหลดมาแล้ว */
export const shopfloorOnly = (rows = []) => rows.filter(isShopfloorStaff);

/**
 * กรองฝั่ง server — ต่อท้าย query builder ของ supabase-js
 *   `let q = supabase.from('employees').select(...); q = onlyShopfloorStaff(q)`
 * ใช้ `not in` (ไม่ใช่ `eq`) โดยตั้งใจ: แถวที่ค่าเพี้ยน/ค่าใหม่ในอนาคตยังถูกนับเป็นคนหน้างาน
 * ⇒ พลาดแล้ว "นับเกิน" (เห็นแล้วรู้) ดีกว่า "หายเงียบ" (ไม่มีใครรู้)
 */
export const onlyShopfloorStaff = (q) => q.not('staff_kind', 'in', `(${SUPPORT_VALUES.join(',')})`);

/* ── ชื่อเดิม (ก่อน 23/09) — คงไว้ให้โค้ดที่ยังไม่ได้ไล่แก้เรียกได้ ไม่ให้พังกลางทาง ──────
   ห้ามใช้ในโค้ดใหม่ · มีด่านเทสจับว่าจอที่นับคนต้องเรียกตัวใดตัวหนึ่งของไฟล์นี้ */
export const STAFF_DIRECT    = STAFF_SHOPFLOOR;
export const STAFF_INDIRECT  = STAFF_SUPPORT;
export const isDirectStaff   = isShopfloorStaff;
export const directOnly      = shopfloorOnly;
export const onlyDirectStaff = onlyShopfloorStaff;
