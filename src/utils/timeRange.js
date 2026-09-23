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
 *   1. **สเกล (scale)** = ขนาด "ถัง" ที่เอาข้อมูลไปรวม — วัน / สัปดาห์ / เดือน / ปี
 *   2. **กรอบเวลา (from–to)** = ช่วงที่ดึงข้อมูล — แก้เองได้เสมอ
 *   3. **ปุ่มลัด (preset)** = เติม from–to ให้เร็วๆ (ย้อนหลัง 30/60/90/120 วัน)
 *      ⚠️ ปุ่มลัด **เขียนทับ from–to แล้วจบ** ไม่ใช่โหมดค้าง — คนแก้วันต่อได้ทันที
 *      (โหมดค้างทำให้เกิดคำถาม "ทำไมกดวันแล้วเด้งกลับ")
 *
 * 🔴 **กฎความซื่อสัตย์: สเกลที่ไม่เข้ากับกรอบเวลา ต้องบอกบนจอ ห้ามวาดกราฟหลอกๆ**
 *    รายปี บนช่วง 30 วัน = แท่งเดียว · รายวัน บนช่วง 2 ปี = 730 แท่งอ่านไม่ออก
 *    ⇒ `scaleWarning()` คืนข้อความให้จอเอาไปแสดง (เตือนเท่านั้น **ห้ามบล็อก** — บางทีคนตั้งใจ)
 *
 * ⚠️ ไฟล์นี้ **pure ล้วน** — ห้าม import supabase/DOM/React · รับวันที่เป็นสตริง `YYYY-MM-DD`
 *    ที่ผู้เรียก resolve เป็น "วันทำงาน" มาแล้ว (ผ่าน getWorkDate) ⇒ ไม่มีกับดัก timezone ในนี้
 *    (กฎ CLAUDE.md: ห้าม `new Date().toISOString()` หาวันที่งาน)
 */

/* ── 1) สเกล ──────────────────────────────────────────────────────────────────────
   `okDays` = ช่วงกว้าง (จำนวนวัน) ที่สเกลนี้ "อ่านรู้เรื่อง" — ใช้เตือนเท่านั้น ไม่ได้บังคับ
   ตัวเลขมาจากจำนวนแท่งที่ยังอ่านออกบนจอ TV 43" (ประมาณ 4–60 แท่ง) */
export const TIME_SCALES = [
  { key: 'day',   label: 'รายวัน',      short: 'วัน',     okDays: [1, 120] },
  { key: 'week',  label: 'รายสัปดาห์',  short: 'สัปดาห์', okDays: [14, 540] },
  { key: 'month', label: 'รายเดือน',    short: 'เดือน',   okDays: [60, 1830] },
  { key: 'year',  label: 'รายปี',       short: 'ปี',      okDays: [730, 36500] },
];
export const scaleOf = (key) => TIME_SCALES.find(s => s.key === key) || null;
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

/**
 * คีย์ถัง — เรียงตามตัวอักษรแล้วได้ลำดับเวลาถูกเสมอ
 * 🔴 **สัปดาห์ใช้ "วันที่ของวันจันทร์" ไม่ใช่ `2026-W39`** โดยตั้งใจ:
 *    · เอาไปบวกวันต่อได้ตรงๆ (โค้ดเติมช่องว่างบนแกนเดินทีละ 7 วันจากคีย์)
 *    · ป้ายบนแกนบอกช่วงวันจริง ("21–27/9") ซึ่งหน้างานอ่านรู้เรื่องกว่าเลขสัปดาห์
 *    · เป็นสัปดาห์เดียวกับ ISO เป๊ะ (แค่คนละวิธีเขียน) — ต้องการเลขสัปดาห์ใช้ `isoWeek()` */
export function bucketKey(dateStr, scale) {
  if (!isDateStr(dateStr)) return null;
  if (scale === 'day') return dateStr;
  if (scale === 'month') return dateStr.slice(0, 7);
  if (scale === 'year') return dateStr.slice(0, 4);
  if (scale === 'week') return weekMonday(dateStr);
  return null;
}

const TH_MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** ป้ายบนแกน — สั้นพอสำหรับแกน X · ปี พ.ศ. ตามที่ทั้งระบบใช้ */
export function bucketLabel(key, scale) {
  if (!key) return '';
  const dm = (s2) => `${+s2.slice(8, 10)}/${+s2.slice(5, 7)}`;
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
