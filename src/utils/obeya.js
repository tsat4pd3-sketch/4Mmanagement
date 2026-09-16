/* ══ 🧭 OBEYA — สูตรกลางของบอร์ด SQCDM รายส่วนงาน (pure · 2026-08-27) ═══════════════
   โจทย์: "กระดาษ OBEYA KPI monitoring หน้างานต้องถูกยุบเข้าโปรแกรม" (คำสั่งนายใหญ่ผ่าน user)
   ผู้ใช้เคาะ 3 ข้อ: ① แยกรายส่วนงาน ② ตัวไหนวิ่งทุกกะให้อัพเดทรายวัน ③ มีแกน Safety

   ⚠️ ไฟล์นี้ต้อง pure — ห้าม import supabase/react (รันใน node:test ไม่ได้ถ้าลาก import.meta.env มา)
      หลักเดียวกับ vsmLive.js / peLink.js / capaEffect.js

   ═══ กฎที่ยึด (ห้ามละเมิด) ═══════════════════════════════════════════════════
   ① **"ประเมินไม่ได้" ≠ "แย่"** — คืน ST.unknown + เหตุผล ห้ามแปลงเป็น 0 หรือแดง
      (กฎเดียวกับ OEE: ยังไม่ผลิต = null ห้ามโชว์ 0%)
   ② **กระพริบเฉพาะแดงที่เป็น alarm จริง** — บอร์ดนี้เป็นสรุปรายวัน ไม่ใช่ Andon เครื่องหยุด
      → ทุกสถานะ "นิ่ง" (ดู UI-CONVENTIONS §Andon) ยกเว้นอุบัติเหตุที่เกิดวันนี้
   ③ **ไม่มีเป้า ≠ ผ่าน** — ตัวที่ยังไม่ตั้งเป้าให้เทียบ "ค่าเฉลี่ยตัวเองย้อนหลัง"
      แล้วเขียนบนจอว่าเทียบกับอะไร **ห้ามแต่งเกณฑ์ขึ้นมาเองแล้วบอกว่าผ่าน/ไม่ผ่านเป้า**
   ④ **แกนวันต่อเนื่อง** — วันที่ไม่มีข้อมูลต้องเว้นช่อง ห้ามข้ามวัน (กฎกราฟเทรนด์ทั้งระบบ)
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── สถานะ Andon ของการ์ด ─────────────────────────────────────────────── */
export const ST = { good: 'good', warn: 'warn', bad: 'bad', unknown: 'unknown' };

export const ST_META = {
  good:    { color: '#22c55e', label: 'ปกติ',          dot: '🟢', rank: 0 },
  warn:    { color: '#f59e0b', label: 'เฝ้าระวัง',      dot: '🟡', rank: 1 },
  bad:     { color: '#ef4444', label: 'หลุดเป้า',       dot: '🔴', rank: 2 },
  unknown: { color: '#6b7280', label: 'ยังไม่มีข้อมูล', dot: '⚪', rank: -1 },
};
export const stMeta = s => ST_META[s] || ST_META.unknown;

/** สถานะที่แย่ที่สุดในชุด — ใช้สรุปไฟรวมของบอร์ด
 *  ⚠️ unknown ไม่ชนะ good (ไม่รู้ 1 ตัวต้องไม่ทำให้ทั้งบอร์ดเป็นเทา) แต่ถ้าไม่รู้ทั้งหมด = unknown */
export function worstStatus(list) {
  const known = (list || []).filter(s => s && s !== ST.unknown);
  if (!known.length) return ST.unknown;
  return known.reduce((a, b) => (stMeta(b).rank > stMeta(a).rank ? b : a), ST.good);
}

/* ── เทียบเป้า ────────────────────────────────────────────────────────────
   dir 'up'   = ยิ่งมากยิ่งดี (OEE, ส่งตรงเวลา)
   dir 'down' = ยิ่งน้อยยิ่งดี (ของเสีย, Downtime, อุบัติเหตุ)
   band       = แถบ "เฉียด" (สัดส่วนของเป้า) — ในแถบนี้ = เหลือง ยังไม่แดง                */
export function statusVsTarget(value, target, dir = 'up', band = 0.05) {
  if (value == null || !Number.isFinite(Number(value))) return ST.unknown;
  if (target == null || !Number.isFinite(Number(target))) return ST.unknown;
  const v = Number(value), t = Number(target);
  if (dir === 'down') {
    if (v <= t) return ST.good;
    // เป้า 0 (เช่นอุบัติเหตุ) หารสัดส่วนไม่ได้ → เกินเป้าแม้แต่นิดเดียว = แดงทันที
    if (t === 0) return ST.bad;
    return v <= t * (1 + band) ? ST.warn : ST.bad;
  }
  if (v >= t) return ST.good;
  if (t === 0) return ST.good;          // เป้า 0 ในทิศ up = อะไรก็ผ่าน
  return v >= t * (1 - band) ? ST.warn : ST.bad;
}

/** เทียบกับ "ค่าเฉลี่ยตัวเองย้อนหลัง" สำหรับตัวที่ยังไม่ได้ตั้งเป้า
 *  คืน { status, base, deltaPct } — base null = เทียบไม่ได้ (unknown) ห้ามเดา
 *  ⚠️ ตั้งใจให้ "แย่กว่าค่าเฉลี่ย" สูงสุดได้แค่ warn — ไม่ใช่ bad
 *     เพราะแย่กว่าค่าเฉลี่ยตัวเองไม่ใช่ "หลุดเป้า" (ยังไม่มีเป้าให้หลุด) */
export function statusVsBaseline(value, baseline, dir = 'up', band = 0.1) {
  if (value == null || !Number.isFinite(Number(value))) return { status: ST.unknown, base: null, deltaPct: null };
  if (baseline == null || !Number.isFinite(Number(baseline)) || Number(baseline) === 0) {
    return { status: ST.unknown, base: null, deltaPct: null };
  }
  const v = Number(value), b = Number(baseline);
  const deltaPct = ((v - b) / Math.abs(b)) * 100;
  const better = dir === 'down' ? v <= b : v >= b;
  if (better) return { status: ST.good, base: b, deltaPct };
  return { status: Math.abs(deltaPct) > band * 100 ? ST.warn : ST.good, base: b, deltaPct };
}

/* ── แกน Safety ───────────────────────────────────────────────────────────
   พีระมิดความปลอดภัยสากล — เรียงจากหนักไปเบา
   ⚠️ source of truth ของลิสต์อยู่ที่นี่ (ตาราง safety_events ไม่มี check constraint โดยตั้งใจ
      เผื่อโรงงานอื่นตอน rollout แบ่งชั้นไม่เหมือนกัน) · key ที่ไม่รู้จักต้องโชว์ดิบ ห้ามหายเงียบ */
export const SAFETY_KINDS = [
  { key: 'lti',        label: 'อุบัติเหตุถึงขั้นหยุดงาน (LTI)', short: 'หยุดงาน',   icon: '🚑', color: '#ef4444', severity: 5, resetsStreak: true },
  { key: 'restricted', label: 'บาดเจ็บ — จำกัดหน้าที่งาน',      short: 'จำกัดงาน',  icon: '🩹', color: '#f97316', severity: 4, resetsStreak: false },
  { key: 'medical',    label: 'บาดเจ็บ — ต้องรักษาพยาบาล',      short: 'รักษา',     icon: '🏥', color: '#f59e0b', severity: 3, resetsStreak: false },
  { key: 'first_aid',  label: 'ปฐมพยาบาลเบื้องต้น',            short: 'ปฐมพยาบาล', icon: '🩺', color: '#eab308', severity: 2, resetsStreak: false },
  { key: 'property',   label: 'ทรัพย์สินเสียหาย',              short: 'ทรัพย์สิน', icon: '🔧', color: '#94a3b8', severity: 1, resetsStreak: false },
  { key: 'near_miss',  label: 'เกือบเกิดเหตุ (Near miss)',      short: 'Near miss', icon: '⚠️', color: '#3b82f6', severity: 0, resetsStreak: false },
];
const KIND_BY = Object.fromEntries(SAFETY_KINDS.map(k => [k.key, k]));

/** meta ของชนิดเหตุการณ์ — ไม่รู้จัก = คืน key ดิบสีเทา (ห้ามซ่อน ห้าม throw) */
export const safetyKind = key =>
  KIND_BY[key] || { key, label: key || '(ไม่ระบุชนิด)', short: key || '?', icon: '❔', color: '#94a3b8', severity: 0, resetsStreak: false, unknown: true };

/** เหตุการณ์นี้เป็นการบาดเจ็บของคนมั้ย (ใช้แยก "อุบัติเหตุ" ออกจาก near miss / ทรัพย์สิน) */
export const isInjury = ev => safetyKind(ev?.kind).severity >= 2;

/** สถานะแกน Safety ของส่วนงาน
 *  ⚠️⚠️ กฎเหล็ก — **"ไม่มีบันทึก" ห้ามขึ้นเขียว**
 *  เป้าอุบัติเหตุ = 0 เสมอ ⇒ ส่วนงานที่ยังไม่มีใครบันทึกอะไรเลยจะได้ 0 = "ผ่านเป้า" อัตโนมัติ
 *  ซึ่งเป็น**คำกล่าวอ้างเท็จ**: 0 ที่บันทึกไว้ ≠ 0 ที่เกิดจริง (เจอจริงตอนเรนเดอร์ครั้งแรก 2026-08-27
 *  บอร์ดขึ้น "🟢 ปกติ" ทั้งบอร์ดทั้งที่ตาราง safety_events ว่างเปล่า)
 *  → ยังไม่มีบันทึกสักแถว = unknown · เขียวได้ต่อเมื่อ "มีการบันทึกจริง แล้วไม่มีคนเจ็บ"
 *  @param events เหตุการณ์ของส่วนงานนั้น (กรองมาแล้ว)
 *  @param opts.todayEvents เหตุการณ์ของวันที่กำลังดู · opts.monthInjuries จำนวนบาดเจ็บเดือนนี้ */
export function safetyStatus(events, { todayEvents = [], monthInjuries = 0, tableMissing = false } = {}) {
  if (tableMissing) return ST.unknown;
  if (!(events || []).length) return ST.unknown;          // ยังไม่มีใครบันทึก — ประเมินไม่ได้
  if ((todayEvents || []).some(isInjury)) return ST.bad;  // มีคนเจ็บวันนี้
  return statusVsTarget(monthInjuries, 0, 'down');        // เป้า 0 — เกินแม้แต่ 1 = แดง
}

/** วันปลอดอุบัติเหตุถึงขั้นหยุดงาน
 *  ⚠️ ไม่มี LTI ในระบบ ≠ "ปลอดภัยมานาน" — อาจแค่ยังไม่มีใครบันทึก
 *     → คืน { unknown: true } ให้จอเขียนว่า "ยังไม่มีบันทึก" **ห้ามโชว์ตัวเลขวันที่พิสูจน์ไม่ได้**
 *  @param events แถว safety_events (ต้องมี event_date, kind)
 *  @param todayYmd 'YYYY-MM-DD' ของวันงานปัจจุบัน                                */
export function daysWithoutLti(events, todayYmd) {
  const resets = (events || []).filter(e => safetyKind(e?.kind).resetsStreak && e?.event_date);
  if (!resets.length) return { days: null, since: null, unknown: true };
  const last = resets.reduce((a, b) => (String(b.event_date) > String(a.event_date) ? b : a));
  return { days: Math.max(0, daysBetween(last.event_date, todayYmd)), since: last.event_date, unknown: false, event: last };
}

/* ── วันที่ (local ล้วน — ห้าม toISOString ตามกฎ Date/Time ของโปรเจค) ────────── */
export const ymd = d => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const parseYmd = s => {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export function dayAdd(ymdStr, n) {
  const d = parseYmd(ymdStr);
  d.setDate(d.getDate() + n);
  return ymd(d);
}
export function daysBetween(fromYmd, toYmd) {
  const a = parseYmd(fromYmd), b = parseYmd(toYmd);
  return Math.round((b - a) / 86400000);
}

/** แกนวันต่อเนื่อง n วันจบที่ endYmd — ห้ามข้ามวันที่ไม่มีข้อมูล (กฎกราฟเทรนด์) */
export function dayAxis(endYmd, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayAdd(endYmd, -i));
  return out;
}

/** รวมค่ารายวันเป็น map { 'YYYY-MM-DD': number } */
export function sumByDay(rows, dateOf, valueOf = () => 1) {
  const m = {};
  (rows || []).forEach(r => {
    const d = dateOf(r);
    if (!d) return;
    const v = Number(valueOf(r));
    m[d] = (m[d] || 0) + (Number.isFinite(v) ? v : 0);
  });
  return m;
}

/** ค่าเฉลี่ยของ "วันที่มีข้อมูลจริง" — ไม่หารด้วยวันปฏิทิน
 *  (ไลน์หยุดเสาร์-อาทิตย์ หารวันปฏิทินจะได้ค่าเฉลี่ยต่ำเกินจริง — บทเรียนจาก capaEffect/demandSupply) */
export function avgOfDays(map, days) {
  const vs = (days || []).map(d => map?.[d]).filter(v => v != null && Number.isFinite(v));
  return vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null;
}

export default { ST, ST_META, stMeta, worstStatus, statusVsTarget, statusVsBaseline,
  SAFETY_KINDS, safetyKind, isInjury, safetyStatus, daysWithoutLti, ymd, dayAdd, daysBetween, dayAxis, sumByDay, avgOfDays };
