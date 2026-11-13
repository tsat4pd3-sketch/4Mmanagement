/* ══ 🔍 "ตัวเลขกะนี้เชื่อได้ไหม" — ด่านจับข้อมูลที่ลงแล้วทำให้ OEE โกหก ══  2026-11-13
   คำสั่ง user: *"ถ้านานจริง ผลิตก็ต้องรับผิดชอบ ว่าเกิดจากอะไร ต้องมีคำตอบ เพราะลงแบบนี้
   A ตก P อาจจะ over และเราคิดแคพ 100% เป็น poka-yoke ดัก OEE เกิน 100% ไว้ก็จะมีผล"*

   ── ที่มา (วัดจริง ต.ค. 2026) ─────────────────────────────────────────────────
   ไล่ใบ downtime ที่ "ซ่อมเสร็จแล้วแต่ใบปิดช้า" 6 ใบที่ช้าสุด → **ทั้ง 6 ใบปิดตรงเวลาเลิกกะเป๊ะ**
   (BD-08 ซ่อมเสร็จ 02:25 ปิดใบ 04:00 · LS-06 16:04 → 17:10 · LS-10 00:45 → 01:40 ฯลฯ)
   ⇒ ไม่ใช่ "คืนไลน์นาน" แต่เป็น **ลงดาวไทม์แล้วไม่ปิดตอนไลน์เดินจริง ปล่อยค้างจนจบกะ**
   และฝั่งตัวเลข: **P แตะเพดาน 100% ใน 194 จาก 783 กะ (24.8%)** — โค้ด `computeLiveOee`
   ติดธง `pOver` ไว้แล้วแต่โชว์ที่แถบ OEE สดที่เดียว ⇒ **คนปิดกะไม่เคยเห็น**

   ── 🔴 กฎของไฟล์นี้ ───────────────────────────────────────────────────────────
   1. **เตือน ไม่บล็อก** (คำสั่ง user 13/11) — ของจริงมีเคสที่ลงแบบนี้ถูกต้อง
      (ลง "ไม่มีแผนผลิต" ถึงเลิกงาน = ถูกแล้ว · ไลน์ที่หยุดยาวจริงก็มี) ⇒ ห้ามยกเป็นด่านห้ามบันทึก
   2. **ต้องบอก "ผลที่ตามมา" ไม่ใช่แค่ว่าผิด** — คนหน้างานจะแก้ได้ต้องรู้ว่าลงแบบนี้แล้ว %A/%P เป็นอะไร
   3. **ไม่รู้ = ไม่เตือน** (`null`) ห้ามเดา — ไม่รู้กรอบกะ/ไม่รู้นโยบายพัก = เงียบ ดีกว่าเตือนผิด
      แล้วคนเลิกเชื่อคำเตือนทั้งระบบ
   4. **เวลาพักไม่นับเป็น "เวลาที่ต้องตอบ"** — ช่วงที่ค่อมเบรคถูกกันออกจากฐาน %A อยู่แล้ว
      (`dtMinOutsideBreaks` ใน `oee.js`) ⇒ ถามเฉพาะนาทีที่กระทบจริง ไม่งั้นเป็นการกล่าวหาเกินจริง
      วัดจริง: BD-08 ช่วงท้าย 94 นาที — ค่อมเบรค 50 ⇒ ที่ต้องตอบจริงมีแค่ 44 นาที
   5. **ไฟล์นี้ไม่คำนวณ OEE เอง** — รับผลจาก `computeLiveOee` มาแปลเป็นคำเตือนเท่านั้น
      (OEE มีสูตรที่เดียวใน `oee.js` — ห้ามมี 2 ชุด)                                     */

/** ความคลาดที่ยังถือว่า "ตรงเวลาเลิกกะ" — คนกรอกเวลาเป็นนาที ไม่ใช่วินาที */
export const SHIFT_END_TOL_MIN = 2;
/** ใบที่สั้นกว่านี้ไม่ต้องถาม — เศษเวลาท้ายกะเป็นเรื่องปกติ (เกณฑ์เดียวกับใบรายงานปัญหา 30 นาที) */
export const DT_ASK_MIN = 30;

/* 🔴 `null`/`undefined`/`''` ต้องคืน `null` ไม่ใช่ 0 — `Number(null)` = 0 ซึ่งผ่าน isFinite
   ⇒ เขียนลวกๆ แล้วด่าน "ไม่รู้ = เงียบ" พังทั้งไฟล์ (เตือนทุกใบด้วยเวลา 1970) */
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * ใบ downtime นี้ "ปิดตรงเวลาเลิกกะ" แบบที่ควรถามไหม
 *
 * @param {object} p
 * @param {number|null} p.endedMs      เวลาปิดใบที่กำลังจะบันทึก (ms)
 * @param {number|null} p.startedMs    เวลาเริ่มหยุด (ms)
 * @param {number|null} p.shiftEndMs   เวลาเลิกกะจริงของกะนี้ (`shiftWindow().endMs` เมื่อ `hardEnd`)
 * @param {boolean}     p.planned      ประเภทในแผนไหม — ในแผนไม่ถาม (ลง "ไม่มีแผนผลิต" ถึงเลิกงานถูกแล้ว)
 * @param {Array<[number,number]>} [p.breakIntervals] ช่วงพักจาก `breakIntervalsIn()` — ไม่ส่ง = ไม่หักพัก
 * @param {number|null} [p.repairDoneMs] เวลาช่างกดซ่อมเสร็จ (ถ้ารู้) — ทำให้คำถามคมขึ้น
 * @returns {null|{ atShiftEnd:boolean, totalMin:number, breakMin:number, answerMin:number,
 *                  sinceRepairMin:number|null, text:string }}
 *   `null` = ไม่เข้าเกณฑ์/ไม่รู้พอ ⇒ **ไม่เตือน**
 */
export function checkDtClosedAtShiftEnd({
  endedMs, startedMs, shiftEndMs, planned = false,
  breakIntervals = null, repairDoneMs = null,
}) {
  const e = num(endedMs), s = num(startedMs), se = num(shiftEndMs);
  if (e == null || s == null || se == null) return null;   // ไม่รู้กรอบกะ = เงียบ (กฎข้อ 3)
  if (planned) return null;                                 // ในแผน = ไม่ใช่เรื่องนี้
  const totalMin = Math.round((e - s) / 60000);
  if (!(totalMin >= DT_ASK_MIN)) return null;
  const atShiftEnd = Math.abs(e - se) / 60000 <= SHIFT_END_TOL_MIN;
  if (!atShiftEnd) return null;

  /* ช่วงที่ "ต้องตอบ" = ตั้งแต่ซ่อมเสร็จ (ถ้ารู้) ถึงปิดใบ · ไม่รู้ = ใช้ทั้งใบ
     แล้วหักเวลาพักออก เพราะพักถูกกันออกจากฐาน %A อยู่แล้ว (กฎข้อ 4) */
  const rd = num(repairDoneMs);
  const from = rd != null && rd > s && rd < e ? rd : s;
  const spanMin = Math.round((e - from) / 60000);
  const breakMin = breakIntervals
    ? Math.round(breakIntervals.reduce((acc, iv) => {
        const a = num(iv?.[0]), b = num(iv?.[1]);
        if (a == null || b == null) return acc;
        return acc + Math.max(0, Math.min(e, b) - Math.max(from, a));
      }, 0) / 60000)
    : 0;
  const answerMin = Math.max(0, spanMin - breakMin);

  const hhmm = (ms) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const lines = [
    `ใบนี้ปิดตรงเวลาเลิกกะ (${hhmm(e)}) และยาว ${totalMin} นาที`,
    rd != null ? `ช่างกดซ่อมเสร็จ ${hhmm(rd)} — ห่างจากเวลาปิดใบ ${spanMin} นาที` : null,
    breakMin > 0 ? `หักเวลาพัก ${breakMin} นาทีแล้ว เหลือ ${answerMin} นาทีที่ยังไม่มีคำอธิบาย` : null,
    '',
    'ถ้าไลน์กลับมาเดินก่อนเลิกกะ → แก้เวลาปิดใบให้ตรงความจริง',
    `ถ้าหยุดยาวจริงถึงเลิกกะ → เขียนเหตุผลในช่องรายละเอียด (รอของ / ไม่มีแผนต่อ / รอช่างรอบสอง)`,
    '',
    `⚠️ ปล่อยไว้แบบนี้ ${answerMin} นาทีจะไปหัก %A ของกะนี้ และถ้ายอดผลิตยังเท่าเดิม %P จะดูสูงผิดปกติ`,
    'เลขที่อ่านไม่ได้ทั้งคู่ = ไม่มีใครใช้ตัดสินอะไรได้',
  ].filter(l => l !== null);

  return {
    atShiftEnd: true, totalMin, breakMin, answerMin,
    sinceRepairMin: rd != null ? spanMin : null,
    text: lines.join('\n'),
  };
}

/* ── ⚠️ ด่าน "ตัวเลขกะนี้เชื่อได้ไหม" ตอนปิดกะ **ไม่ได้อยู่ที่นี่** ──────────────────
   มีอยู่แล้วใน `src/utils/closeChecks.js` → `buildCloseChecks()`:
     · `work_over_time`  = %P ทะลุ 100% ก่อนถูกตัด (`oee.pOver` + `dtOverstateMin`)
     · `dt_over_shift`   = เวลาหยุดรวมเกินเวลากะ
     · `end_time_far`    = เวลาปิดกะล้ำหน้าโดยไม่มีใบ downtime รองรับ
     · `dt_closed_at_shift_end` = ใบนอกแผนที่ปิดตรงเวลาเลิกกะ (เพิ่ม 13/11 — ของใหม่รอบนี้)
   🔴 **ห้ามย้ายกลับมาที่นี่ ห้ามเขียนชุดที่ 2** — ด่านปิดกะต้องเป็นลิสต์เดียวที่คนติ๊กทีละข้อ
      (เคยเกือบทำซ้ำรอบนี้: เขียน `shiftDataSanity()` ทับของที่มีอยู่ แล้วถอดออก)        */

export default { checkDtClosedAtShiftEnd, SHIFT_END_TOL_MIN, DT_ASK_MIN };
