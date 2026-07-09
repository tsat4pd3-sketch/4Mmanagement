// ─── Multi-section scoping ──────────────────────────────────────────────────
// ขอบเขตส่วนงานของ user: profiles.sections (text[]) = จำกัดหลายส่วนงานได้
// (เช่น manager แผนกหนึ่งเห็นเฉพาะ PD1+PD2+QA) — ว่าง/NULL = ไม่จำกัด
//
// ลำดับการตีความ (effectiveSections):
//   1. admin → ไม่จำกัดเสมอ
//   2. profiles.sections มีค่า → ใช้ array นั้น (ทุก role)
//   3. supervisor ที่มี profiles.section เดี่ยว → [section] (พฤติกรรมเดิม ห้ามเปลี่ยน)
//   4. role อื่นที่มีแค่ section เดี่ยว → ไม่จำกัด (เหมือนเดิม — กัน manager เก่าที่เคยกรอก
//      section ไว้เฉยๆ ไม่ให้โดนจำกัดขึ้นมากะทันหันหลัง deploy)
//
// เทียบค่าแบบ normalize (trim + lowercase) เหมือน normSection ที่ใช้กันใน DailyReport/Report
// เพราะ section เป็น text ที่พิมพ์มือได้ เคส/ช่องว่างเพี้ยนกันได้

const norm = (s) => (s || '').toString().trim().toLowerCase();

/** คืน array ส่วนงานที่ user ถูกจำกัด — [] = ไม่จำกัด เห็นทุกส่วนงาน */
export function effectiveSections(role, sections, section) {
  if (!role || role === 'admin') return [];
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
