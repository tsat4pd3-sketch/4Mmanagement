/* ══ ⏱️ timeRange — มาตรฐานกลางของ "ตัวกรองช่วงเวลา" ทุกหน้า (pure · 2026-09-23 · คำสั่ง user) ══
 *
 * ═══ ทำไมต้องมี ═════════════════════════════════════════════════════════════════════
 * สำรวจ 23/09: **18 ไฟล์มีตัวกรองเวลา แต่เป็น 4 แบบที่เข้ากันไม่ได้เลย**
 *   · `/oee-analytics`  → ปุ่มสเกล `daily|weekly|monthly|yearly` + from/to  (ไม่มีปุ่มย้อนหลัง)
 *   · จอ SQDCM          → `period` = `week|month|year`                      (ไม่มี "วัน" ไม่มี from/to)
 *   · `/mtn-analysis`   → dropdown `days` = 30/60/90                        (ไม่มีสเกล ไม่มี from/to)
 *   · QualityControl · WorkforceInsight · Energy · OrderTrace … → from/to เปล่า (ไม่มีสเกล)
 * ⇒ คนหน้างานย้ายหน้าทีก็ต้องเรียนรู้ตัวกรองใหม่ทุกครั้ง · และ**คำเดียวกันคนละความหมาย**
 *   (`period` ที่ OEE = ขนาดถัง · `period` ที่ SQDCM = ช่วงที่ดู)
 *
 * คำสั่ง user 23/09: *"ระบบการกรองช่วงเวลา อยากไห้เป็นมาตรฐานเดียวกัน มีเหมือนกันทุกหน้า
 * คือ เลือกสเกลที่จะดู รายวัน สัปดาห์ เดือน ปี และกรอบเวลา และ scope 30วันย้อนหลัง 60 90 120"*
 *
 * ═══ โครง 3 ชั้น — แยกกันชัดๆ ห้ามปนกัน ════════════════════════════════════════════
 *   1. **ถัง (bucket · ตัวแปรชื่อ `scale`)** = ขนาดแท่งในกราฟ — ชั่วโมง / วัน / สัปดาห์ / เดือน / ปี
 *   2. **กรอบเวลา (from–to)** = ช่วงที่ดึงข้อมูล — แก้เองได้เสมอ
 *   3. **ปุ่มลัด** = เติม from–to ให้เร็วๆ · มี 2 ชุด: **ช่วง** (วันนี้/สัปดาห์นี้/เดือนนี้/ปีนี้)
 *      และ **ย้อนหลัง** (30/60/90/120 วัน)
 *      ⚠️ ปุ่มลัด **เขียนทับ from–to แล้วจบ** ไม่ใช่โหมดค้าง — คนแก้วันต่อได้ทันที
 *      (โหมดค้างทำให้เกิดคำถาม "ทำไมกดวันแล้วเด้งกลับ")
 *
 * ═══ 🪜 บันไดความละเอียด — "ดูช่วงไหน ⇒ แท่งเล็กกว่า 1 ขั้น" (23/09 · คำสั่ง user) ═══════
 *   *"อยากดูแบบเจาะวันโชว์สเกลชั่วโมง ดูสัปดาห์หรือเดือนสเกลรายวัน ดูรายปีสเกลเดือน
 *     อนาคตข้อมูลเยอะๆ หลายปี ดู progressive สเกลปีได้"*
 *   เป็นหลักสากล (drill-down granularity) — ช่วงกับแท่งต้องห่างกัน 1 ขั้นเสมอ ไม่งั้นได้
 *   **แท่งเดียว** (ไร้ความหมาย) หรือ **700 แท่ง** (อ่านไม่ออก)
 *     วันนี้→ชั่วโมง(24) · สัปดาห์นี้→วัน(7) · เดือนนี้→วัน(28-31) · ปีนี้→เดือน(12) · หลายปี→ปี
 *   ช่วงที่พิมพ์วันเอง/ปุ่มย้อนหลัง = ไม่มี "ชื่อช่วง" ⇒ ไล่บันไดตามจำนวนวันแทน (`autoBucket`)
 *
 *   🔴 **ออโต้เป็นค่าเริ่มต้น แต่คนต้อง override ได้** (`stepBucket`) — 3 เคสจริงที่ออโต้ล้วนไม่พอ:
 *      เดือน→วัน 30 แท่งกระโดดจนดูเทรนด์ไม่ออก · จอ TV ดูไกลต้องหยาบกว่าจอ PC ·
 *      ใบ KPI ของกลุ่มเป็น**รายเดือน** ปรับกลับไม่ได้ = เอาเลขไปเทียบใบจริงไม่ได้
 *   🔴 **เลือกเองแล้วห้ามออโต้มาทับ** — `nextBucket()` ตามให้เฉพาะตอนที่ค่าปัจจุบัน "ยังเป็นค่าออโต้อยู่"
 *   🔴 **จอต้องเขียนว่าตอนนี้ "แท่งละ 1 วัน"** ไม่งั้นคนอ่านกราฟผิดโดยไม่รู้ตัว (กฎความซื่อสัตย์ของจอ)
 *   🔴 **แต่ละจอมีเพดานความละเอียดของตัวเอง** (`capBucket` + prop `finest`) — ข้อมูลบางชุดไม่มีเวลา:
 *      มีเวลา (ทำชั่วโมงได้): `downtime_logs.started_at` · `defect_logs.logged_at` · `prod_orders.opened_at` · ใบ MO
 *      ไม่มี: `production_sessions` = work_date+กะ (**OEE ละเอียดสุด = วัน**) ·
 *             `daily_production_logs` = วัน · KPI/พลังงาน = เดือน
 *      ⇒ ขอชั่วโมงจากจอที่ทำไม่ได้ ต้อง**หยาบให้ + เขียนบนจอว่าทำไม** ห้ามโชว์แท่งเดียวเงียบๆ
 *
 * 🔴 **กฎความซื่อสัตย์: สเกลที่ไม่เข้ากับกรอบเวลา ต้องบอกบนจอ ห้ามวาดกราฟหลอกๆ**
 *    รายปี บนช่วง 30 วัน = แท่งเดียว · รายวัน บนช่วง 2 ปี = 730 แท่งอ่านไม่ออก
 *    ⇒ `scaleWarning()` คืนข้อความให้จอเอาไปแสดง (เตือนเท่านั้น **ห้ามบล็อก** — บางทีคนตั้งใจ)
 *
 * ⚠️ ไฟล์นี้ **pure ล้วน** — ห้าม import supabase/DOM/React · รับวันที่เป็นสตริง `YYYY-MM-DD`
 *    ที่ผู้เรียก resolve เป็น "วันทำงาน" มาแล้ว (ผ่าน getWorkDate) ⇒ ไม่มีกับดัก timezone ในนี้
 *    (กฎ CLAUDE.md: ห้าม `new Date().toISOString()` หาวันที่งาน)
 */

import { WORK_DAY_START_HOUR } from './workDate.js';

/* ── 1) สเกล ──────────────────────────────────────────────────────────────────────
   `okDays` = ช่วงกว้าง (จำนวนวัน) ที่สเกลนี้ "อ่านรู้เรื่อง" — ใช้เตือนเท่านั้น ไม่ได้บังคับ
   ตัวเลขมาจากจำนวนแท่งที่ยังอ่านออกบนจอ TV 43" (ประมาณ 4–60 แท่ง) */
export const TIME_SCALES = [
  { key: 'hour',  label: 'รายชั่วโมง',  short: 'ชั่วโมง', okDays: [1, 3] },
  { key: 'day',   label: 'รายวัน',      short: 'วัน',     okDays: [1, 120] },
  { key: 'week',  label: 'รายสัปดาห์',  short: 'สัปดาห์', okDays: [14, 540] },
  { key: 'month', label: 'รายเดือน',    short: 'เดือน',   okDays: [60, 1830] },
  { key: 'year',  label: 'รายปี',       short: 'ปี',      okDays: [730, 36500] },
];
export const scaleOf = (key) => TIME_SCALES.find(s => s.key === key) || null;
/* ── 1.1) 🪜 บันไดความละเอียด ────────────────────────────────────────────────────── */
/** ละเอียด → หยาบ · ลำดับนี้คือ "ขั้น" ที่ปุ่ม ละเอียดขึ้น/หยาบลง เดินไปมา */
export const BUCKET_ORDER = ['hour', 'day', 'week', 'month', 'year'];
export const bucketIndex = (b) => BUCKET_ORDER.indexOf(b);

/** หยาบกว่าหรือเท่ากับ `finest` เสมอ — จอที่ข้อมูลไม่มีเวลา ขอชั่วโมงไม่ได้ */
export function capBucket(bucket, finest = 'day', coarsest = 'year') {
  const i = bucketIndex(bucket); if (i < 0) return finest;
  const lo = Math.max(0, bucketIndex(finest));
  const hi = bucketIndex(coarsest) < 0 ? BUCKET_ORDER.length - 1 : bucketIndex(coarsest);
  return BUCKET_ORDER[Math.min(Math.max(i, lo), Math.max(lo, hi))];
}

/** เดินขึ้น/ลงบันได 1 ขั้น (`dir` = -1 ละเอียดขึ้น · +1 หยาบลง) — ชนเพดานแล้วคืนค่าเดิม */
export function stepBucket(bucket, dir, { finest = 'day', coarsest = 'year' } = {}) {
  const i = bucketIndex(bucket); if (i < 0) return capBucket(bucket, finest, coarsest);
  return capBucket(BUCKET_ORDER[Math.min(BUCKET_ORDER.length - 1, Math.max(0, i + (dir > 0 ? 1 : -1)))],
    finest, coarsest);
}

/* ── 1.2) ช่วงที่มี "ชื่อ" — ปุ่มลัดที่ล็อกขนาดแท่งมาด้วย ─────────────────────────────
   🔴 `multi` (หลายปี) **ต้องเปิดเฉพาะจอที่มี RPC rollup ฝั่งเซิร์ฟเวอร์แล้ว** —
      กฎเหล็ก CLAUDE.md: *โหมดปีห้ามโหลดแถวดิบ* · downtime 3 ปี = แสนแถวลง browser
      = egress ระเบิด (เคยทำ Supabase ล็อกทั้ง organization มาแล้ว ทั้งโรงงาน login ไม่ได้) */
export const TIME_PERIODS = [
  { key: 'day',   label: 'วันนี้',      bucket: 'hour'  },
  { key: 'week',  label: 'สัปดาห์นี้',  bucket: 'day'   },
  { key: 'month', label: 'เดือนนี้',    bucket: 'day'   },
  { key: 'year',  label: 'ปีนี้',       bucket: 'month' },
  { key: 'multi', label: 'หลายปี',      bucket: 'year', heavy: true },
];
export const periodOf = (key) => TIME_PERIODS.find(p => p.key === key) || null;

/**
 * ช่วงของปุ่ม — **ปลายทางตัดที่ "วันนี้" เสมอ ไม่ลากไปอนาคต**
 * (เดือนนี้วันที่ 23 = 23 แท่ง ไม่ใช่ 30 แท่งที่ว่าง 7 อัน — แท่งว่างอ่านเป็น "ผลิตได้ 0")
 */
export function periodRange(key, today) {
  if (!isDateStr(today)) return null;
  const y = today.slice(0, 4);
  if (key === 'day')   return { from: today, to: today };
  if (key === 'week')  return { from: weekMonday(today), to: today };
  if (key === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (key === 'year')  return { from: `${y}-01-01`, to: today };
  if (key === 'multi') return { from: `${+y - 2}-01-01`, to: today };
  return null;
}

/** ช่วงนี้ตรงกับปุ่มช่วงตัวไหนพอดีไหม (ไว้ไฮไลต์) — ไม่ตรงเป๊ะ = null */
export function matchPeriod(from, to, today) {
  for (const p of TIME_PERIODS) {
    const r = periodRange(p.key, today);
    if (r && r.from === from && r.to === to) return p.key;
  }
  return null;
}

/* ── 1.3) ออโต้เลือกขนาดแท่งจากความกว้างของช่วง ───────────────────────────────────
   เกณฑ์ = "จำนวนแท่งที่ยังอ่านออกบนจอ TV 43 นิ้ว" (ประมาณ 7–60 แท่ง)
   ⚠️ ต่างจาก `suggestScale()` เดิมที่ตอบ "สเกลไหนพอดี" — ตัวนี้คือ **ขั้นบันได** ซึ่งมี `hour` ด้วย */
export function autoBucket(from, to) {
  const n = rangeDays(from, to);
  if (n == null) return 'day';
  if (n <= 2) return 'hour';     // 1-2 วัน → 24-48 แท่ง
  if (n <= 45) return 'day';     // ถึง ~6 สัปดาห์ → ≤45 แท่ง
  if (n <= 400) return 'week';   // ถึง ~13 เดือน → ≤57 แท่ง
  if (n <= 1830) return 'month'; // ถึง 5 ปี → ≤60 แท่ง
  return 'year';
}

/**
 * ขนาดแท่งถัดไปเมื่อช่วงเวลาเปลี่ยน — **หัวใจของ "ออโต้แต่ override ได้"**
 * · กดปุ่มช่วง (`period`) → ใช้ขนาดแท่งของปุ่มนั้นเสมอ (คนเลือก "มุมมอง" ใหม่)
 * · เปลี่ยนวันเอง → ตามออโต้ **เฉพาะเมื่อค่าปัจจุบันยังเป็นค่าออโต้ของช่วงเดิมอยู่**
 *   ⇒ คนที่กด "หยาบลง" ไว้ แล้วขยับวันปลายทาง 1 วัน **ต้องไม่ถูกดีดกลับ** (เคยเป็นคำถามซ้ำๆ
 *     กับปุ่มลัดย้อนหลังมาแล้ว — ดูข้อ 3 ของโครง 3 ชั้น)
 */
export function nextBucket({ curBucket, prevFrom, prevTo, from, to, period = null,
  finest = 'day', coarsest = 'year' } = {}) {
  const cap = (b) => capBucket(b, finest, coarsest);
  if (period) return cap(periodOf(period)?.bucket || autoBucket(from, to));
  const wasAuto = !curBucket || curBucket === cap(autoBucket(prevFrom, prevTo));
  return wasAuto ? cap(autoBucket(from, to)) : cap(curBucket);
}
export const scaleLabel = (key) => scaleOf(key)?.label || '';

/** ปุ่มลัด "ย้อนหลัง N วัน" — ชุดมาตรฐานตามคำสั่ง user 23/09 */
export const LOOKBACK_DAYS = [30, 60, 90, 120];

/* ── 2) คณิตวันที่แบบสตริง (ไม่แตะ timezone) ─────────────────────────────────────── */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDateStr = (s) => typeof s === 'string' && DATE_RE.test(s);

/** `YYYY-MM-DD` → จำนวนวันนับจาก epoch (UTC ล้วน — ใช้เทียบ/บวกลบเท่านั้น ไม่ใช่เวลาแสดงผล) */
const toDay = (s) => {
  if (!isDateStr(s)) return null;
  return Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
};
const fromDay = (n) => {
  const d = new Date(n * 86400000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};

/** บวก/ลบวันจากสตริงวันที่ — `addDays('2026-03-01', -1)` = `'2026-02-28'` */
export const addDays = (dateStr, n) => {
  const d = toDay(dateStr);
  return d == null ? null : fromDay(d + n);
};

/** จำนวนวันในช่วง **นับหัวนับท้าย** (`from` = `to` ⇒ 1 วัน ไม่ใช่ 0) */
export function rangeDays(from, to) {
  const a = toDay(from), b = toDay(to);
  if (a == null || b == null) return null;
  return Math.abs(b - a) + 1;
}

/** from > to = คนเลือกสลับกัน → สลับกลับให้ (ห้ามคืนช่วงว่างเงียบๆ แล้วให้จอขึ้น "ไม่มีข้อมูล") */
export function normalizeRange(from, to) {
  if (!isDateStr(from) || !isDateStr(to)) return { from: from || null, to: to || null, swapped: false };
  if (toDay(from) <= toDay(to)) return { from, to, swapped: false };
  return { from: to, to: from, swapped: true };
}

/**
 * ปุ่มลัด "ย้อนหลัง N วัน" → กรอบเวลา
 * **นับหัวนับท้าย**: 30 วันย้อนหลังจาก 23/09 = 25/08 ถึง 23/09 (ได้ 30 วันเป๊ะ ไม่ใช่ 31)
 * @param days  จำนวนวัน (ต้อง ≥ 1)
 * @param today วันสุดท้ายของช่วง = **วันทำงานวันนี้** (ผู้เรียกส่ง `getWorkDate()` มา ห้ามให้ util หาเอง)
 */
export function presetRange(days, today) {
  const n = Number(days);
  if (!Number.isFinite(n) || n < 1 || !isDateStr(today)) return null;
  return { from: addDays(today, -(Math.floor(n) - 1)), to: today };
}

/** ช่วงนี้ตรงกับปุ่มลัดตัวไหนพอดีไหม (ไว้ไฮไลต์ปุ่มที่ active) — ไม่ตรงเป๊ะ = null */
export function matchPreset(from, to, today, presets = LOOKBACK_DAYS) {
  if (!isDateStr(to) || to !== today) return null;          // ปุ่มลัดจบที่ "วันนี้" เสมอ
  const n = rangeDays(from, to);
  return presets.includes(n) ? n : null;
}

/* ── 3) ถัง (bucket) ──────────────────────────────────────────────────────────────
   คืน "คีย์ถัง" ที่เรียงตามตัวอักษรแล้วได้ลำดับเวลาถูกต้องเสมอ (เอาไป sort ตรงๆ ได้)
   ⚠️ สัปดาห์ใช้ **ISO-8601** (จันทร์เป็นวันแรก · สัปดาห์ที่ 1 = สัปดาห์ที่มี 4 ม.ค.)
      — มาตรฐานเดียวกับที่ใบรายงานของกลุ่มใช้ · ห้ามเปลี่ยนเป็น "อาทิตย์ขึ้นต้น" เฉพาะบางหน้า */
export function isoWeek(dateStr) {
  const d0 = toDay(dateStr);
  if (d0 == null) return null;
  /* ⚠️ 1970-01-01 เป็น **วันพฤหัส** ⇒ ออฟเซ็ตที่ทำให้ "จันทร์ = 0" คือ +3 ไม่ใช่ +4
     เคยใส่ +4 แล้วทั้งระบบเพี้ยนไป 1 สัปดาห์ (จันทร์ถูกนับเป็นสัปดาห์ก่อนหน้า) — เทสจับได้ 23/09 */
  const dow = ((d0 + 3) % 7 + 7) % 7;
  const thu = d0 - dow + 3;                    // พฤหัสของสัปดาห์นั้น = ตัวกำหนดปี ISO
  const year = +fromDay(thu).slice(0, 4);
  const jan4 = toDay(`${year}-01-04`);
  const jan4dow = ((jan4 + 3) % 7 + 7) % 7;
  const week1Mon = jan4 - jan4dow;
  return { year, week: Math.floor((d0 - dow - week1Mon) / 7) + 1 };
}

/** วันจันทร์ของสัปดาห์ที่วันนี้อยู่ (ISO: จันทร์ขึ้นต้น) — `'YYYY-MM-DD'` */
export function weekMonday(dateStr) {
  const d0 = toDay(dateStr);
  if (d0 == null) return null;
  return fromDay(d0 - (((d0 + 3) % 7 + 7) % 7));
}

/* ── 3.1) ถังชั่วโมง — เวลาไทย + ตัดวันทำงานที่ 08:00 ───────────────────────────────
   🔴 **"24 ชั่วโมงของโรงงาน" ไม่ใช่ 00:00–23:59** — วันทำงานตัดที่ 08:00 และกะดึกข้ามเที่ยงคืน
      ⇒ วันงาน 23/09 = 08:00 ของ 23 → 07:59 ของ 24 · แบ่งตามปฏิทินคือ **ผ่ากะดึกครึ่งหนึ่ง
      ไปอยู่คนละวัน** (บั๊กคลาสเดียวกับที่ CLAUDE.md ห้ามใช้ `toISOString()` หาวันที่งาน)
   🔴 บวก 7 ชม. เองจาก epoch **ห้ามพึ่ง timezone ของเครื่อง** — เซิร์ฟเวอร์/คอนเทนเนอร์เทสเป็น UTC
      ถ้าพึ่ง `getHours()` เทสจะผ่านบนเครื่องไทยแล้วตกบน CI (และกลับกัน) */
const BKK_OFFSET_MS = 7 * 3600000;
const p2 = (x) => String(x).padStart(2, '0');

/** timestamptz (`'2026-09-23T14:05:00Z'`) → คีย์ถังชั่วโมงเวลาไทย `'2026-09-23 21'` */
export function bkkHourKey(ts) {
  if (!ts) return null;
  const ms = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + BKK_OFFSET_MS);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}`;
}

/**
 * แกนชั่วโมงเต็มของช่วงวันทำงาน — `08` ของวันแรก → `07` ของวันถัดจากวันสุดท้าย
 * (ต้องมีครบทุกช่องแม้ไม่มีข้อมูล ไม่งั้นแกนเว้าแหว่งแล้วอ่านเป็น "ชั่วโมงนั้นไม่มีอยู่")
 */
export function hourAxis(from, to = from) {
  if (!isDateStr(from) || !isDateStr(to)) return [];
  const out = [];
  const n = (rangeDays(from, to) || 1) * 24;
  let day = from, h = WORK_DAY_START_HOUR;
  for (let i = 0; i < n && i < 24 * 400; i++) {
    out.push(`${day} ${p2(h)}`);
    h += 1;
    if (h === 24) { h = 0; day = addDays(day, 1); }
  }
  return out;
}

/**
 * คีย์ถัง — เรียงตามตัวอักษรแล้วได้ลำดับเวลาถูกเสมอ
 * 🔴 **สัปดาห์ใช้ "วันที่ของวันจันทร์" ไม่ใช่ `2026-W39`** โดยตั้งใจ:
 *    · เอาไปบวกวันต่อได้ตรงๆ (โค้ดเติมช่องว่างบนแกนเดินทีละ 7 วันจากคีย์)
 *    · ป้ายบนแกนบอกช่วงวันจริง ("21–27/9") ซึ่งหน้างานอ่านรู้เรื่องกว่าเลขสัปดาห์
 *    · เป็นสัปดาห์เดียวกับ ISO เป๊ะ (แค่คนละวิธีเขียน) — ต้องการเลขสัปดาห์ใช้ `isoWeek()` */
export function bucketKey(dateStr, scale) {
  if (!isDateStr(dateStr)) return null;
  /* 🔴 ถังชั่วโมงหาจาก "วันที่" ไม่ได้ — ต้องมี timestamp จริง ⇒ ใช้ `bkkHourKey(ts)` แทน
     คืน null แทนที่จะเดาเป็นรายวัน เพื่อให้จอที่ลืมแปลง **พังให้เห็น ไม่ใช่โชว์เลขผิดเงียบๆ** */
  if (scale === 'hour') return null;
  if (scale === 'day') return dateStr;
  if (scale === 'month') return dateStr.slice(0, 7);
  if (scale === 'year') return dateStr.slice(0, 4);
  if (scale === 'week') return weekMonday(dateStr);
  return null;
}

/**
 * แกนเต็มของช่วง (ทุกถังเรียงเวลา รวมถังที่ไม่มีข้อมูล)
 * 🔴 **ต้องเติมถังว่างเสมอ** — ส่งเฉพาะถังที่มีข้อมูลเข้ากราฟ = สัปดาห์ที่เงียบหายไปจากแกน
 *    แล้วเส้นแนวโน้มลากข้ามช่องว่างเหมือนไม่เคยมีช่วงเงียบ (อ่านเป็น "ไม่เคยหยุดเลย")
 */
export function bucketAxis(from, to, scale) {
  if (scale === 'hour') return hourAxis(from, to);
  if (!isDateStr(from) || !isDateStr(to)) return [];
  const out = [];
  if (scale === 'day' || scale === 'week') {
    const step = scale === 'week' ? 7 : 1;
    let cur = scale === 'week' ? weekMonday(from) : from;
    for (let i = 0; cur && cur <= to && i < 4000; i++) { out.push(cur); cur = addDays(cur, step); }
    return out;
  }
  if (scale === 'month') {
    let y = +from.slice(0, 4), m = +from.slice(5, 7);
    const end = to.slice(0, 7);
    for (let i = 0; i < 1200; i++) {
      const k = `${y}-${p2(m)}`;
      if (k > end) break;
      out.push(k);
      m += 1; if (m === 13) { m = 1; y += 1; }
    }
    return out;
  }
  if (scale === 'year') {
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4) && out.length < 200; y++) out.push(String(y));
    return out;
  }
  return out;
}

const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** ป้ายบนแกน — สั้นพอสำหรับแกน X · ปี พ.ศ. ตามที่ทั้งระบบใช้ */
export function bucketLabel(key, scale) {
  if (!key) return '';
  const dm = (s2) => `${+s2.slice(8, 10)}/${+s2.slice(5, 7)}`;
  if (scale === 'hour')  return `${key.slice(11, 13)}:00`;
  if (scale === 'day')   return dm(key);
  if (scale === 'week') {
    /* ช่วงจันทร์–อาทิตย์ · เดือนเดียวกันย่อเหลือเลขวัน ("21–27/9") ต่างเดือนเขียนเต็ม ("29/7–4/8") */
    const end = addDays(key, 6);
    if (!end) return key;
    return key.slice(5, 7) === end.slice(5, 7)
      ? `${+key.slice(8, 10)}–${dm(end)}`
      : `${dm(key)}–${dm(end)}`;
  }
  if (scale === 'month') return `${TH_MON[+key.slice(5, 7) - 1] || ''} ${String(+key.slice(0, 4) + 543).slice(2)}`;
  if (scale === 'year')  return String(+key.slice(0, 4) + 543);
  return String(key);
}

/* ── 4) เตือนเมื่อสเกลไม่เข้ากับกรอบเวลา (เตือนเท่านั้น ห้ามบล็อก) ─────────────────── */
export function scaleWarning(scale, from, to) {
  const sc = scaleOf(scale);
  const n = rangeDays(from, to);
  if (!sc || n == null) return null;
  const [lo, hi] = sc.okDays;
  if (n < lo) {
    return `ช่วงที่เลือกกว้าง ${n} วัน — สเกล "${sc.label}" จะได้แค่ ${Math.max(1, Math.ceil(n / (lo / 2)))} ช่วง อ่านแนวโน้มไม่ได้ ลองสเกลเล็กลง`;
  }
  if (n > hi) {
    return `ช่วงที่เลือกกว้าง ${n.toLocaleString()} วัน — สเกล "${sc.label}" จะได้แท่งเยอะจนอ่านไม่ออก ลองสเกลใหญ่ขึ้น`;
  }
  return null;
}

/** สเกลที่ "พอดี" กับช่วงนี้ — ใช้ตั้งค่าเริ่มต้นให้หน้าที่ยังไม่เคยเลือก */
export function suggestScale(from, to) {
  const n = rangeDays(from, to);
  if (n == null) return 'day';
  for (const s of TIME_SCALES) if (n >= s.okDays[0] && n <= s.okDays[1]) return s.key;
  return n > 1830 ? 'year' : 'day';
}
