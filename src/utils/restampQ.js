/* pure ของ `src/lib/restampSessionQ.js` — แยกไว้ให้เทสได้ (ไฟล์ lib แตะ DB) */
import { sumDefectQty, qTotalCount, qRatio } from './oee.js';

const pct2 = (v) => parseFloat((v * 100).toFixed(2));

/** คำนวณล้วน (pure) — แยกไว้ให้เทสได้ */
/** คิด { oee_q, oee } ใหม่ของกะที่ปิดแล้ว · null = ไม่ต้องเขียน */
export function restampQPatch(session, defects) {
  const produced = Number(session?.actual_qty) || 0;
  if (!(produced > 0)) return null;                       // กะไม่มีผลผลิต — ตอนปิดกะ stamp null ไว้ ห้ามแตะ
  const ng = sumDefectQty(defects || [], 'line');
  /* 🔴 %Q = งานดี ÷ **ยอดผลิต** ผ่านสูตรกลาง `qRatio` (oee.js §7.2.2) ห้ามคิดเองที่นี่ —
     ก่อน 25/11 ไฟล์นี้ถือสำเนาที่ 3 ของสูตร (`produced / (produced + ng)`) ⇒ ตอน QA ตัดสิน
     กะที่ปิดแล้วถูก restamp ด้วยสูตรที่ต่างจากตอนปิดกะ = ตัวเลขเดียวกันตอบ 2 ค่า
     ⚠️ `produced` = `actual_qty` = **ยอดสแกน** ⇒ ต้องแปลงเป็นยอดผลิตด้วย `qTotalCount` ก่อนหาร
        ไม่งั้นชิ้นที่ซ่อมเสร็จ/ของสงสัยที่ QA เคลียร์ ไม่มีทางกลับมาเป็นของดีของกะนี้ */
  const Q = qRatio(qTotalCount(produced, defects || []), ng);
  if (Q == null) return null;                             // ยอดผลิต 0 = ตอบไม่ได้ ห้าม stamp 0
  const oeeQ = pct2(Q);
  const a = session?.oee_a == null ? null : Number(session.oee_a);
  const p = session?.oee_p == null ? null : Number(session.oee_p);
  const oee = (a != null && p != null) ? parseFloat(((a / 100) * (p / 100) * Q * 100).toFixed(2)) : null;
  /* %Q เท่าเดิม = ไม่เขียน (oee ที่คิดจาก A/P ที่ปัดไว้แล้วอาจต่างจากของเดิมแค่เศษปัด — ห้ามแตะเลขที่ไม่ได้เปลี่ยนจริง) */
  if (session?.oee_q != null && Number(session.oee_q) === oeeQ) return null;
  return { oee_q: oeeQ, oee };
}

