/* ══ 🗒️ ใบสแกนประจำไลน์ (A4) — เฟส 2 "ทุกอย่างที่ต้องเลือก สแกนได้" (2026-10-28 · คำสั่ง user: A4 · แผ่นแยกตามไลน์) ══
   แผ่นติดข้างไลน์: QR ของไลน์ + QR ประเภท Downtime + QR ประเภทงานเสีย ของไลน์นั้น
   ⇒ หน้างานยิงเหตุผลจากแผ่นแทนการไล่หาในลิสต์ยาว (Daily Report รับ ESM:T / ESM:X ผ่านปุ่ม 📷 ของช่องนั้น)

   🔴 กติกา "ประเภทไหนเป็นของไลน์นี้" = กติกาเดียวกับ dropdown ใน Daily Report (`sessionProcessTypesAll` + `ofLine`)
      — process_type ของเครื่องในครอบครัวไลน์ (แม่+ลูก) · ประเภทที่ไม่ผูก process / 'common' = ทุกไลน์
      แผ่นนี้ "เลือกให้ก่อน" เท่านั้น คนพิมพ์ติ๊กเพิ่ม/เอาออกเองได้ (ประเภทกระบวนการอื่นยังเลือกได้เหมือนใน dropdown)
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import { processUnionRows } from './machineAssets.js';

const low = (s) => String(s ?? '').trim().toLowerCase();

/** process_type ของไลน์ = ของเครื่องที่อยู่ในครอบครัวไลน์ (แม่+ลูก) */
export function lineProcessTypes(machines, familyNames) {
  const fam = new Set((familyNames || []).map(low));
  const set = new Set();
  processUnionRows((machines || []).filter(m => m.process_type && fam.has(low(m.line_name)))).forEach(m => set.add(m.process_type));
  return set;
}

/** ประเภทนี้ "เป็นของไลน์นี้" ไหม — ตรงกับ `ofLine` ใน Daily Report */
export const typeFitsLine = (t, pts) => !t.process_type || t.process_type === 'common' || pts.has(t.process_type);

/** ชุดที่ติ๊กไว้ก่อนเมื่อเลือกไลน์ = ประเภทที่ใช้งานอยู่และเป็นของไลน์นี้ */
export function defaultSheetPicks(types, pts) {
  return new Set((types || []).filter(t => t.is_active !== false && typeFitsLine(t, pts)).map(t => String(t.id)));
}
