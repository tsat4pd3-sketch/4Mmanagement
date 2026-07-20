// ─── Multi-section scoping ──────────────────────────────────────────────────
// ขอบเขตส่วนงานของ user: profiles.sections (text[]) = จำกัดหลายส่วนงานได้
// (เช่น manager แผนกหนึ่งเห็นเฉพาะ PD1+PD2+QA) — ว่าง/NULL = ไม่จำกัด
//
// ลำดับการตีความ (effectiveSections):
//   1. admin → ไม่จำกัดเสมอ
//   2. role คุณภาพทั้งโรงงาน (qa) → ไม่จำกัดเสมอ — QA เป็นผู้อนุมัติ 4M step QA / งานคุณภาพ
//      ข้ามสายผลิตทั้งโรงงาน และ section ของ QA เอง ("QA") ไม่ใช่สายผลิต ถ้า scope ตาม
//      section จะกรองข้อมูลผลิตออกหมด (เห็น 4M/รายงาน = 0) — bug ที่เคยเจอ 2026-07-16
//   3. profiles.sections มีค่า → ใช้ array นั้น (ทุก role ที่เหลือ)
//   4. supervisor ที่มี profiles.section เดี่ยว → [section] (พฤติกรรมเดิม ห้ามเปลี่ยน)
//   5. role อื่นที่มีแค่ section เดี่ยว → ไม่จำกัด (เหมือนเดิม — กัน manager เก่าที่เคยกรอก
//      section ไว้เฉยๆ ไม่ให้โดนจำกัดขึ้นมากะทันหันหลัง deploy)
//
// เทียบค่าแบบ normalize (trim + lowercase) เหมือน normSection ที่ใช้กันใน DailyReport/Report
// เพราะ section เป็น text ที่พิมพ์มือได้ เคส/ช่องว่างเพี้ยนกันได้

const norm = (s) => (s || '').toString().trim().toLowerCase();

/** role คุณภาพทั้งโรงงานที่ไม่ผูกกับสายผลิตใด — ไม่ถูกจำกัดตาม section */
const FACTORY_WIDE_ROLES = ['qa'];

/** คืน array ส่วนงานที่ user ถูกจำกัด — [] = ไม่จำกัด เห็นทุกส่วนงาน */
export function effectiveSections(role, sections, section) {
  if (!role || role === 'admin') return [];
  if (FACTORY_WIDE_ROLES.includes(role)) return [];
  const arr = Array.isArray(sections) ? sections.filter(Boolean) : [];
  if (arr.length) return arr;
  if (role === 'supervisor' && section) return [section];
  return [];
}

/** เช็คว่าค่า section หนึ่งอยู่ในขอบเขตไหม — scope ว่าง = ผ่านเสมอ */
export function inSectionScope(scopeSections, value) {
  if (!scopeSections || !scopeSections.length) return true;
  const v = norm(value);
  return scopeSections.some(s => norm(s) === v);
}
