/**
 * repairWi — จับคู่ "อาการ/พาร์ทนี้ ซ่อมตาม WI เล่มไหน" จากทะเบียน `repair_wi_registry` (DR)
 * ที่มา: WI-PD3-069 Rev.02 §6 (2026-09-25)
 * pure ทั้งไฟล์ — ไม่แตะ DB/DOM (มีเทส src/utils/__tests__/repairWi.test.mjs)
 *
 * WI สั่งว่า "ของที่ซ่อมได้ ต้องซ่อมตาม WI เล่มที่กำหนด" แต่ลิสต์นั้นอยู่บนกระดาษอย่างเดียว
 * ⇒ หัวหน้ากลุ่มที่กำลังพิมพ์วิธีแก้ไข ไม่มีทางรู้ว่าอาการนี้มี WI ซ่อมทางการอยู่แล้ว
 *
 * 🔴 กติกาการจับคู่ (ตามกฎ "อื่นๆ ห้ามขึ้นอันดับ 1" ข้อ 4-5 — คีย์ก่อน คำทีหลัง และต้องบอกว่าเดา):
 *   1. **เลขพาร์ท/QRs — ต้องตรงเป๊ะ** (normalize ตัดช่องว่าง/ขีด + ตัวพิมพ์ใหญ่) ⇒ ป้าย "ตรงเลขพาร์ท"
 *   2. **คำอาการ — ใช้คำจากทะเบียนเอง ไม่ใช่พจนานุกรมที่เขียนมือ** (ห้ามเดา taxonomy)
 *      และต้องยาว ≥ 4 ตัวอักษร กันคำสั้นไปชนคำอื่น (บทเรียน keyword 'รู' ชน 'เสียรูป')
 *      ⇒ ป้าย "ตรงคำอาการ" — คนเห็นเองว่าเป็นการเดา ไม่ใช่ข้อเท็จจริง
 *   3. จับคู่ไม่ได้ = ไม่โชว์ชิป **ห้ามโชว์ WI มั่วๆ** (แนะนำผิดเล่ม อันตรายกว่าไม่แนะนำ)
 */
const normCode = v => String(v || '').toUpperCase().replace(/[\s-]/g, '');
const MIN_SYMPTOM_WORD = 4;

/** หา WI ที่เข้าเกณฑ์สำหรับรายการนี้ — pure (เทสได้) */
export function matchRepairWi(regRows = [], { codes = [], text = '' } = {}) {
  const codeSet = new Set(codes.map(normCode).filter(Boolean));
  const t = String(text || '').toLowerCase();
  const out = [];
  for (const r of regRows) {
    if (r.is_active === false) continue;
    if (codeSet.has(normCode(r.code))) { out.push({ ...r, why: 'code' }); continue; }
    const sym = String(r.symptom || '').toLowerCase().trim();
    if (sym.length >= MIN_SYMPTOM_WORD && t.includes(sym)) out.push({ ...r, why: 'symptom' });
  }
  // ตรงเลขพาร์ทตรงเป้ากว่า → ขึ้นก่อนเสมอ
  return out.sort((a, b) => (a.why === 'code' ? 0 : 1) - (b.why === 'code' ? 0 : 1)).slice(0, 4);
}

