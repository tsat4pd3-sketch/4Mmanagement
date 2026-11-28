/* ══ 📅 แผนภูมิแท่งเวลา (Gantt) ของแผนงานกิจกรรม — คิดตำแหน่งแท่ง (28/11 · แบบเว็บ TSAT4 Activity "Schedule") ══
   กริดรายปี = 12 เดือน × 4 สัปดาห์ = 48 ช่อง · สัปดาห์ของเดือน = วันที่ 1–7 → 1 · 8–14 → 2 · 15–21 → 3 · 22 ขึ้นไป → 4
   · แท่งแผน = วันเริ่ม → วันจบ · แท่งทำจริง = วันเริ่ม → วันเสร็จ (เสร็จแล้ว) หรือ → วันนี้ (ยังไม่เสร็จ แต่มี % แล้ว)
   · ส่วนที่เลยวันจบของแผน = ช่วงช้า (วาดสีแดงต่อท้าย)
   · นอกปีที่ดู = ตัดที่ขอบ (from 0 / to 47) และบอก `clipL` / `clipR`
   ไฟล์ข้อมูลล้วน · ทุกฟังก์ชันรับ `today` เป็นพารามิเตอร์ */
import { planStatus } from './planTasks.js';

export const WEEKS = 48;

/** ช่องสัปดาห์ (0–47) ของวันที่ YYYY-MM-DD ในปี `year` · ก่อนปี = -1 · หลังปี = 48 */
export function weekCol(date, year) {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  if (y < year) return -1;
  if (y > year) return WEEKS;
  return (m - 1) * 4 + Math.min(4, Math.floor((d - 1) / 7) + 1) - 1;
}

function span(from, to, year) {
  const a = weekCol(from, year), b = weekCol(to, year);
  if (a == null || b == null || b < 0 || a > WEEKS - 1) return null;   // ทั้งช่วงอยู่นอกปีนี้
  return { from: Math.max(0, a), to: Math.min(WEEKS - 1, b), clipL: a < 0, clipR: b > WEEKS - 1 };
}

/** สีของสถานะ (ป้าย/จุด) — ตามคำอธิบายของเว็บเดิม */
export const STATUS_TONE = { early: 'green', done: 'green', ahead: 'blue', ontrack: 'blue', behind: 'amber', overdue: 'red', late: 'red', waiting: 'muted', none: 'muted' };
export const STATUS_LEGEND = [
  { tone: 'green', label: 'เสร็จก่อนแผน / ตามแผน' },
  { tone: 'blue',  label: 'เร็วกว่าแผน / ตามแผน (ยังไม่เสร็จ)' },
  { tone: 'amber', label: 'ช้ากว่าแผน' },
  { tone: 'red',   label: 'เลยกำหนด / เสร็จช้า' },
];

/**
 * แท่งของแถวแผนงาน 1 แถว
 * @returns {{ plan: {from,to,clipL,clipR}|null, actual: {from,to}|null, late: {from,to}|null, status: {code,text}, tone: string }}
 */
export function barsOf(row, year, today) {
  const status = planStatus(row, today);
  const tone = STATUS_TONE[status.code] || 'muted';
  if (!row.start_date || !row.end_date) return { plan: null, actual: null, late: null, status, tone };
  const plan = span(row.start_date, row.end_date, year);
  const p = Number(row.progress) || 0;
  let actualEnd = null;
  if (p >= 100) actualEnd = row.done_on || row.end_date;
  else if (p > 0 && today >= row.start_date) actualEnd = today;
  let actual = null, late = null;
  if (actualEnd && actualEnd >= row.start_date) {
    const full = span(row.start_date, actualEnd, year);
    if (full) {
      const endCol = weekCol(row.end_date, year);
      if (actualEnd > row.end_date && endCol != null && full.to > endCol) {
        /* ส่วนเลยวันจบ = ช้า (แดง) · ส่วนก่อน = ทำจริงปกติ */
        actual = endCol >= full.from ? { from: full.from, to: Math.min(full.to, endCol) } : null;
        late = { from: Math.max(full.from, endCol + 1), to: full.to };
      } else {
        actual = { from: full.from, to: full.to };
      }
    }
  }
  return { plan, actual, late, status, tone };
}

/** ช่องของ "วันนี้" ในปีที่ดู (null = ไม่อยู่ในปีนี้ → ไม่วาดเส้น) */
export function todayCol(today, year) {
  const c = weekCol(today, year);
  return c != null && c >= 0 && c < WEEKS ? c : null;
}
