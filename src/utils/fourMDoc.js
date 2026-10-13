/* ══ fourMDoc — "ย้ายคนข้ามไลน์ครั้งนี้ ต้องแนบเอกสาร OJT ใหม่ไหม" ════════════════════
   (2026-10-12 · คำสั่ง user — QC audit รอบ 6 ต่อ)

   โจทย์จาก user: *"ถ้าคนนั้นเคยมีประวัติย้ายมาทำ และมีสกิลสะสมมากเกินกว่า 25% หรือถ้าสกิล
   ไม่ถึงแต่ภายใน 6 เดือนย้อนหลังเคย OJT แล้ว ก็สามารถใช้ใบเดิมได้ไม่ต้องแนบ ถ้าเคยแนบไว้"*

   ⇒ แยกเป็น **เงื่อนไขร่วม 1 ข้อ + ทางยกเว้น 2 ทาง**:
     เงื่อนไขร่วม  ต้อง**เคยมีใบ 4M ของคน+จุดนี้ที่แนบเอกสารไว้จริง** — ไม่เคยมี = แนบใหม่
                  (ไม่งั้นเป็นการยกเว้นลอยๆ ที่ไม่มีหลักฐานให้ auditor ดู)
     ทาง (ก)      มีประวัติทำจุดนี้ **และ** ทุกสกิลที่จุดต้องการ > 25 ⇒ ใช้ใบเดิมได้ **ไม่จำกัดอายุ**
                  (ฝีมือพิสูจน์ตัวเองแล้ว เอกสารเก่าก็ยังใช้อ้างได้)
     ทาง (ข)      สกิลยังไม่ถึง/ไม่มีประวัติ ⇒ ใบเดิมต้อง **ไม่เกิน 6 เดือน**
                  (ฝีมือยังไม่พิสูจน์ ⇒ หลักฐาน OJT ต้องสดพอ)

   🔴 **ไม่รู้ = ต้องแนบ (fail-closed)** — ต่างจากกฎ "ไม่รู้ = ไม่บล็อก" ของจอวิเคราะห์ เพราะที่นี่
      ผลของการเดาผิดคือ **บันทึกคุณภาพ (IATF) ที่ไม่มีหลักฐานรองรับ** ไม่ใช่แค่ตัวเลขบนจอเพี้ยน
      ⇒ `reqScores = null` (ยังไม่รู้คะแนน) หรือ `[]` (จุดนี้ไม่ได้ตั้งสกิลที่ต้องการไว้)
        = **พิสูจน์ฝีมือไม่ได้** ⇒ ตกไปทาง (ข) ไม่ใช่ทาง (ก)

   🔴 **รับ `now` เข้ามา ห้ามอ่านนาฬิกาเอง** — ด่าน `npm test` รันรอบ "นาฬิกา +400 วัน"
      ฟังก์ชันที่อ่านเวลาปัจจุบันเองจะกลายเป็นเทสระเบิดเวลา (docs/modules/build-gates.md)
   ══════════════════════════════════════════════════════════════════════════════════ */

/** คะแนนสกิลขั้นต่ำที่ถือว่า "พิสูจน์ฝีมือแล้ว" — ตรงกับขั้นแรกของระบบ EXP (25/50/75/100) */
export const SKILL_MIN_SCORE = 25;
/** อายุใบเดิมที่ยังอ้างได้ เมื่อฝีมือยังไม่ถึงเกณฑ์ */
export const DOC_REUSE_MONTHS = 6;

/** แกะ 'YYYY-MM-DD' → [y,m,d] เป็นเลข (UTC ล้วน ไม่พึ่ง timezone เครื่อง) · แกะไม่ออก = null */
const ymd = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** จำนวนวันระหว่าง 2 วันที่ (UTC) · แกะไม่ออก = null */
export function daysBetween(fromStr, toStr) {
  const a = ymd(fromStr), b = ymd(toStr);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

/**
 * ใบเดิมยังอยู่ในกรอบ N เดือนไหม — นับเป็น **เดือนปฏิทิน** ไม่ใช่ 30×N วัน
 * (24/03 + 6 เดือน = 24/09 ไม่ใช่ 20/09 — คนหน้างานนับแบบปฏิทิน)
 * วันสิ้นเดือนที่ไม่มีในเดือนปลายทางถูก clamp ลง (31/08 + 6 = 28/02 หรือ 29/02)
 */
export function withinMonths(docDate, nowDate, months = DOC_REUSE_MONTHS) {
  const a = ymd(docDate), b = ymd(nowDate);
  if (!a || !b) return false;                       // ไม่รู้วัน = ไม่ยกเว้น
  const mTotal = a[1] - 1 + months;
  const y = a[0] + Math.floor(mTotal / 12);
  const m = (mTotal % 12) + 1;
  const dMax = new Date(Date.UTC(y, m, 0)).getUTCDate();   // วันสุดท้ายของเดือนปลายทาง
  const cutoff = Date.UTC(y, m - 1, Math.min(a[2], dMax));
  return Date.UTC(b[0], b[1] - 1, b[2]) <= cutoff;
}

/**
 * ตัดสินว่าการย้ายครั้งนี้ต้องแนบเอกสาร OJT ใหม่ไหม
 *
 * @param {object}        p
 * @param {boolean}       p.hasHistory  เคยทำจุดนี้มาก่อน (`daily_production_logs` ก่อนวันนี้)
 * @param {number[]|null} p.reqScores   คะแนนสกิลของคนนี้ ในสกิลที่จุดนี้ต้องการ
 *                                      · `null` = ยังไม่รู้ · `[]` = จุดนี้ไม่ได้ตั้งสกิลที่ต้องการ
 * @param {{id:string, work_date:string}|null} p.priorDoc ใบ 4M เดิมที่แนบเอกสารไว้ (ใบล่าสุด)
 * @param {string}        p.today       วันทำงานวันนี้ 'YYYY-MM-DD' (จาก `getWorkDate()`)
 * @returns {{needDoc:boolean, waivedBy:('skill'|'recent'|null), refLogId:(string|null),
 *           reason:string, ageDays:(number|null)}}
 *   `reason` = ข้อความที่**ต้องเอาไปเขียนบนจอ/ในใบ** (ห้ามยกเว้นเงียบ)
 */
export function docRequirement({ hasHistory, reqScores, priorDoc, today } = {}) {
  const ageDays = priorDoc ? daysBetween(priorDoc.work_date, today) : null;
  const skillProven = Array.isArray(reqScores) && reqScores.length > 0
    && reqScores.every(s => Number(s) > SKILL_MIN_SCORE);

  if (!priorDoc) {
    return { needDoc: true, waivedBy: null, refLogId: null, ageDays: null,
      reason: 'ไม่เคยมีใบ 4M ของคน/จุดนี้ที่แนบเอกสาร OJT ไว้ — ต้องแนบใหม่' };
  }
  if (hasHistory && skillProven) {
    return { needDoc: false, waivedBy: 'skill', refLogId: priorDoc.id, ageDays,
      reason: `ใช้เอกสาร OJT เดิม (ใบ ${priorDoc.work_date}) — เคยทำจุดนี้ และทุกสกิลที่จุดต้องการ > ${SKILL_MIN_SCORE}` };
  }
  if (withinMonths(priorDoc.work_date, today)) {
    return { needDoc: false, waivedBy: 'recent', refLogId: priorDoc.id, ageDays,
      reason: `ใช้เอกสาร OJT เดิม (ใบ ${priorDoc.work_date}) — ภายใน ${DOC_REUSE_MONTHS} เดือน` };
  }
  return { needDoc: true, waivedBy: null, refLogId: null, ageDays,
    reason: `เอกสาร OJT เดิม (ใบ ${priorDoc.work_date}) เกิน ${DOC_REUSE_MONTHS} เดือน`
          + ` และสกิลยังไม่ถึงเกณฑ์ > ${SKILL_MIN_SCORE} — ต้องแนบใหม่` };
}
