/* ═══════════════════════════════════════════════════════════════════════════
   🏃 รอบ PM/AM ที่นับจาก "วันที่เครื่องเดินจริง" ไม่ใช่วันปฏิทิน      2026-10-02

   คำสั่ง user: *"AM link กับการใช้งานของเครื่องจักรที่ผลิต ถ้าไม่ผลิตไม่มี order
   ไปผูกเครื่องนั้นก็ไม่จำเป็นต้องตรวจ — ตอนนี้ถ้าเลือกตรวจรายวันมันจะนับว่าต้องตรวจ
   ทุกวันแม้ไม่ได้ผลิต"*

   ── ปัญหาที่วัดได้จริงก่อนแก้ (60 วันล่าสุด · แผน AM รายวัน 7 ตัว) ────────────
     · RB-128/RB-55/RB-56/RB-57/AUTOLOAD-03 (HDF1)  ไลน์เดินจริง 38/60 วัน → ค้างปลอม 37%
     · RB-04 (TSRA-1)                               ไลน์เดินจริง  4/60 วัน → ค้างปลอม 93%
     · PF-H101 (HYDROFORM)                          ดูกับดักข้อ 2 ข้างล่าง
   ค้างปลอมท่วมจอ = คนเลิกดูสีแดง = ของค้างจริงถูกกลบ (บทเรียนเดียวกับ 4M อัตโนมัติ 10/08)

   ── 🔴 กับดัก 3 ข้อที่ต้องรู้ก่อนแก้ไฟล์นี้ ──────────────────────────────────
   1. **"ไม่มีข้อมูลยอดผลิต" ≠ "ไม่ได้ผลิต"** — RPC ล่ม/ยังไม่โหลด แล้วเราบอกว่า
      "ไม่ต้องตรวจ" = **ข้ามการตรวจที่จำเป็นเงียบๆ** ซึ่งอันตรายกว่าตรวจเกิน
      ⇒ `runDays` ต้องเป็น `null` เมื่อ "ยังไม่รู้" และ `[]` เมื่อ "รู้แล้วว่าไม่เดิน"
         ไม่รู้ = คืน `unknownUsage: true` + ถอยไปใช้รอบปฏิทินตามเดิม (จอต้องเขียนบอก)
   2. **ต้องกางครอบครัวไลน์ก่อนเสมอ** (`getLineFamilyNames`) — เคสจริง: PF-H101
      ลงทะเบียนไว้ที่ไลน์ **HYDROFORM (แม่)** แต่ใบผลิตเปิดที่ **HDF1/HDF2 (ลูก)**
      เทียบชื่อตรงตัว = "ไม่เคยเดินเลย 60 วัน" ทั้งที่ของจริงเดิน 38 วัน
   3. **จอดนานต้องตรวจ *มากกว่า* ปกติ ไม่ใช่น้อยกว่า** — เครื่องจอด 3 เดือนแล้วกลับมา
      เดิน สภาพไม่เท่าเครื่องที่เดินทุกวัน ⇒ `maxIdleDays` บังคับตรวจรอบแรกที่กลับมาเดิน

   ⚠️ ไฟล์นี้ pure ทั้งไฟล์ (ไม่ import supabase/ไม่แตะ `new Date()` เว้นแต่ผู้เรียกส่ง `todayStr`)
      — กฎ "เทสระเบิดเวลา" ใน CLAUDE.md · **ทุกจอที่ตอบว่า "ต้องตรวจวันนี้ไหม" ต้องอ่านจากที่นี่
      ที่เดียว ห้ามนับวันเดินเองในหน้า**
   ═══════════════════════════════════════════════════════════════════════════ */

/** ฐานการนับรอบ — เก็บใน `pm_plans.cycle_basis` */
export const CYCLE_BASIS = { CALENDAR: 'calendar', RUN_DAY: 'run_day', USAGE: 'usage' };

export const BASIS_LABEL = {
  calendar: 'วันปฏิทิน',
  run_day: 'วันที่เดินเครื่อง',
  usage: 'ยอดผลิต',
};
export const BASIS_HINT = {
  calendar: 'นับทุกวันไม่ว่าเครื่องจะเดินหรือไม่ — เหมาะกับงานที่เสื่อมตามเวลา (สนิม/สารหล่อลื่นแห้ง/สอบเทียบ)',
  run_day: 'นับเฉพาะวันที่ไลน์นั้นเปิดใบผลิตจริง — วันไม่ได้ผลิตไม่นับและไม่ขึ้นค้าง',
  usage: 'นับจากยอดผลิตสะสม (ชิ้น) — ตั้งเกณฑ์ที่ช่อง usage_threshold',
};

/** ค่าแนะนำ: จอดเกิน 30 วัน = ต้องตรวจก่อนเริ่มเดินใหม่ (ค่าเริ่มต้นที่ seed ให้แผน run_day) */
export const DEFAULT_MAX_IDLE_DAYS = 30;

/** ฐานของแผนนี้ — คอลัมน์มี `not null default 'calendar'` ⇒ ห้ามเช็ค truthiness (กฎเหล็ก OBEYA) */
export const basisOf = (plan) => {
  const b = plan?.cycle_basis;
  return b === CYCLE_BASIS.RUN_DAY || b === CYCLE_BASIS.USAGE ? b : CYCLE_BASIS.CALENDAR;
};

/* ── ตัวช่วยวันที่ (สตริง YYYY-MM-DD ล้วน ไม่แตะ timezone เครื่อง) ─────────────── */
const ymd10 = (v) => (v ? String(v).slice(0, 10) : null);
const utcOf = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
/** ห่างกันกี่วัน (to − from) — UTC ล้วน ปลอดภัยเพราะไม่ได้อ่านเวลาปัจจุบัน */
export const diffDays = (from, to) => Math.round((utcOf(ymd10(to)) - utcOf(ymd10(from))) / 86400000);

/** ชื่อไลน์ให้เทียบแบบเดียวกับ `pmUsage.js` (กันเว้นวรรค/ตัวพิมพ์ไม่ตรง) */
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * ดึง "วันที่ครอบครัวไลน์นี้เดินจริง" ออกจากยอดรายไลน์รายวัน (RPC `pm_usage_daily`)
 *
 * @param rows  [{ line_name, work_date, qty, orders }]
 * @param lines ชื่อไลน์ที่นับรวม — **กางครอบครัวมาแล้ว** (ดูกับดักข้อ 2)
 * @returns ['YYYY-MM-DD', …] เรียงจากน้อยไปมาก (ไม่ซ้ำ)
 *
 * ⚠️ "เดิน" = มีใบผลิตของวันนั้น (RPC กรองใบ `confirmed` มาแล้ว) ไม่ใช่ "ยอด > 0"
 *    ใบที่ปิดยอด 0 ก็ยังแปลว่าเครื่องถูกเปิดใช้ ⇒ ต้องตรวจ
 */
export function runDaysOf(rows, lines = null) {
  if (!Array.isArray(rows)) return null;       // ไม่รู้ ≠ ไม่เดิน (กับดักข้อ 1)
  const set = lines ? new Set([...lines].map(norm)) : null;
  const days = new Set();
  for (const r of rows) {
    if (set && !set.has(norm(r?.line_name))) continue;
    const d = ymd10(r?.work_date);
    if (d) days.add(d);
  }
  return [...days].sort();
}

/* สถานะเพิ่มจาก `STATUS_META` เดิมใน `src/lib/pmSchedule.js`
   🔴 `idle_skip` = **เทา ไม่ใช่เขียว** — "ไม่ได้ผลิตเลยไม่ต้องตรวจ" คนละเรื่องกับ "ตรวจแล้วผ่าน"
      และ **ห้ามนับในตัวหารของ %compliance** ไม่งั้น KPI จะสวยขึ้นเพราะวันหยุด */
export const IDLE_STATUS = 'idle_skip';

/** สถานะนี้นับเข้า %ความครบถ้วนของการตรวจไหม (ตัวหาร) */
export const countsForCompliance = (status) => status !== IDLE_STATUS && status !== 'periodic';

/**
 * ตัดสินว่า "แผนนี้ต้องตรวจหรือยัง" เมื่อรอบนับจากวันเดินเครื่อง
 *
 * @param intervalDays  รอบ = ทุกกี่ **วันเดิน** (1 = ทุกวันที่เดิน)
 * @param maxIdleDays   จอดเกินกี่วันปฏิทินแล้วบังคับตรวจรอบแรกที่กลับมาเดิน (null = ไม่บังคับ)
 * @param lastYmd       วันที่ตรวจล่าสุด 'YYYY-MM-DD' (null = ไม่เคยตรวจ)
 * @param runDays       วันที่เดินจริง จาก `runDaysOf()` — **`null` = ยังไม่รู้** (ดูกับดักข้อ 1)
 * @param todayStr      วันนี้ 'YYYY-MM-DD' (ผู้เรียกส่งมา — เทสตรึงค่าได้)
 * @param windowFromYmd วันแรกที่ข้อมูลยอดผลิตครอบคลุม (ใช้ตอบ "ไม่เดินเลยอย่างน้อยกี่วัน")
 */
export function resolveRunDayDue({
  intervalDays, maxIdleDays = null, lastYmd = null, runDays = null, todayStr, windowFromYmd = null,
} = {}) {
  const need = Number(intervalDays);
  const base = {
    basis: CYCLE_BASIS.RUN_DAY,
    dueYmd: null,          // 🔴 รอบนี้ไม่มี "วันครบกำหนด" แบบปฏิทิน — จอต้องเขียนเป็นเงื่อนไข
    ranSince: null, ranToday: false, lastRunYmd: null,
    idleDays: null, idleAtLeast: false, restartGapDays: null, restartGapAtLeast: false,
    overdueRunDays: null, mustCheckBeforeRestart: false,
    unknownUsage: false,
  };

  if (!todayStr) return { ...base, status: 'periodic', countsForKpi: false };
  if (!Number.isFinite(need) || need <= 0) return { ...base, status: 'periodic', countsForKpi: false };

  // ── ไม่รู้ว่าเดินไหม → ห้ามเดาว่า "ไม่เดิน" · ถอยไปใช้รอบปฏิทิน แล้วบอกจอว่าไม่รู้ ──
  if (runDays == null) {
    const over = lastYmd ? diffDays(lastYmd, todayStr) - need : null;
    const status = !lastYmd ? 'never' : over > 0 ? 'overdue' : over === 0 ? 'due_soon' : 'ok';
    return { ...base, unknownUsage: true, status, countsForKpi: countsForCompliance(status) };
  }

  const today = ymd10(todayStr);
  const last = ymd10(lastYmd);
  const upTo = runDays.filter(d => d <= today);
  const lastRunYmd = upTo.length ? upTo[upTo.length - 1] : null;
  const ranToday = lastRunYmd === today;

  // นับ "วันเดินหลังตรวจล่าสุด" — exclusive ที่วันตรวจ (วันที่ตรวจถือเป็นรอบก่อนหน้า
  // กติกาเดียวกับ `sumUsage` ใน pmUsage.js ห้ามให้ 2 ไฟล์นับคนละแบบ)
  const ranSince = last ? upTo.filter(d => d > last).length : upTo.length;

  // "จอดมากี่วัน" มี 2 ความหมาย ห้ามใช้ตัวเดียวตอบทั้งคู่ (เคยเขียนรวมแล้วเทสจับได้):
  //   · `idleDays`        = หยุดต่อเนื่อง**จนถึงวันนี้** (เดินวันนี้ = 0) → ใช้เขียนป้ายเทา
  //   · `restartGapDays`  = ช่วงหยุด**ก่อนหน้าการเดินล่าสุด** → ใช้ตัดสิน "ต้องตรวจก่อนเริ่มใหม่"
  let idleDays = null, idleAtLeast = false;
  if (lastRunYmd) idleDays = diffDays(lastRunYmd, today);
  else if (windowFromYmd) { idleDays = diffDays(windowFromYmd, today); idleAtLeast = true; }

  let restartGapDays = null, restartGapAtLeast = false;
  if (lastRunYmd) {
    const prevRun = upTo.filter(d => d < lastRunYmd).pop() ?? null;
    // 🔴 นับจาก "ครั้งหลังสุดที่มีคนดูเครื่อง" — เดินครั้งก่อน **หรือ** วันที่ตรวจ แล้วแต่อันไหนใหม่กว่า
    //    (ถูกตรวจระหว่างจอดอยู่แล้ว = ความต้องการนี้ถือว่าถูกตอบแล้ว ไม่ต้องบังคับซ้ำ)
    const anchor = [prevRun, last].filter(Boolean).sort().pop() ?? windowFromYmd ?? null;
    if (anchor) { restartGapDays = diffDays(anchor, lastRunYmd); restartGapAtLeast = !prevRun && !last; }
  }

  const maxIdle = Number(maxIdleDays);
  const hasMaxIdle = Number.isFinite(maxIdle) && maxIdle > 0;
  // เดินวันนี้ → ดูช่วงที่จอดมาก่อนหน้า · ยังจอดอยู่ → ดูว่าจอดมานานเกินเพดานหรือยัง (ธงล่วงหน้า)
  const gauge = ranToday ? restartGapDays : idleDays;
  const mustCheckBeforeRestart = hasMaxIdle && gauge != null && gauge >= maxIdle;

  const out = { ...base, ranSince, ranToday, lastRunYmd, idleDays, idleAtLeast,
                restartGapDays, restartGapAtLeast, mustCheckBeforeRestart };

  // ── ยังไม่เคยตรวจ ──────────────────────────────────────────────────────────
  if (!last) {
    // ไม่เคยเดินเลย = ยังไม่ถึงคิวต้องตรวจ (ไม่ใช่ "ค้างมาตั้งแต่เปิดระบบ")
    if (ranSince === 0) return { ...out, status: IDLE_STATUS, countsForKpi: false };
    return { ...out, overdueRunDays: ranSince - need, status: 'never', countsForKpi: true };
  }

  // ── ครบรอบแล้ว (เดินครบจำนวนวันที่ตั้งไว้) ────────────────────────────────
  if (ranSince >= need) {
    const overdueRunDays = ranSince - need;
    return {
      ...out, overdueRunDays,
      status: overdueRunDays > 0 ? 'overdue' : 'due_soon',
      countsForKpi: true,
    };
  }

  // ── ยังไม่ครบรอบ ──────────────────────────────────────────────────────────
  // กลับมาเดินหลังจอดนานเกินเพดาน = ต้องตรวจก่อน แม้รอบยังไม่ครบ (กับดักข้อ 3)
  if (mustCheckBeforeRestart && ranToday) {
    return { ...out, overdueRunDays: 0, status: 'due_soon', countsForKpi: true };
  }
  if (ranToday) return { ...out, overdueRunDays: ranSince - need, status: 'ok', countsForKpi: true };

  // วันนี้ไม่ได้ผลิต → ไม่ต้องตรวจ และ **ไม่นับเข้า KPI**
  return { ...out, status: IDLE_STATUS, countsForKpi: false };
}

/** ข้อความสั้นบนแถว/ชิป — จอต้องบอกเสมอว่าตัดสินจากอะไร ห้ามโชว์แค่สี */
export function runDayText(res) {
  if (!res || res.basis !== CYCLE_BASIS.RUN_DAY) return null;
  if (res.unknownUsage) return 'ยังไม่รู้ยอดผลิต — ใช้รอบปฏิทินไปก่อน';
  if (res.status === IDLE_STATUS) {
    const idle = res.idleDays == null ? null : `${res.idleAtLeast ? 'อย่างน้อย ' : ''}${res.idleDays} วัน`;
    return idle ? `ไม่ได้ผลิต ${idle} — ไม่ต้องตรวจ` : 'ไม่ได้ผลิต — ไม่ต้องตรวจ';
  }
  if (res.status === 'overdue') return `ค้าง ${res.overdueRunDays} วันเดินเครื่อง`;
  if (res.status === 'due_soon') {
    if (!res.mustCheckBeforeRestart) return 'ถึงรอบตรวจวันนี้';
    const gap = res.ranToday ? res.restartGapDays : res.idleDays;
    const at = res.ranToday ? res.restartGapAtLeast : res.idleAtLeast;
    return `กลับมาเดินหลังจอด ${at ? 'อย่างน้อย ' : ''}${gap} วัน — ต้องตรวจก่อนเริ่ม`;
  }
  if (res.status === 'never') return `เดินมาแล้ว ${res.ranSince} วัน ยังไม่เคยตรวจ`;
  return `เดินมาแล้ว ${res.ranSince} วันตั้งแต่ตรวจล่าสุด`;
}
