/* ── dailyCheckDay — "ช่องว่างในตารางตรวจรายวัน แปลว่าอะไร" (2026-10-13 · คำสั่ง user) ──────────
   *"ถ้าไม่มีเปิดกะไม่มีผลิต ต้องทำให้ข้อมูลแยกชัดเจนว่า ไม่ได้ตรวจ หรือไม่ได้ทำการผลิต
     หรือต้องตรวจในวันนั้น"*

   🔴 ปัญหาเดิม: ตารางรายงานรายเดือน (LPA FM-QMR-008 · Poka-Yoke) ปล่อยช่องว่างเปล่าๆ
      ซึ่ง **ปนกัน 4 ความหมาย** — ไม่ได้ตรวจ / ไม่ได้ผลิต / ไม่มีแผนตรวจวันนั้น / ยังไม่ถึงวัน
      ⇒ ตัวเลข "ตรวจแล้ว N ครั้ง" ไม่มีตัวหาร ⇒ บอกไม่ได้ว่าขาดตรวจจริงกี่วัน
      (ฝั่ง AM แยกไว้ถูกแล้วตั้งแต่ 08/10 — `dailyAmLineStatus` มี notStarted/wait/late + hasSession)

   🔴 กฎเหล็กของไฟล์นี้:
   1. **"ไม่รู้" ≠ "ไม่ต้องตรวจ"** — อ่านตารางกะ/ใบผลิตไม่สำเร็จ ⇒ `unknown` **ห้ามถือเป็น no_run**
      (ถือเป็น no_run = กลบวันที่ขาดตรวจทั้งเดือนให้ดูสะอาด = จอโกหกแบบที่อันตรายที่สุด)
   2. **ตัวหารของ % ความครบ = `done + missed` เท่านั้น** — วันไม่ผลิต/ไม่มีแผน/อนาคต ห้ามนับเป็นตัวหาร
      และ `unknown` ก็ห้ามนับ (นับแล้วเปอร์เซ็นต์ขยับตามความล้มเหลวของคิวรี ไม่ใช่ตามงานจริง)
   3. **จอต้องเขียนจำนวน `unknown` บนหน้าจอ** เมื่อ > 0 (กฎความซื่อสัตย์ของจอ · CLAUDE.md §OBEYA)
   4. 🔴 **สัญลักษณ์สถานะวัน ห้ามชนกับ "คำตอบของการตรวจ"** (คำสั่ง user 13/10) —
      ใบตรวจพูดภาษา **ละตินพิมพ์ใหญ่ตัวเดียว** อยู่แล้ว (`Y` ผ่าน · `N` ไม่ผ่าน · `T` ยอมรับมีเงื่อนไข
      · `N/A` ข้อนี้ไม่เกี่ยวข้อง) ⇒ `✗` เทียบเท่า `N` · `–` เทียบเท่า `N/A` · `?` สีเหลืองเทียบเท่า `T`
      **ชนทั้งตัวอักษรและสี** = คนอ่านนึกว่า "ตรวจแล้วเจอผิดปกติ" ทั้งที่ยังไม่มีใครไปตรวจ
      ⇒ ชุดนี้จึงใช้ **คำย่อไทย + `NP`** และ **ห้ามเติม `N`/`T`/`Y`/`N/A` เข้ามาเป็น `mark`**
      (มีด่าน `check-day-mark-not-answer` + เทส `dailyCheckDay.test.mjs`) · `N/A` ใช้แทน Non-Production ไม่ได้
      เพราะถูกจองไปแล้วที่ระดับข้อคำถาม                                                        */

/** สถานะของ "1 ช่อง = 1 วัน (หรือ 1 กะ)" ในตารางตรวจรายวัน */
export const CHECK_DAY = {
  done:        'done',         // ✅ ตรวจแล้ว มีผล
  missed:      'missed',       // 🔴 ต้องตรวจวันนั้น (มีการผลิต + อยู่ในแผน) แต่ไม่มีผลตรวจ
  no_run:      'no_run',       // ⚪ ไม่ได้ผลิต/ไม่ได้เปิดกะ ⇒ ไม่ต้องตรวจ
  off:         'off',          // 🟩 วันหยุดโรงงาน
  not_planned: 'not_planned',  // ⬜ ไม่ได้อยู่ในแผนตรวจของวันนั้น
  future:      'future',       // · ยังไม่ถึงวัน
  unknown:     'unknown',      // ❔ ไม่รู้ว่าวันนั้นผลิตไหม (อ่านข้อมูลไม่ได้) — ห้ามเดา
};

/**
 * ป้าย/สี/สัญลักษณ์ของแต่ละสถานะ — **ห้ามแต่งเองในหน้า** ทุกฟอร์มต้องพูดเหมือนกัน
 *
 * `mark` = สิ่งที่เขียนในช่อง (กฎข้อ 4: ห้ามชนพจนานุกรมคำตอบ Y/N/T/N-A)
 * `tint` = พื้นหลังที่จอ**ควรทาทั้งคอลัมน์ของวันนั้น** — ตัวที่กันการอ่านสลับได้แข็งที่สุด
 *          เพราะช่อง "คำตอบ" ไม่เคยทาทั้งคอลัมน์ · `null` = ไม่ต้องทา
 */
export const CHECK_DAY_META = {
  done:        { mark: '',     label: 'ตรวจแล้ว',                  color: 'var(--text)',  tint: null },
  missed:      { mark: 'ขาด',  label: 'ต้องตรวจ แต่ไม่ได้ตรวจ',     color: 'var(--red)',   tint: 'rgba(239,68,68,0.12)' },
  no_run:      { mark: 'NP',   label: 'ไม่ได้เปิดกะ/ไม่ได้ผลิต (Non-Production) — ไม่ต้องตรวจ',
                                                                   color: 'var(--muted)', tint: 'rgba(148,163,184,0.12)' },
  off:         { mark: '',     label: 'วันหยุดโรงงาน',              color: 'var(--muted)', tint: null },
  not_planned: { mark: '·',    label: 'ไม่มีแผนตรวจวันนี้',         color: 'var(--muted)', tint: null },
  future:      { mark: '',     label: 'ยังไม่ถึงวัน',               color: 'var(--muted)', tint: null },
  unknown:     { mark: '?',    label: 'ไม่รู้ว่าวันนั้นผลิตหรือไม่', color: 'var(--amber)', tint: 'rgba(245,158,11,0.12)' },
};

/** คำอธิบายสัญลักษณ์ (legend) — จอที่วาดแถวสถานะวันต้องแสดงชุดนี้ ไม่ให้คนเดาเอง */
export const CHECK_DAY_LEGEND = [CHECK_DAY.missed, CHECK_DAY.no_run, CHECK_DAY.unknown, CHECK_DAY.not_planned];
/**
 * ตัดสินสถานะของช่องหนึ่ง — ลำดับความสำคัญคงที่ ห้ามสลับ
 *
 * @param {object}  p
 * @param {boolean} p.hasResult  มีผลตรวจของช่องนี้แล้วหรือยัง
 * @param {boolean} [p.isFuture] วันข้างหน้า (ยังไม่ถึง)
 * @param {boolean} [p.isOff]    วันหยุดโรงงาน (ปฏิทินบริษัท)
 * @param {boolean|null} [p.planned]  อยู่ในแผนตรวจวันนั้นไหม · `null`/undefined = ฟอร์มนี้ไม่มีแผนรายวัน (ถือว่าต้องตรวจทุกวันที่ผลิต)
 * @param {boolean|null} [p.ran]      วันนั้นมีการผลิต/เปิดกะไหม · **`null` = ไม่รู้ (ห้ามเดา)**
 */
export function checkDayState({ hasResult, isFuture = false, isOff = false, planned = null, ran = null } = {}) {
  // 🔴 มีผลตรวจ = จบ ชนะทุกเงื่อนไข — ตรวจในวันหยุด/วันไม่ผลิตก็ยังเป็น "ตรวจแล้ว" (ของจริงเกิดขึ้นแล้ว)
  if (hasResult) return CHECK_DAY.done;
  if (isFuture)  return CHECK_DAY.future;
  if (isOff)     return CHECK_DAY.off;
  if (planned === false) return CHECK_DAY.not_planned;
  if (ran === false)     return CHECK_DAY.no_run;
  if (ran == null)       return CHECK_DAY.unknown;   // อ่านไม่ได้ ≠ ไม่ต้องตรวจ
  return CHECK_DAY.missed;
}

/**
 * สรุปทั้งเดือน/ทั้งช่วง — คืนตัวนับแต่ละสถานะ + % ความครบที่มีตัวหารถูกต้อง
 * @param {string[]} states ผลจาก `checkDayState` ของทุกช่อง
 * @returns `{ done, missed, no_run, off, not_planned, future, unknown, due, pct }`
 *          `due` = ตัวหาร (done + missed) · `pct` = `null` เมื่อ due = 0 (**ห้ามคืน 0% หรือ 100%**)
 */
export function summarizeCheckDays(states) {
  const c = { done: 0, missed: 0, no_run: 0, off: 0, not_planned: 0, future: 0, unknown: 0 };
  for (const s of states || []) if (s in c) c[s]++;
  const due = c.done + c.missed;
  return { ...c, due, pct: due ? Math.round((c.done / due) * 100) : null };
}

/** ข้อความสรุปใต้ตาราง — ประกอบที่เดียว ทุกฟอร์มพูดเหมือนกัน (ว่าง = ไม่มีอะไรต้องเขียน) */
export function checkDaysNote(sum) {
  if (!sum) return '';
  const parts = [];
  if (sum.due) parts.push(`ต้องตรวจ ${sum.due} ครั้ง · ตรวจแล้ว ${sum.done}${sum.missed ? ` · ขาด ${sum.missed}` : ''}`);
  else parts.push('ยังไม่มีวันที่ต้องตรวจในช่วงนี้');
  if (sum.no_run)  parts.push(`ไม่ได้ผลิต ${sum.no_run} วัน`);
  if (sum.unknown) parts.push(`❔ ไม่รู้ว่าผลิตหรือไม่ ${sum.unknown} วัน (อ่านข้อมูลการผลิตไม่สำเร็จ — ตัวเลขขาดตรวจอาจต่ำกว่าจริง)`);
  return parts.join(' · ');
}

/* ── "วันนั้น/กะนั้น ผลิตไหม" — ส่วน pure ของ `utils/runDays.js` ───────────────────────────
   แยกไว้ที่นี่เพราะ `runDays.js` import `supabaseClient` ⇒ เทส node import ตรงไม่ได้
   (แบบเดียวกับที่ `lib/pmDailyStatus.js` ถูกแยกออกจาก `lib/dailyAmBoard.js`) */

/** คีย์ของช่อง — วันอย่างเดียว หรือ วัน+กะ (ฟอร์มที่ตรวจรายกะ) */
export const runKey = (workDate, shift) => (shift ? `${workDate}|${shift}` : String(workDate));

/**
 * ตอบ "วันนี้(กะนี้) ผลิตไหม" จากผลของ `loadRunDays`
 * @returns `true` ผลิต · `false` ไม่ผลิต · **`null` = ไม่รู้** (ยังไม่โหลด / โหลดไม่สำเร็จ)
 * 🔴 `null` ห้ามถูกตีเป็น `false` ที่ไหนก็ตาม — ดูกฎข้อ 1 หัวไฟล์
 */
export function ranOn(runs, workDate, shift) {
  if (!runs || runs.days == null) return null;
  return runs.days.has(runKey(workDate, shift));
}
