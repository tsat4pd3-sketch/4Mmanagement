/* ═══════════════════════════════════════════════════════════════════════════
   ⏱️ "ไลน์หยุด 1 ครั้ง แบ่งเป็น 4 ช่วง ใครถือช่วงไหน" — pure        2026-11-11

   คำสั่ง user (วาดไดอะแกรมมาให้ + เคาะชื่อ):
     Run │ ① ก่อนเรียกช่าง │ ② MTTA │ ③ TTR │ ④ คืนไลน์ (Restart) │ Run again
         ↑Line stop       ↑Call MTN      ↑Repair Done        ↑ไลน์เดินอีกครั้ง
     · **M/C Breakdown = Line stop → Repair Done** (①+②+③)  ← ตามที่ user วาด
     · **Line stop     = Line stop → Run again**  (①+②+③+④) ← ของฝ่ายผลิต รับเต็ม

   🔑 ไฟล์นี้คือ **คำศัพท์ชุดเดียวของทั้งระบบ** — จอ/ใบพิมพ์/สรุป ห้ามตั้งชื่อช่วงเองซ้ำ
      (ก่อนหน้านี้กล่อง KPI ในใบเรียกช่วง `report_at→repair_done_at` ว่า "หยุดรวม (Breakdown)"
       ซึ่งชวนอ่านว่าเป็นเวลาที่ไลน์หยุด ทั้งที่เป็นนาฬิกาฝั่งช่างล้วน — เป็นต้นเหตุที่หน้างาน
       สับสนว่า 16 นาที กับ 30 นาที อันไหนคือ Machine Breakdown)

   ── stamp ที่ใช้ (วัดยืนยันกับฐานจริง 990 ใบ/90 วัน) ────────────────────────
     Line stop     = `downtime_logs.started_at`
     Call MTN      = `downtime_logs.call_mtn_at`      ≈ `mtn_orders.report_at` (ค่ากลางต่างกัน 0.0 นาที)
     ช่างรับงาน     = `downtime_logs.call_mtn_ack_at`  ≈ `mtn_orders.accept_at` (ค่ากลางต่างกัน 0.0 นาที)
     Repair Done   = `mtn_orders.repair_done_at`
     Run again     = `downtime_logs.ended_at`
   ⚠️ `mtn_orders.occurred_at` **ใช้เป็นฐานไม่ได้** — มีคนกรอกแค่ 57/990 ใบ (5.8%)

   ── 🔴 กฎของไฟล์นี้ ────────────────────────────────────────────────────────
   1. **ไม่รู้ = `null` ห้ามเป็น 0** (0 = "ช่วงนี้ไม่กินเวลา" คนละเรื่องกับ "ไม่มี stamp")
   2. **เวลาย้อนหลัง = ไม่สอดคล้อง ไม่ใช่ติดลบ** — 34% ของใบกดปุ่มหลังไลน์เดินไปแล้ว
      ⇒ ช่วงที่คำนวณออกมาติดลบต้องคืน `null` + ธง `outOfOrder` ให้จอเขียนบอก **ห้ามปัดเป็น 0 เงียบ**
   3. **M/C Breakdown คิดจาก 2 ปลาย (lineStop → repairDone) ไม่ใช่บวก 3 ช่วง** — ช่วงกลางหาย
      1 ช่วงแล้วยังตอบได้ · และ **ห้ามเกิน Line stop** (ใบที่กดย้อนหลังจะล้น)
   4. **pure ทั้งไฟล์** (ไม่ import supabase/DOM) · รับ ms หรือสตริงเวลาได้
   ═══════════════════════════════════════════════════════════════════════════ */

const ms = (v) => {
  if (v == null || v === '') return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};
const minBetween = (a, b) => {
  const x = ms(a), y = ms(b);
  if (x == null || y == null) return null;
  return (y - x) / 60000;
};

/** ทะเบียนช่วง — ลำดับนี้คือลำดับบนแถบ · `owner` = ฝั่งที่ถือเวลาช่วงนั้น */
export const MO_SEGMENTS = Object.freeze([
  { key: 'precall', label: 'ก่อนเรียกช่าง',      owner: 'prod', hint: 'เครื่องหยุดแล้วแต่ยังไม่ได้กดเรียกช่าง' },
  { key: 'mtta',    label: 'MTTA — รอช่างรับงาน', owner: 'mtn',  hint: 'กดเรียกช่าง → ช่างกดรับงาน' },
  { key: 'ttr',     label: 'TTR — เวลาซ่อม',      owner: 'mtn',  hint: 'ช่างรับงาน → ช่างกดซ่อมเสร็จ' },
  { key: 'restart', label: 'คืนไลน์ (Restart)',   owner: 'prod', hint: 'ซ่อมเสร็จ → ไลน์เดินอีกครั้ง (เก็บเครื่องมือ · QA CF · เดินทดลอง)' },
]);

export const segMeta = (key) => MO_SEGMENTS.find(s => s.key === key) || null;

/**
 * แบ่งไลน์หยุด 1 ครั้งเป็น 4 ช่วง
 * @param {object} t stamp ทั้ง 5 จุด (ms / ISO / Date) + `lineStopMin` (= `duration_min` ถ้ามี)
 * @returns {{
 *   segs: Array<{key,label,owner,hint,min:number|null,known:boolean}>,
 *   lineStopMin: number|null,      // ①+②+③+④ — ของฝ่ายผลิต (ใช้ duration_min ก่อนเสมอ)
 *   mcBreakdownMin: number|null,   // ①+②+③  — "M/C Breakdown" ตามที่ user วาด
 *   restartMin: number|null,       // ④ คืนไลน์
 *   outOfOrder: boolean,           // มี stamp ที่ย้อนหลัง (กดปุ่มตามหลัง) = เชื่อการแบ่งช่วงไม่ได้
 *   missing: string[],             // ชื่อ stamp ที่ขาด — จอต้องเขียนบอก
 * }}
 *
 * 🔴 `lineStopMin` ใช้ `duration_min` ที่ฝ่ายผลิตลงไว้ก่อนเสมอ — **ห้ามคิดใหม่จาก started/ended**
 *    (นั่นคือเลขที่ KPI ทางการใช้ · คิดเองจะได้คนละเลขกับบอร์ด)
 */
export function moTimeline(t = {}) {
  /* รับของเข้าแปลกๆ ได้ (null / สตริง / ตัวเลข) — จอส่งค่าที่โหลดไม่สำเร็จมาได้เสมอ */
  const o = t && typeof t === 'object' ? t : {};
  const { lineStopAt, callAt, ackAt, repairDoneAt, runAgainAt } = o;
  const missing = [];
  if (ms(lineStopAt) == null) missing.push('เวลาเครื่องเริ่มหยุด');
  if (ms(callAt) == null) missing.push('เวลากดเรียกช่าง');
  if (ms(ackAt) == null) missing.push('เวลาช่างรับงาน');
  if (ms(repairDoneAt) == null) missing.push('เวลาซ่อมเสร็จ');
  if (ms(runAgainAt) == null) missing.push('เวลาไลน์เดินอีกครั้ง');

  const raw = {
    precall: minBetween(lineStopAt, callAt),
    mtta: minBetween(callAt, ackAt),
    ttr: minBetween(ackAt, repairDoneAt),
    restart: minBetween(repairDoneAt, runAgainAt),
  };
  /* กฎ 2 — ติดลบ = stamp ไม่เรียงตามจริง (กดปุ่มย้อนหลัง) ⇒ ไม่รู้ ห้ามปัดเป็น 0 */
  const outOfOrder = Object.values(raw).some(v => v != null && v < 0);
  const segs = MO_SEGMENTS.map(s => {
    const v = raw[s.key];
    const ok = v != null && v >= 0;
    return { ...s, min: ok ? v : null, known: ok };
  });

  /* กฎ 3 — คิดจาก 2 ปลาย แล้วตัดไม่ให้เกิน Line stop */
  const lineStopMin = o.lineStopMin != null && Number.isFinite(Number(o.lineStopMin))
    ? Number(o.lineStopMin)
    : minBetween(lineStopAt, runAgainAt);
  let mc = minBetween(lineStopAt, repairDoneAt);
  if (mc != null && mc < 0) mc = null;
  if (mc != null && lineStopMin != null && mc > lineStopMin) mc = lineStopMin;

  return {
    segs,
    lineStopMin: lineStopMin != null && lineStopMin >= 0 ? lineStopMin : null,
    mcBreakdownMin: mc,
    restartMin: segs.find(s => s.key === 'restart')?.min ?? null,
    outOfOrder,
    missing,
  };
}

/**
 * "ชั่วโมงเสียแบบ M/C Breakdown" ของ downtime 1 แถว — ใช้ตอนรวมยอดรายเดือน
 * @param {number|null} lineStopMin นาทีที่ไลน์หยุด (`duration_min`)
 * @param {number|null} restartMin  นาที ④ (null = ไม่มีใบ MO ⇒ ไม่รู้)
 * @returns {{min:number|null, trimmed:boolean}} `trimmed` = ตัด ④ ออกได้จริงไหม
 *
 * 🔴 **ไม่รู้ ④ = ไม่ตัด** (ใช้เวลาเต็ม) — ห้ามเดาว่าเป็น 0 แล้วตัดมั่ว
 *    ⚠️ ผลคือเหตุการณ์ที่ "มีใบ MO" ถูกตัด ส่วนที่ "ไม่มีใบ" ไม่ถูกตัด
 *       ⇒ **จอต้องเขียนว่าตัดได้กี่ครั้งจากกี่ครั้ง** ไม่งั้นอ่านเหมือนทุกครั้งคิดเกณฑ์เดียวกัน
 *       (และยิ่งเปิดใบ MO เยอะ ชั่วโมงยิ่งลด — เป็นผลข้างเคียงที่ต้องรู้ตัว)
 */
export function mcBreakdownMinOf(lineStopMin, restartMin) {
  const base = lineStopMin != null && Number.isFinite(Number(lineStopMin)) ? Number(lineStopMin) : null;
  if (base == null) return { min: null, trimmed: false };
  if (restartMin == null || !Number.isFinite(Number(restartMin)) || Number(restartMin) <= 0) {
    return { min: base, trimmed: false };
  }
  return { min: Math.max(0, base - Number(restartMin)), trimmed: true };
}
