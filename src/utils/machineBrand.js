/* ═══ ยี่ห้อเครื่องจักร (`machines.brand`) — แยกจากชื่อเครื่อง (pure · 2026-10-20 · คำสั่ง user) ═══
   เดิมยี่ห้อปนอยู่ใน `machine_name` ("ABB IRB6700", "MOTOMAN-ES165D") และในชื่อชนิดอุปกรณ์ของใบ MO
   ("Robot Handling [ ABB ]") ⇒ ยี่ห้อ = คุณสมบัติของ **เครื่อง** (MC No.) ไม่ใช่ของชื่อชนิด

   🔴 กฎ:
     · เป็น "ข้อเสนอ" ให้คนตรวจก่อนบันทึกเสมอ (จอ "แยกยี่ห้อจากชื่อ" ใน /equipment?tab=machine) — ห้ามเขียนเองเงียบๆ
     · พจนานุกรมมาจากคำขึ้นต้นชื่อเครื่องในทะเบียนจริง (วัด 20/10) — **ห้ามเดาจากชื่อรุ่น/ทับศัพท์**
       (TRULASER / ATLAS / STANLY = ไม่จับ ให้คนกรอกเอง) · ชื่อสายผลิตภัณฑ์ที่เป็นของยี่ห้อชัด (MOTOMAN = Yaskawa) เท่านั้น
     · ยี่ห้อที่เคยบันทึกในทะเบียนแล้ว (`known`) ใช้ต่อได้ — พจนานุกรมโตตามข้อมูล ไม่ต้องแก้โค้ด
     · จับไม่ได้ = null (ไม่ใช่ '' และไม่ใช่ "อื่นๆ")
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/** ยี่ห้อ → คำขึ้นต้นชื่อที่ชี้ยี่ห้อนั้น (ตัวพิมพ์ใหญ่) */
export const BRAND_ALIASES = {
  ABB: ['ABB'],
  YASKAWA: ['YASKAWA', 'MOTOMAN'],
  PANASONIC: ['PANASONIC'],
  DENYO: ['DENYO'],
  DENGENSHA: ['DENGENSHA'],
  SIMPAC: ['SIMPAC'],
  SEYI: ['SEYI'],
  SCHULER: ['SCHULER'],
  KEYENCE: ['KEYENCE'],
  BLM: ['BLM'],
  COMCO: ['COMCO'],
  KAWATA: ['KAWATA'],
  DEMAG: ['DEMAG'],
  CLARKE: ['CLARKE'],
  STANLEY: ['STANLEY'],
  ONAN: ['ONAN'],
  SOOBO: ['SOOBO'],
};

/** ทำให้ยี่ห้อเป็นรูปเดียว — ตัดช่องว่างหัวท้าย/ซ้อน + ตัวพิมพ์ใหญ่ · ว่าง = null */
export function normalizeBrand(v) {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return s || null;
}

/** คำขึ้นต้นของชื่อเครื่อง (ตัดที่ช่องว่าง/ขีด/วงเล็บ) */
const firstToken = (name) => String(name ?? '').trim().toUpperCase().split(/[\s\-_/()[\]]+/).filter(Boolean)[0] || '';

/**
 * เสนอยี่ห้อจากชื่อเครื่อง
 * @param name   machines.machine_name
 * @param known  ยี่ห้อที่บันทึกในทะเบียนแล้ว (array) — คำขึ้นต้นที่ตรงยี่ห้อเหล่านี้จับได้ด้วย
 * @returns ยี่ห้อ (ตัวพิมพ์ใหญ่) | null
 */
export function suggestBrand(name, known = []) {
  const tok = firstToken(name);
  if (!tok) return null;
  for (const [brand, aliases] of Object.entries(BRAND_ALIASES)) if (aliases.includes(tok)) return brand;
  const k = (known || []).map(normalizeBrand).filter(Boolean);
  return k.includes(tok) ? tok : null;
}

/** แถวที่ควรเสนอให้ตรวจ — ยังไม่มียี่ห้อ และเดาได้ */
export function brandProposals(machines = [], known = []) {
  return (machines || [])
    .filter(m => m && !normalizeBrand(m.brand))
    .map(m => ({ m, brand: suggestBrand(m.machine_name, known) }))
    .filter(x => x.brand);
}
