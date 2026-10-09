/* ═══ 🗓️ หัวคอลัมน์ช่วงเวลา — ตัวเดียวทุกตารางมอนิเตอร์ (2026-10-08 · คำสั่ง user)

   user: *"รูปแบบหัวตาราง รูปแบบการ visualize เอาให้มันเป็นไปในทางเดียวกัน การกรอง การแสดงวันเริ่ม
   ของตาราง เอาให้มันทิศทางเดียวกันหน่อย"* — เดิม 2 ตารางในหน้า /monitoring เขียนป้ายเอง 2 แบบ:
   · บอร์ด (`MonitorBoardGrid`): 2 บรรทัด "จ / 8/10" · "ยกมา" · "สัปดาห์" — **บอร์ดรายสัปดาห์ไม่เคยชี้วันนี้**
     (เทียบวันที่ตรงตัว แต่หัวคอลัมน์เป็นวันต้นสัปดาห์) · เปิดมาเริ่มที่คอลัมน์แรกของไฟล์ (Argen = ธ.ค. ปีก่อน)
   · Balance FG (`RundownStock`): 1 บรรทัด "วันนี้ 8/10" · "Stock ตอนนี้" · ไฮไลต์คนละสี
   ⇒ ป้าย + "วันนี้อยู่คอลัมน์ไหน" + "เปิดมาเริ่มตรงไหน" ตัดสินที่ไฟล์นี้ที่เดียว (pure · เทส periodHead.test.mjs)

   🔴 วันที่เป็นสตริง 'YYYY-MM-DD' — แกะด้วย UTC ล้วน ไม่พึ่ง timezone เครื่อง · `today` ต้องมาจาก `getWorkDate()`
   ═══════════════════════════════════════════════════════════════════════════════ */

const WD = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const DAY_MS = 86400000;
const ms = (d) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);

/** คอลัมน์นี้คือ "วันนี้" ไหม — รายสัปดาห์ = วันนี้อยู่ในสัปดาห์นั้น (หัวคอลัมน์ = วันต้นสัปดาห์) */
export function isTodayPeriod(date, today, kind = 'day') {
  if (!date || !today) return false;
  const a = ms(date), t = ms(today);
  if (!Number.isFinite(a) || !Number.isFinite(t)) return false;
  return kind === 'week' ? (t >= a && t < a + 7 * DAY_MS) : a === t;
}

/**
 * ป้ายหัวคอลัมน์ 2 บรรทัด
 * @param {string} date  'YYYY-MM-DD'
 * @param {{ kind?:'day'|'week'|'date', today:string, seed?:boolean, seedLabel?:string, seedBot?:string }} o
 * @returns {{ top:string, bot:string, isToday:boolean, weekend:boolean }}
 */
export function periodHead(date, { kind = 'day', today, seed = false, seedLabel = 'ยกมา', seedBot } = {}) {
  const t = new Date(ms(date));
  const ok = Number.isFinite(t.getTime());
  const isToday = !seed && isTodayPeriod(date, today, kind);
  const sameYear = ok && String(today || '').slice(0, 4) === String(t.getUTCFullYear());
  const dm = ok ? `${t.getUTCDate()}/${t.getUTCMonth() + 1}${sameYear ? '' : `/${String(t.getUTCFullYear()).slice(2)}`}` : '–';
  const weekend = ok && kind !== 'week' && (t.getUTCDay() === 0 || t.getUTCDay() === 6);
  const top = seed ? seedLabel : isToday ? '📍 วันนี้' : kind === 'week' ? 'สัปดาห์' : (ok ? WD[t.getUTCDay()] : '');
  return { top, bot: seed && seedBot ? seedBot : dm, isToday, weekend };
}

/**
 * ตำแหน่งเริ่มของหน้าต่างคอลัมน์ ให้ "วันนี้" อยู่คอลัมน์แรก (หลังคอลัมน์ยกมา)
 * @param {Array<{date:string}>} body  คอลัมน์ทั้งหมด **ไม่รวม** คอลัมน์ยกมา
 * @param {number} visible  จำนวนคอลัมน์ที่มองเห็นได้ (ไม่รวมยกมา)
 * @returns {number} index เริ่ม (0 = ต้นตาราง) · วันนี้เลยท้ายตาราง = หน้าสุดท้าย
 */
export function startIndexForToday(body = [], today, kind = 'day', visible = body.length) {
  if (!body.length) return 0;
  const last = Math.max(0, body.length - Math.max(1, visible));
  let i = body.findIndex((p) => isTodayPeriod(p.date, today, kind) || ms(p.date) > ms(today));
  if (i < 0) return last;                        // ทุกคอลัมน์อยู่ก่อนวันนี้ → โชว์ท้ายสุด
  return Math.min(i, last);
}

/** สีหัว/ช่องตามสถานะคอลัมน์ — ชุดเดียวทุกตาราง */
export function periodTone({ isToday = false, seed = false, weekend = false } = {}) {
  return {
    bg: isToday ? 'var(--accent-dim)' : (seed ? 'var(--bg3)' : undefined),
    edge: isToday ? '2px solid var(--accent)' : (seed ? '2px solid var(--border2)' : undefined),
    color: isToday ? 'var(--accent)' : (seed ? 'var(--accent2)' : (weekend ? 'var(--muted)' : 'var(--text2)')),
  };
}
