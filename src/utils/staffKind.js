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
 * ── ⭐ 3 กลุ่ม + **2 แกน** (2026-10-14 · คำสั่ง user) ────────────────────────────────
 * *"ช่าง วิศวกร ธุรการ หัวหน้าแผนก … มาขึ้นปนกับพนักงานหน้างานหมด อยากให้แยกออกจากกัน
 *   ถ้าส่วนสนับสนุนอยากใช้ระบบเช็คชื่อ อยากให้แยกออกมา"*
 *
 * 🔴 **"เช็คชื่อไหม" กับ "นับเป็นกำลังคนของไลน์ผลิตไหม" เป็นคนละคำถาม — ห้ามใช้ฟังก์ชันเดียวตอบทั้งคู่**
 *    (เดิมเป็นตัวเดียวกัน ⇒ จะให้สายสนับสนุนเช็คชื่อได้ ก็ต้องยอมให้ถูกนับเป็นกำลังคนไปด้วย)
 *
 * | กลุ่ม | ใคร | เช็คชื่อ | นับกำลังคนไลน์ผลิต |
 * |---|---|---|---|
 * | `shopfloor`  | operator · line_leader | ✅ | ✅ |
 * | `technician` | ช่างซ่อมบำรุง          | ✅ | ❌ (ช่างประจำไลน์อยู่ที่ `line_technicians`) |
 * | `support`    | ธุรการ · วิศวกร · หัวหน้าแผนก | ✅ | ❌ |
 *
 * 🔴 **กฎเหล็ก: จอที่ "นับกำลังคนไลน์ผลิต" ต้องกรองผ่านไฟล์นี้เท่านั้น ห้ามพิมพ์ `staff_kind` เองในหน้า**
 *    (สกิล · กำลังคน · turnover · OEE manpower) — `isShopfloorStaff()` / `onlyShopfloorStaff()`
 *    ไม่กรอง = ธุรการ/ช่าง ถูกนับเป็นกำลังคนหน้าไลน์ **เงียบๆ**
 *    มีด่าน `src/utils/__tests__/staffKindGuard.test.mjs` สแกนไว้แล้ว
 *
 * 🔴 **จอ "เช็คชื่อ / จัดกะ" ห้ามกรองใครออก — ต้องแสดงครบแล้ว *แยกกลุ่มให้เห็น*** (`staffGroupOf()`)
 *    กรองทิ้ง = คนเช็คชื่อไม่ได้ / ไม่มีกะ ซึ่งเป็นความเสียหายที่หนักกว่า "โผล่มาแล้วดูรก" มาก
 *
 * ✅ **จอที่ "เลือกคน" ไม่ต้องกรอง** — ผู้แจ้งซ่อม · ผู้เข้าอบรม OJT · ผู้ถูกสังเกต BBS ·
 *    ผู้รับผิดชอบ action · คนขึ้นรถรับส่ง — คนสายสนับสนุนเป็นตัวเลือกที่ถูกต้องในบริบทพวกนี้
 *
 * 🔴 **จอ "ทะเบียน/แก้ข้อมูล" (`/operator`) ห้ามกรอง — ต้องเห็นทุกคน** ไม่งั้นเปิดแก้เขาไม่ได้
 *    (เกิดจริง 23/09) · ให้ผู้ใช้กรองเองด้วยชิป 🧑‍🏭 หน้างาน / 🗂️ สนับสนุน แทน
 */

export const STAFF_SHOPFLOOR  = 'shopfloor';
export const STAFF_TECHNICIAN = 'technician';   // 🔧 เพิ่ม 14/10 — ช่าง: เช็คชื่อได้ แต่ไม่ใช่กำลังคนไลน์
export const STAFF_SUPPORT    = 'support';

/* ค่าเก่าก่อน 23/09 — ยังอ่านเจอได้จากแถวที่แท็บเก่าเขียนช่วง deploy (check constraint ยังรับอยู่)
   ⇒ ตัวอ่านทุกตัวในไฟล์นี้ต้องเข้าใจทั้ง 2 ชุดเสมอ ห้ามเทียบ === ค่าเดียว */
const LEGACY_SUPPORT = 'indirect';

/** ค่าที่ถือว่า "สายสนับสนุน" — ใหม่ + เก่า (ด่านเทสอ้างชื่อนี้ ห้ามเปลี่ยน) */
export const SUPPORT_VALUES = [STAFF_SUPPORT, LEGACY_SUPPORT];

/** 🔴 ค่าที่ **ไม่นับเป็นกำลังคนของไลน์ผลิต** = สายสนับสนุน + ช่าง */
export const NON_LINE_VALUES = [STAFF_TECHNICIAN, ...SUPPORT_VALUES];

export const STAFF_KINDS = [
  { key: STAFF_SHOPFLOOR,  label: '🧑‍🏭 หน้างาน',      desc: 'เช็คชื่อ · มีสกิล · นับเป็นกำลังคนของไลน์ผลิต' },
  { key: STAFF_TECHNICIAN, label: '🔧 ช่าง',           desc: 'เช็คชื่อ — แต่ไม่นับเป็นกำลังคนของไลน์ผลิต (ช่างประจำไลน์ดูที่ line_technicians)' },
  { key: STAFF_SUPPORT,    label: '🗂️ สายสนับสนุน',    desc: 'QA · วิศวกรรม · ธุรการ · สโตร์ — เช็คชื่อได้ แต่ไม่นับกำลังคน' },
];

/** กลุ่มของคนหนึ่งคน (normalize ค่าเก่า/ค่าว่างแล้ว) — ใช้ "จัดกลุ่ม" บนจอเช็คชื่อ/จัดกะ */
export function staffGroupOf(emp) {
  const v = emp?.staff_kind;
  if (v === STAFF_TECHNICIAN) return STAFF_TECHNICIAN;
  if (SUPPORT_VALUES.includes(v)) return STAFF_SUPPORT;
  return STAFF_SHOPFLOOR;   // ว่าง/ไม่รู้จัก = หน้างาน (ตาม default ของคอลัมน์)
}

export const staffKindLabel = (k) =>
  (STAFF_KINDS.find(x => x.key === staffGroupOf({ staff_kind: k })) || STAFF_KINDS[0]).label;

/**
 * 🧮 **แกนที่ 1 — "นับเป็นกำลังคนของไลน์ผลิตไหม"** (สกิล · กำลังคน · turnover · OEE manpower)
 * ค่าว่าง/ไม่รู้จัก = นับเป็นหน้างาน (ตาม default ของคอลัมน์ · fail-open)
 */
export const isShopfloorStaff = (emp) => !NON_LINE_VALUES.includes(emp?.staff_kind || STAFF_SHOPFLOOR);

/**
 * 🪪 **แกนที่ 2 — "ต้องเช็คชื่อ/มีกะไหม"** — **ทุกกลุ่มตอบใช่**
 * มีไว้ให้จอเขียนเจตนาได้ชัด (และถ้าวันหน้ามีกลุ่มที่ไม่เช็คชื่อ จะแก้ที่นี่ที่เดียว)
 * 🔴 จอเช็คชื่อ/จัดกะ **ห้ามใช้ `isShopfloorStaff` มากรอง** — ใช้ตัวนี้ + `staffGroupOf()` จัดกลุ่มแทน
 */
export const checksInStaff = () => true;

/** กรองฝั่ง client — ใช้กับลิสต์ที่โหลดมาแล้ว (แกน "นับกำลังคน") */
export const shopfloorOnly = (rows = []) => (Array.isArray(rows) ? rows : []).filter(isShopfloorStaff);

/**
 * แบ่งลิสต์เป็น 3 กลุ่มตามลำดับที่จอควรแสดง — สำหรับจอเช็คชื่อ/จัดกะ
 * @returns {{ key, label, desc, rows }[]} · **คืนครบ 3 กลุ่มเสมอ** (กลุ่มว่างก็คืน — จอจะได้เลือกเองว่าจะซ่อนหัวข้อไหม)
 */
export function groupByStaffKind(rows) {
  const by = { [STAFF_SHOPFLOOR]: [], [STAFF_TECHNICIAN]: [], [STAFF_SUPPORT]: [] };
  for (const r of (Array.isArray(rows) ? rows : [])) by[staffGroupOf(r)].push(r);
  return STAFF_KINDS.map(k => ({ ...k, rows: by[k.key] }));
}

/**
 * กรองฝั่ง server — ต่อท้าย query builder ของ supabase-js
 *   `let q = supabase.from('employees').select(...); q = onlyShopfloorStaff(q)`
 * ใช้ `not in` (ไม่ใช่ `eq`) โดยตั้งใจ: แถวที่ค่าเพี้ยน/ค่าใหม่ในอนาคตยังถูกนับเป็นคนหน้างาน
 * ⇒ พลาดแล้ว "นับเกิน" (เห็นแล้วรู้) ดีกว่า "หายเงียบ" (ไม่มีใครรู้)
 *
 * 🔴 **ต้องตัดชุดเดียวกับ `isShopfloorStaff()` เป๊ะ (`NON_LINE_VALUES`)** — แก้ 19/10
 * เดิมตัดแค่ `SUPPORT_VALUES` ⇒ ตอนเพิ่มกลุ่ม `technician` (14/10) ฝั่ง client ตัดช่างออกแล้ว
 * แต่ฝั่ง server ยังปล่อยผ่าน ⇒ **ชื่อฟังก์ชันเดียวกันให้คำตอบคนละอย่างกับช่าง 22 คน**
 * (จอนับกำลังคน/สกิล/turnover ยังนับช่างเป็นคนหน้าไลน์เงียบๆ ทั้งที่คอมเมนต์ในจอบอกว่าตัดแล้ว)
 * ⚠️ จอที่ **ตั้งใจ** จะเห็นช่าง (เช่นแถว 🔧 ช่าง ของ `/manpower-board`) ใช้ `withoutSupportStaff()`
 */
export const onlyShopfloorStaff = (q) => q.not('staff_kind', 'in', `(${NON_LINE_VALUES.join(',')})`);

/**
 * กรองฝั่ง server แบบ "ตัดเฉพาะสายสนับสนุน" — **ช่างยังอยู่**
 * สำหรับจอที่วาด**แถวช่างแยกต่างหาก** และไม่ได้เอาช่างไปรวมเป็นกำลังคนของไลน์
 * (วันนี้มีที่เดียว: `/manpower-board` — `staffingOfDept()` นับแค่คอลัมน์ทีม ไม่นับแถวช่าง)
 * 🔴 **ห้ามใช้แทน `onlyShopfloorStaff` ในจอที่นับกำลังคน** — มีด่าน `staffKindGuard.test.mjs`
 */
export const withoutSupportStaff = (q) => q.not('staff_kind', 'in', `(${SUPPORT_VALUES.join(',')})`);

/* ── ชื่อเดิม (ก่อน 23/09) — คงไว้ให้โค้ดที่ยังไม่ได้ไล่แก้เรียกได้ ไม่ให้พังกลางทาง ──────
   ห้ามใช้ในโค้ดใหม่ · มีด่านเทสจับว่าจอที่นับคนต้องเรียกตัวใดตัวหนึ่งของไฟล์นี้ */
export const STAFF_DIRECT    = STAFF_SHOPFLOOR;
export const STAFF_INDIRECT  = STAFF_SUPPORT;
export const isDirectStaff   = isShopfloorStaff;
export const directOnly      = shopfloorOnly;
export const onlyDirectStaff = onlyShopfloorStaff;
