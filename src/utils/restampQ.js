/* pure ของ `src/lib/restampSessionQ.js` — แยกไว้ให้เทสได้ (ไฟล์ lib แตะ DB) */
import { sumDefectQty } from './oee.js';

const pct2 = (v) => parseFloat((v * 100).toFixed(2));

/** คำนวณล้วน (pure) — แยกไว้ให้เทสได้ */
/** คิด { oee_q, oee } ใหม่ของกะที่ปิดแล้ว · null = ไม่ต้องเขียน */
export function restampQPatch(session, defects) {
  const produced = Number(session?.actual_qty) || 0;
  if (!(produced > 0)) return null;                       // กะไม่มีผลผลิต — ตอนปิดกะ stamp null ไว้ ห้ามแตะ
  const ng = sumDefectQty(defects || [], 'line');
  const Q = produced / (produced + ng);
  const oeeQ = pct2(Q);
  const a = session?.oee_a == null ? null : Number(session.oee_a);
  const p = session?.oee_p == null ? null : Number(session.oee_p);
  const oee = (a != null && p != null) ? parseFloat(((a / 100) * (p / 100) * Q * 100).toFixed(2)) : null;
  /* %Q เท่าเดิม = ไม่เขียน (oee ที่คิดจาก A/P ที่ปัดไว้แล้วอาจต่างจากของเดิมแค่เศษปัด — ห้ามแตะเลขที่ไม่ได้เปลี่ยนจริง) */
  if (session?.oee_q != null && Number(session.oee_q) === oeeQ) return null;
  return { oee_q: oeeQ, oee };
}

