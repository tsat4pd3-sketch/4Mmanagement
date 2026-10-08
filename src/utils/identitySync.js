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

/** ช่องที่ถูกเก็บทั้งใน `profiles` และ `employees` — ชื่อคอลัมน์ตรงกันทั้ง 2 ฝั่ง */
export const IDENTITY_FIELDS = [
  { key: 'team',        label: 'ทีม' },
  { key: 'line_id',     label: 'ไลน์' },
  { key: 'section',     label: 'ส่วนงาน' },
  { key: 'position',    label: 'ตำแหน่ง' },
  { key: 'org_node_id', label: 'หน่วยในผัง' },
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
