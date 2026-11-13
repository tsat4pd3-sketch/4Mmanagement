/* ═══════════════════════════════════════════════════════════════════════════════════════
   ✍️ ลายเซ็น "ต้องเป็นของเจ้าตัว" — ของกลางทุกฟอร์ม (2026-11-13 · คำสั่ง user)
   > "เพิ่มปุ่มให้เจ้าตัวมากดเซ็น" (อุดความเสี่ยง: เลือกชื่อคนแล้วระบบดึงรูปลายเซ็นของคนนั้นมาแปะ)

   กฎ: เลือก "ชื่อ" ใครก็ได้ (ช่องระบุตัวคนยังจำเป็น) แต่ **รูปลายเซ็น + uid ติดได้เฉพาะเมื่อชื่อนั้นคือคนที่ login อยู่**
       ชื่อเป็นคนอื่น = ช่องลายเซ็นว่าง ("รอเจ้าตัวเซ็น") จนกว่าเจ้าตัว login มากดปุ่มเซ็นเอง
   🔴 ห้ามก๊อป `signature_url` ของคนที่เลือกจาก picker มาแปะอีก — ใช้ `pickSignerPatch()` ตัวนี้ (มีด่าน)
   🔴 ไม่รู้ชื่อผู้ login (`fullName` ว่าง) = ถือว่าไม่ใช่เจ้าตัว (fail-closed — ไม่แปะลายเซ็น)
   ต้นแบบ "เซ็นเอง" ที่มีอยู่ก่อน: `OjtTraining.jsx` SELF_SIGN (02/11 · 05/11)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

export const normPersonName = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** ชื่อในช่องนี้คือคนที่ login อยู่ไหม */
export function isSelfName(name, fullName) {
  const a = normPersonName(name);
  const b = normPersonName(fullName);
  return !!a && !!b && a === b;
}

/**
 * ค่าที่จะเขียนลงช่องผู้เซ็น เมื่อคนกรอก "เลือกชื่อ" ในช่องนั้น
 * @param {string} pickedName ชื่อที่เลือก
 * @param {{ fullName?: string, uid?: string|null, mySig?: string|null }} me ผู้ login
 * @returns {{ name: string|null, uid: string|null, sig: string|null, self: boolean }}
 */
export function pickSignerPatch(pickedName, { fullName = '', uid = null, mySig = null } = {}) {
  const name = String(pickedName ?? '').trim() || null;
  const self = isSelfName(name, fullName);
  return { name, uid: self ? (uid || null) : null, sig: self ? (mySig || null) : null, self };
}

/** สถานะช่องลายเซ็นบนจอ — 'signed' | 'waiting' (มีชื่อแต่ยังไม่เซ็น) | 'empty' */
export function signSlotState({ name, sig, uid } = {}) {
  if (sig || uid) return 'signed';
  return String(name ?? '').trim() ? 'waiting' : 'empty';
}
