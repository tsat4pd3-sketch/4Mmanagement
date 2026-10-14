/* ══ 🪪 ตัวตนของบัญชี vs ฐานพนักงาน — ตัวเทียบกลาง (2026-10-08 · คำสั่ง user) ══════════════
 *
 * **ปัญหาที่แก้:** ค่าที่บอก "คนนี้เป็นใคร อยู่ไหน" ถูกเก็บ **2 ที่** (`profiles` + `employees`)
 * แล้วตอน login `App.jsx` ตัดสินด้วยสูตร **`emp.<field> ?? profile.<field>`** (ฐานพนักงานชนะเมื่อมีค่า)
 * ⇒ ค่าที่ค้างในบัญชีไม่ถูกใช้ แต่ยัง**แสดงบนจอ** = คนอ่านเข้าใจผิดว่าระบบใช้ค่านั้น
 *
 * เดิมแถบเตือนใน `/add-user` เทียบแค่ **team + line** ⇒ `section` / `position` / `org_node_id`
 * เพี้ยนเงียบ (วัดจริง 06/10: section 8 · position 8 · org_node 6 · team 1 · line 0 จาก 42 ใบที่ผูกแล้ว)
 *
 * 🔴 **กฎ: ช่องไหนที่มี 2 ที่ ต้องอยู่ใน `IDENTITY_FIELDS` ให้ครบ** — เพิ่มคอลัมน์ที่ซ้ำกันเมื่อไหร่
 *    ต้องเติมที่นี่ด้วย ไม่งั้นจอจะเงียบกับช่องนั้นตลอดไป (ไฟล์นี้ pure · มีเทส)
 * 🔴 **`syncPatch()` ต้องเขียนครบทุกช่องใน `IDENTITY_FIELDS`** — ปุ่ม "ใช้ค่าจากฐานพนักงาน" ที่
 *    เขียนไม่ครบ = กดแล้วแถบเตือนไม่หาย คนกดซ้ำไปเรื่อยๆ แล้วเลิกเชื่อปุ่ม
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

/* ══ 🔴 2 ชั้นที่ห้ามปนกัน (2026-10-13 · คำสั่ง user) ═══════════════════════════════
   > *"6 คนนี้ ตำแหน่งจริงที่เค้าเป็นอยู่กับบริษัทคือตามฐานพนักงาน
   >   แต่ตำแหน่งงานและงานที่ตัวเค้าทำ คือทำในตำแหน่งตรงกับบัญชี"*

   ⇒ `position` **ไม่ใช่ค่าเดียวกันที่ถูกเก็บ 2 ที่** — มันคือ **2 คำถามคนละข้อ** ที่บังเอิญชื่อคอลัมน์ซ้ำกัน:
     · `employees.position` = **ตำแหน่งตามบริษัท** (HR บรรจุ · ใช้จัดแถว Manpower Board · ใบรับรองทักษะ)
     · `profiles.position`  = **ตำแหน่งที่ปฏิบัติงานจริง** (ใช้ตัดสินสิทธิ์ · `positionRank()` · ช่องเซ็น MO)
   เคสจริง: สุวิทย์ชัย ดีทั่ว บริษัทบรรจุเป็นหัวหน้าไลน์ แต่**ทำงานในตำแหน่งหัวหน้าแผนก**
   ⇒ ที่ `App.jsx` ใช้ `profiles.position` ตัดสินสิทธิ์ **ถูกแล้ว** (สิทธิ์ต้องตามงานที่ทำ ไม่ใช่ตามที่บรรจุ)

   🔴 **ห้ามเอา 2 ชั้นนี้มารวมเป็น single source · ห้ามให้ปุ่มใดเขียนทับกัน**
      ทับเมื่อไหร่ = ข้อมูลหนึ่งใน 2 ความหมายหายถาวร (กู้ไม่ได้ ไม่มี audit ของ UPDATE)
   🔴 **ต่างกัน = เรื่องปกติ ห้ามนับเป็น "ข้อขัดแย้ง" ห้ามขึ้นแถบเตือน** — แสดงเป็น *ข้อมูล* ได้ (บอกว่าใครรักษาการ)
   ════════════════════════════════════════════════════════════════════════════════ */

/** ช่องที่ **ต้องตรงกัน** — ค่าเดียวกันแท้ๆ ที่ถูกเก็บ 2 ที่ ⇒ ต่างเมื่อไหร่ = ผิด
 *  ระบบใช้ **ฐานพนักงานชนะ** ทั้ง 3 ช่อง (`emp.<f> ?? profile.<f>` ใน `src/App.jsx` ~2310)
 *  🔴 เพิ่มช่องใหม่ที่นี่ได้เฉพาะช่องที่ "ค่าเดียวกันจริงๆ" — ช่องที่ 2 ฝั่งตอบคนละคำถาม
 *     ต้องไปอยู่ `DUAL_MEANING_FIELDS` ข้างล่าง */
export const IDENTITY_FIELDS = [
  { key: 'team',    label: 'ทีม' },
  { key: 'line_id', label: 'ไลน์' },
  { key: 'section', label: 'ส่วนงาน' },
];

/** 🔴 ช่องที่ **ชื่อซ้ำกันแต่คนละความหมาย** — ต่างกันได้โดยถูกต้อง ห้าม sync ห้ามเตือน */
export const DUAL_MEANING_FIELDS = [
  { key: 'position', label: 'ตำแหน่ง',
    empLabel: 'ตำแหน่งตามบริษัท', acctLabel: 'ตำแหน่งที่ปฏิบัติงาน',
    note: 'สิทธิ์ตัดสินจากตำแหน่งที่ปฏิบัติงาน (ไม่ใช่ที่บรรจุ)' },
  /* ⏸️ ยังไม่ตัดสินว่าเป็น "ช่องเดียวกัน" หรือ "คนละความหมาย" — รอ user เคาะ
     ระหว่างนี้กันไว้ฝั่งนี้ก่อน = ไม่เตือน ไม่ sync (ปลอดภัยกว่าทับแล้วกู้ไม่ได้) */
  { key: 'org_node_id', label: 'หน่วยในผัง',
    empLabel: 'หน่วยในฐานพนักงาน', acctLabel: 'หน่วยในบัญชี',
    note: 'ยังไม่ได้ตัดสินว่าฝั่งไหนเป็นตัวจริง — ยังไม่แตะ', undecided: true },
];

/** เทียบค่าแบบ "ว่างคือว่าง" — null / undefined / '' ถือว่าเท่ากัน (uuid/number แปลงเป็น string ก่อน) */
const same = (a, b) => String(a ?? '') === String(b ?? '');
const isBlank = (v) => v === null || v === undefined || String(v) === '';

/**
 * ช่องที่ "บัญชีกับฐานพนักงานไม่ตรงกัน และฐานพนักงานเป็นฝ่ายชนะ"
 * — คืนเฉพาะช่องที่ฐานพนักงาน **มีค่า** เพราะถ้าฝั่งนั้นว่าง ระบบจะตกไปใช้ค่าในบัญชี (ไม่ใช่ความขัดแย้ง
 *   แต่เป็นอีกอาการหนึ่ง — ดู `identityFallbacks`)
 * @returns {{key:string,label:string,acct:any,emp:any}[]}
 */
export function identityDiff(profile, employee) {
  if (!profile || !employee) return [];
  return IDENTITY_FIELDS
    .filter(f => !isBlank(employee[f.key]) && !same(profile[f.key], employee[f.key]))
    .map(f => ({ key: f.key, label: f.label, acct: profile[f.key], emp: employee[f.key] }));
}

/**
 * ช่องที่ "ฐานพนักงานเว้นว่าง แต่บัญชีมีค่า" ⇒ ระบบตกกลับไปใช้ค่าในบัญชี
 * คนละเรื่องกับ `identityDiff` — อันนั้นค่าในบัญชี**ไม่ถูกใช้** อันนี้**ถูกใช้** ทั้งที่ควรมาจากทะเบียน
 */
export function identityFallbacks(profile, employee) {
  if (!profile || !employee) return [];
  return IDENTITY_FIELDS
    .filter(f => isBlank(employee[f.key]) && !isBlank(profile[f.key]))
    .map(f => ({ key: f.key, label: f.label, acct: profile[f.key] }));
}

/**
 * ค่าที่จะเขียนลง `profiles` เพื่อให้ตรงกับฐานพนักงาน
 * 🔴 เขียน **ทุกช่องใน IDENTITY_FIELDS** รวมช่องที่ฐานพนักงานว่าง (เป็น null) —
 *    เขียนเฉพาะช่องที่ต่าง = ค่าขยะที่ค้างในบัญชีไม่เคยถูกล้าง แถบเตือนก็ไม่หาย
 */
export function syncPatch(employee) {
  if (!employee) return null;
  const patch = {};
  for (const f of IDENTITY_FIELDS) patch[f.key] = isBlank(employee[f.key]) ? null : employee[f.key];
  return patch;
}

/** มีอะไรให้เตือนไหม (ใช้ตัดสินว่าจะวาดแถบหรือไม่) */
export const hasIdentityIssue = (profile, employee) =>
  identityDiff(profile, employee).length > 0 || identityFallbacks(profile, employee).length > 0;

/**
 * ช่อง "คนละความหมาย" ที่ 2 ฝั่งมีค่าและไม่ตรงกัน — **ข้อมูล ไม่ใช่ข้อผิดพลาด**
 * ใช้บอกบนจอว่า "บรรจุเป็น X · ปฏิบัติงานเป็น Y" (เช่น คนรักษาการ) — ห้ามเอาไปทำปุ่มล้างค่า
 * @returns {{key,label,empLabel,acctLabel,note,undecided,acct,emp}[]}
 */
export function dualMeaningInfo(profile, employee) {
  if (!profile || !employee) return [];
  return DUAL_MEANING_FIELDS
    .filter(f => !isBlank(profile[f.key]) && !isBlank(employee[f.key])
                 && !same(profile[f.key], employee[f.key]))
    .map(f => ({ ...f, acct: profile[f.key], emp: employee[f.key] }));
}
