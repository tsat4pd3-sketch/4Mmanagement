/* ═══════════════════════════════════════════════════════════════════════════
   ตัวนับ "การใช้งาน" ของอุปกรณ์ — PM แบบ condition-based (usage / hybrid)   2026-09-15

   คำสั่ง user: *"PM ของอุปกรณ์ต่างๆ ที่นับยอดผลิตงาน มาใช้เป็น condition base แทน time base"*
   + *"ดูหน้าไหนได้บ้างว่าเครื่องไหนผ่านการผลิตไปแล้วกี่ชิ้นงาน"*

   ⚠️ ไฟล์นี้ pure ทั้งไฟล์ (ไม่ import supabase) — **ทุกจอที่โชว์ "ยอดผลิตสะสม / % ถึงเกณฑ์ /
      คาดวันครบกำหนด" ต้องอ่านจากที่นี่ที่เดียว** ห้ามคิดเลขซ้ำในหน้า
      (เคยเกิดจริง: PmForecast คิดแบบหนึ่ง · SQL pm_refresh_plan คิดอีกแบบ ⇒ เลขบนจอกับวันครบ
       กำหนดที่ DB เขียนไว้ไม่ตรงกัน ต่างกัน 3 จุด: qty_ok vs qty · ครอบครัวไลน์ vs ไลน์ตรงตัว ·
       work_date vs confirmed_at)

   ── ทำไมนับที่ "ไลน์" ไม่ใช่ "เครื่อง" (คำสั่ง user 2026-09-15: "เริ่มที่ระดับไลน์ก่อน") ──
   ยอดผลิตในระบบผูกกับ **ใบผลิต → กะ → ไลน์** · `prod_orders.machine_no` ถูกกรอกแค่ 3.8% ของใบ
   (534/13,919 · 13 เครื่องจาก 655) ⇒ นับรายเครื่องจริงยังทำไม่ได้ทั้งโรงงาน
   **กติกาที่ตกลง: ทุกอุปกรณ์ในไลน์เดียวกันใช้ยอดของไลน์นั้นร่วมกัน** — จอต้องเขียนกำกับให้ชัด
   ห้ามปล่อยให้คนอ่านว่าเป็นยอดที่วัดรายเครื่องจริง (ไลน์ที่มีเครื่องขนานกันจะเกินจริงตามจำนวนเครื่อง)
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── คอลัมน์ที่ใช้เป็น "จำนวนชิ้นที่ผ่านเครื่อง" ────────────────────────────────
   ใช้ `qty` เท่านั้น **ห้ามใช้ qty_ok / qty_actual** (วัดฐานจริง 15/09 · 13,073 ใบ confirmed):
     · `qty`        มีครบทุกใบ (13,073) ← ใช้ตัวนี้
     · `qty_ok`     null 173 ใบ · เท่ากับ qty อยู่แล้ว 12,900 ใบ (98.7%)
     · `qty_actual` **เป็น 0 ถึง 11,641 ใบ (89%)** — กรอกเฉพาะบางไลน์ ใช้เป็นตัวนับไม่ได้
   และความหมายก็ตรงกว่า: เครื่อง/แม่พิมพ์สึกตาม "จำนวนชิ้นที่ทำ" รวมของเสียด้วย
   (ปั๊ม 100 ชิ้น เสีย 5 = แม่พิมพ์ทำงาน 100 ครั้ง ไม่ใช่ 95) */
export const usageQtyOf = (row) => {
  const v = Number(row?.qty);
  return Number.isFinite(v) ? v : 0;
};

/** ชื่อไลน์ให้เทียบแบบเดียวกันทุกที่ (กันเว้นวรรค/ตัวพิมพ์ไม่ตรง) */
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * รวมยอดผลิตของ "ครอบครัวไลน์" ตั้งแต่วันที่กำหนด
 *
 * @param rows  [{ line_name, work_date:'YYYY-MM-DD', qty }]  (ยอดรายไลน์รายวัน)
 * @param lines ชื่อไลน์ที่นับรวม (กางครอบครัวแม่-ลูกมาแล้วจาก getLineFamilyNames)
 * @param since 'YYYY-MM-DD' — นับวันที่ **หลังจาก** วันนี้ (exclusive) · null = นับทั้งหมดที่มี
 * @param until 'YYYY-MM-DD' — ถึงวันนี้ (inclusive) · null = ไม่จำกัด
 *
 * ⚠️ exclusive ที่ `since` ตั้งใจ — วัน PM คือวันที่เพิ่งล้าง/เปลี่ยนของ ยอดของวันนั้น
 *    ถือเป็นรอบก่อนหน้า ถ้านับรวมเข้ามาจะดูเหมือนใช้ไปแล้วทั้งที่เพิ่ง PM เสร็จ
 */
export function sumUsage(rows = [], { lines = null, since = null, until = null } = {}) {
  const set = lines ? new Set(lines.map(norm)) : null;
  let qty = 0, days = 0, firstDate = null, lastDate = null;
  for (const r of rows) {
    if (set && !set.has(norm(r?.line_name))) continue;
    const d = r?.work_date ? String(r.work_date).slice(0, 10) : null;
    if (!d) continue;
    if (since && d <= String(since).slice(0, 10)) continue;
    if (until && d > String(until).slice(0, 10)) continue;
    qty += usageQtyOf(r);
    days += 1;
    if (!firstDate || d < firstDate) firstDate = d;
    if (!lastDate || d > lastDate) lastDate = d;
  }
  return { qty, days, firstDate, lastDate };
}

/** ชิ้น → shot ของแม่พิมพ์ (งานคู่ 1 stroke = 2 ชิ้น) · ไม่รู้ = คืน null ห้ามเดาเป็น 1 */
export function piecesToShots(pieces, piecesPerStroke) {
  // ⚠️ Number(null) = 0 (finite!) — ต้องกัน null/'' ก่อน ไม่งั้น "ไม่รู้ยอด" กลายเป็น 0 shot
  if (pieces == null || pieces === '') return null;
  const p = Number(pieces), n = Number(piecesPerStroke);
  if (!Number.isFinite(p)) return null;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(p / n);
}

/* ระดับสัญญาณ — ล้อ Andon ของทั้งระบบ (เขียว/เหลือง/แดง · ดู docs/UI-CONVENTIONS.md)
   over = เลยเกณฑ์แล้ว (แดงกระพริบได้) · due = ใกล้มาก · warn = เริ่มเตรียม · ok = ยังไกล */
export const USAGE_LEVELS = { ok: '#22c55e', warn: '#f59e0b', due: '#f97316', over: '#ef4444' };
export const usageLevel = (pct) => {
  if (!Number.isFinite(pct)) return 'ok';
  if (pct >= 100) return 'over';
  if (pct >= 90) return 'due';
  if (pct >= 70) return 'warn';
  return 'ok';
};

/**
 * ความคืบหน้าถึงเกณฑ์ — คืน null ทั้งชุดเมื่อ "ยังไม่ตั้งเกณฑ์"
 * (ตั้งใจให้จอแยก "ยังไม่ตั้งเกณฑ์" ออกจาก "ตั้งแล้วแต่ยัง 0%" ให้ได้)
 */
export function usageProgress(accum, threshold) {
  const a = Number(accum) || 0, t = Number(threshold);
  if (!Number.isFinite(t) || t <= 0) return { pct: null, remaining: null, level: null, hasThreshold: false, accum: a };
  const pct = Math.round((a / t) * 100);
  return { pct, remaining: t - a, level: usageLevel(pct), hasThreshold: true, accum: a, threshold: t };
}

/**
 * อัตราผลิต/วัน จาก "วันที่เดินงานจริง" ไม่ใช่วันปฏิทิน
 * เครื่องที่เดินสัปดาห์ละ 2 วัน ถ้าหารด้วย 30 วันปฏิทิน จะได้อัตราต่ำเกินจริง
 * ⇒ คาดวันครบกำหนดเลื่อนออกไปไกลกว่าความจริงมาก (PM สาย)
 */
export function dailyRate(rows = [], { lines = null, days = 30, todayStr } = {}) {
  if (!todayStr) return { rate: 0, activeDays: 0, qty: 0 };
  const since = addDays(todayStr, -Math.abs(days) - 1);   // -1 เพราะ sumUsage เป็น exclusive
  const s = sumUsage(rows, { lines, since, until: todayStr });
  return { rate: s.days ? s.qty / s.days : 0, activeDays: s.days, qty: s.qty };
}

/** บวกวัน (ทำงานบนสตริง YYYY-MM-DD ตรงๆ — ไม่แตะ timezone ห้ามใช้ toISOString) */
export function addDays(ymd, n) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() + Number(n || 0));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/**
 * คาดวันที่จะถึงเกณฑ์ — คืน { etaDate, daysLeft } · null = คำนวณไม่ได้ (ไม่มีเกณฑ์/ไม่เดินงาน)
 * ⚠️ นับเป็น "วันที่เดินงาน" ตามอัตราข้างบน แล้วค่อยแปลงเป็นวันปฏิทินด้วยสัดส่วนวันเดินงานจริง
 *    (เดิน 2 ใน 7 วัน ⇒ ต้องใช้เวลาจริง ~3.5 เท่าของจำนวนวันเดินงานที่เหลือ)
 */
export function usageEta({ accum, threshold, rate, activeDays = 0, windowDays = 30, todayStr }) {
  const prog = usageProgress(accum, threshold);
  if (!prog.hasThreshold || !todayStr) return { etaDate: null, daysLeft: null, ...prog };
  if (prog.remaining <= 0) return { etaDate: todayStr, daysLeft: 0, ...prog };
  if (!(Number(rate) > 0)) return { etaDate: null, daysLeft: null, ...prog };
  const runDaysLeft = prog.remaining / rate;
  // สัดส่วนวันเดินงานจริงในหน้าต่างที่วัด — ไม่มีข้อมูล = ถือว่าเดินทุกวัน (ประมาณการที่ปลอดภัยกว่า)
  const duty = activeDays > 0 && windowDays > 0 ? Math.min(1, activeDays / windowDays) : 1;
  const calDaysLeft = Math.ceil(runDaysLeft / duty);
  return { etaDate: addDays(todayStr, calDaysLeft), daysLeft: calDaysLeft, ...prog };
}
