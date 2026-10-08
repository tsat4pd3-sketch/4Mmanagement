/* ═══════════════════════════════════════════════════════════════════════════════════════
   กรอบเวลาของกะ + ตัวดักเวลาที่ "เป็นไปไม่ได้"  —  single source of truth   (2026-09-23)

   ที่มา (user: *"ดาวไทม์ที่ลงมา 04:19 น่าจะตั้งใจ 16:19 … ต้องทำ errorproof ดักไม่ให้เกิดอีก"*)
   เคสจริง Laser GOR 23/09 กะเช้า (เริ่ม 08:00): มี downtime 04:19–04:39 = **ก่อนเปิดกะ 3 ชม. 41 นาที**
   บันทึกตอน 16:39 ⇒ ตั้งใจ 16:19–16:39 แต่พลาด AM/PM (จอ 12 ชม. ค่าเริ่มต้นเป็น AM)

   ไล่ฐานทั้งระบบแล้วเจอ **2 ต้นเหตุคนละตัว** (9,664 แถว · 86 แถวหลุดกรอบกะ):
   ┌─ A) บั๊กโค้ด — กฎเลื่อนวันของกะดึก hardcode `ชั่วโมง < 8`
   │     กะดึกเริ่ม 20:00 จบ 08:00+ ⇒ คนกรอก "08:00"/"08:30" (5ส.ท้ายกะ/ส่งกะ) ไม่เข้าเงื่อนไข `< 8`
   │     → ถูกวางไว้ **วันเดียวกัน = ก่อนเปิดกะ ~12 ชม.** · วัดจริง 15 แถว 890 นาที ตรงลายเซ็นนี้เป๊ะ
   │     (ทั้ง 15 แถวเป็นกะดึกล้วน — ไม่ใช่ความผิดคนกรอก)
   └─ B) ไม่มีการตรวจเลยว่าเวลาที่กรอกอยู่ในกรอบกะไหม ⇒ AM/PM สลับ/พิมพ์ผิด ไหลเข้าฐานเงียบๆ

   🔴 กติกาที่ตกผลึก — **ห้าม hardcode "ก่อน 08:00 = วันถัดไป" อีก**
      เวลาที่กรอกต้องถูก resolve ด้วย *กรอบกะจริงของ session นั้น* (start_time + shift_min/end_time)
      แล้ว "เลือก offset วันที่ทำให้ตกในกรอบ" — ไม่ใช่เดาจากเลขชั่วโมง
      ⇒ กะดึกที่เริ่ม 22:30 หรือกะเช้าที่ลาก OT ข้ามเที่ยงคืน ก็ถูกต้องโดยไม่ต้องแก้โค้ดเพิ่ม

   ── แบ่งงานกับ `oee.js` ให้ชัด (ห้ามทำซ้อนกัน) ────────────────────────────────────────
   · `shiftFrameOf()` ใน **oee.js** = "กรอบกะจากเวลาที่บันทึกไว้แล้ว" ใช้ **รัด** ช่วงเวลาตอนคิด OEE
   · ไฟล์นี้ = **ด่านตอนกรอก** — แปลงเวลาที่คนพิมพ์ให้ตกในกรอบ + ตรวจว่าเป็นไปได้ไหม + เสนอค่าที่น่าจะตั้งใจ
   ⇒ ตัวรู้ว่า "work_date + start_time/end_time → ms" มีที่เดียวคือ `shiftFrameOf` (ไฟล์นี้เรียกใช้ต่อ)

   ⚠️ ไฟล์นี้ต้อง **pure** (ไม่ import supabase / ไม่อ่าน state) — ผู้เรียกส่ง session มาให้
   ═══════════════════════════════════════════════════════════════════════════════════════ */
import { shiftFrameOf } from './oee.js';   // .js เพื่อให้ node:test resolve ได้ (bundler ไม่สน)

/** เพดาน "กะหนึ่งยาวที่สุดเท่าไหร่" — กะ 12 ชม. + OT ยาวสุดที่เคยเจอ · เกินนี้ = กรอกผิดแน่ */
export const MAX_SHIFT_MIN = 16 * 60;
/** ยอมให้ลงเวลาล่วงหน้าได้เท่านี้ (กะที่ยังไม่ปิด) — 5ส./ประชุมท้ายกะ คนลงก่อนจบจริงเป็นเรื่องปกติ */
export const FUTURE_GRACE_MIN = 60;

const pad2 = (n) => String(n).padStart(2, '0');
const DAY = 86400000;

/** 'HH:mm[:ss]' → นาทีจากเที่ยงคืน · คืน null เมื่ออ่านไม่ได้ (ห้ามเดาเป็น 0) */
export function hhmmToMin(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '').trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (!(h >= 0 && h <= 23 && mi >= 0 && mi <= 59)) return null;
  return h * 60 + mi;
}

/** epoch ms ของ 'YYYY-MM-DD' + 'HH:mm' ตามเวลาเครื่อง (= เวลาไทยบนเครื่องหน้างาน) */
export function dayTimeMs(workDate, hhmm, dayOffset = 0) {
  const min = hhmmToMin(hhmm);
  if (min == null || !workDate) return null;
  const ms = new Date(`${workDate}T${pad2(Math.floor(min / 60))}:${pad2(min % 60)}:00`).getTime();
  return Number.isFinite(ms) ? ms + dayOffset * DAY : null;
}

/**
 * กรอบเวลาของกะ → { startMs, endMs, hardEnd, openEnded }
 *  · `end_time` มี → ใช้ตัวนั้น (เลื่อน +1 วันถ้า ≤ เวลาเริ่ม = กะข้ามคืน)
 *  · ไม่มี end_time แต่มี `shift_min` → start + shift_min
 *  · กะที่ยังเปิดอยู่ → ขอบบน = "ตอนนี้ + ผ่อนผัน" แต่ไม่เกิน start + MAX_SHIFT_MIN
 *    (`hardEnd=false` = ขอบบนยังขยับได้ตามเวลาจริง)
 *  คืน null เมื่อไม่รู้เวลาเริ่มกะ — **ผู้เรียกต้องข้ามการตรวจ ห้ามเดากรอบเอง**
 */
export function shiftWindow(session, nowMs = Date.now()) {
  const frame = shiftFrameOf(session);        // ← เจ้าของสูตร work_date+start/end → ms (oee.js)
  if (!frame) return null;
  const startMs = frame.startMs;
  let endMs = frame.endMs, hardEnd = endMs != null;
  if (endMs == null && Number(session.shift_min) > 0) {
    endMs = startMs + Number(session.shift_min) * 60000; hardEnd = true;
  }
  if (endMs == null) {
    // กะยังไม่ปิด — ขอบบนคือ "ตอนนี้" (+ ผ่อนผัน) เพดานที่ความยาวกะสูงสุด
    endMs = Math.min(startMs + MAX_SHIFT_MIN * 60000,
                     Math.max(startMs, nowMs + FUTURE_GRACE_MIN * 60000));
  }
  return { startMs, endMs, hardEnd, openEnded: !hardEnd };
}

/**
 * 'HH:mm' + กะ → epoch ms ที่ **ตกในกรอบกะ** (แทนกฎ hardcode `ชั่วโมง < 8` ที่เคยพัง)
 * ลอง offset วัน −1 / 0 / +1 แล้วเลือกตัวที่อยู่ในกรอบ · ไม่มีตัวไหนเข้ากรอบ → เลือกตัวที่ "ใกล้กรอบที่สุด"
 * แล้วบอก `inWindow:false` ให้ผู้เรียกไปเตือน **ห้ามดัดค่าให้เข้ากรอบเอง** (จะกลายเป็นเดาแทนคน)
 * คืน { ms, dayOffset, inWindow } · null เมื่ออ่านเวลา/กรอบกะไม่ได้
 */
export function resolveShiftTime(hhmm, session, nowMs = Date.now()) {
  const wd = session?.work_date;
  if (hhmmToMin(hhmm) == null || !wd) return null;
  const win = shiftWindow(session, nowMs);
  const cands = [0, 1, -1]
    .map(off => ({ ms: dayTimeMs(wd, hhmm, off), dayOffset: off }))
    .filter(c => c.ms != null);
  if (!cands.length) return null;
  if (!win) return { ...cands[0], inWindow: false };

  const inside = cands.find(c => c.ms >= win.startMs && c.ms <= win.endMs);
  if (inside) return { ...inside, inWindow: true };
  // ไม่เข้ากรอบสักตัว → เอาตัวที่ห่างกรอบน้อยสุด (ให้ข้อความเตือนอ่านรู้เรื่อง)
  const distOf = (ms) => ms < win.startMs ? win.startMs - ms : ms - win.endMs;
  const best = cands.reduce((a, b) => (distOf(b.ms) < distOf(a.ms) ? b : a));
  return { ...best, inWindow: false };
}

/**
 * ตรวจเวลา 1 จุดกับกรอบกะ → { ok, kind, minutesOff, suggestMs, suggestHHmm, window }
 *   kind: 'ok' | 'before' (ก่อนเปิดกะ) | 'future' (ยังมาไม่ถึง) | 'after' (เลยกะไปแล้ว) | 'unknown'
 *   `suggestMs` = ค่าที่ "น่าจะตั้งใจ" เมื่อเข้าข่าย **AM/PM สลับ** (บวก/ลบ 12 ชม. แล้วตกในกรอบพอดี)
 *      → จอเอาไปทำปุ่มแก้ให้ในคลิกเดียว **ห้ามแก้ให้เองเงียบๆ**
 *   kind 'unknown' = ไม่รู้กรอบกะ (ไม่มี start_time) — ผู้เรียกต้องปล่อยผ่าน ห้ามบล็อก
 */
export function checkShiftTime(ms, session, nowMs = Date.now()) {
  const win = shiftWindow(session, nowMs);
  if (!win || ms == null || !Number.isFinite(ms)) {
    return { ok: true, kind: 'unknown', minutesOff: 0, suggestMs: null, suggestHHmm: null, window: win };
  }
  let kind = 'ok', minutesOff = 0;
  if (ms < win.startMs) { kind = 'before'; minutesOff = Math.round((win.startMs - ms) / 60000); }
  else if (ms > win.endMs) {
    minutesOff = Math.round((ms - win.endMs) / 60000);
    kind = win.hardEnd ? 'after' : 'future';
  }
  // ── เสนอค่าที่น่าจะตั้งใจ เฉพาะกรณี ±12 ชม. แล้วเข้ากรอบพอดี (ลายเซ็นของ AM/PM สลับ) ──
  let suggestMs = null;
  if (kind !== 'ok') {
    for (const delta of [12 * 3600000, -12 * 3600000]) {
      const c = ms + delta;
      if (c >= win.startMs && c <= win.endMs) { suggestMs = c; break; }
    }
  }
  const d = suggestMs == null ? null : new Date(suggestMs);
  return {
    ok: kind === 'ok', kind, minutesOff, suggestMs,
    suggestHHmm: d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : null,
    window: win,
  };
}

/* ── ปิดกะ "ก่อนเวลาเลิกงาน" ปกติ · แต่ปลายกะต้องมีอะไรรองรับ (2026-10-02 · ปรับ 10-05) ──────
   user: *"ปกติเค้าจะปิดกะก่อนเวลาเลิกงาน ไม่น่าจะก่อน 30-60 นาที … มันเป็นไปไม่ได้ที่จะรู้ล่วงหน้า
   และปิดกะก่อน 3 ชั่วโมง"* ⇒ เวลาจบที่กรอก ไม่ควรล้ำ "เวลาที่กดปิดจริง" มากกว่าที่คนจะรู้อนาคตได้

   🔴 **ไม่ใช่เรื่องหน้าตาจอ** — `shift_min` คิดจาก start→end แล้วเป็น **ฐานเวลาของ %A/%P** (`wLoad` ใน oee.js)
      ล้ำ 3 ชม. = ไลน์นั้นถูกชาร์จเวลาเดินเครื่องเกินจริง 3 ชม. ⇒ **OEE ต่ำกว่าความจริงทั้งกะ**
      และไทม์ไลน์เครื่องหยุดลากแถบเขียวไปใน "อนาคต" (เคสที่ user เห็น 01/10)

   🔴🔴 **"ล้ำหน้า" เพียวๆ ไม่ใช่ความผิด — ต้องหัก "ปลายกะที่ลง downtime คลุมไว้แล้ว" ออกก่อน** (05/10)
      เกณฑ์เดิม (ดูแต่ `aheadMin`) เตือนผิด 5 ใบจาก 9 ใบที่เข้าเกณฑ์ เพราะหน้างาน**ทำถูกแล้ว**:
      ปิดงานตอนเที่ยง แล้วลง downtime *"นับสต๊อก / ไม่มีแผนผลิต"* คลุมถึง 17:30 — กะนั้นเดินถึง 17:30 จริง
      ส่วนที่เหลือถูกนับเป็น planned stop ไปแล้ว (SP-72/74/88 คลุม 220/220 น. · Line 60/61 คลุม 174/174 น.)
      ⇒ **ของจริงที่ต้องเตือน = นาทีปลายกะที่ "ไม่มีใบอะไรรองรับเลย"** (`unaccountedMin`)

   เกณฑ์มาจากข้อมูลจริง ไม่ได้ตั้งเอง — กะที่ปิดแล้วทั้งระบบ 1,445 ใบ (วัด 05/10):
     · ปิดก่อนเวลาเลิกงาน 64 ใบ · เฉลี่ยล้ำหน้า **65 นาที** (ตรงกับที่ user บอก 30-60 นาที)
     · ปลายกะไม่มีอะไรรองรับ > 60 น. = **5 ใบ (0.3%)** · **ไม่มีสักใบอยู่ระหว่าง 61–90 นาที**
       ⇒ 90 คือรอยต่อที่ข้อมูลบอกเอง (เกณฑ์เดิมก็ 90 — เปลี่ยนแต่ "แกนที่วัด" ไม่ได้เปลี่ยนตัวเลข)
     · ใบที่เหลือจริงหลังหักส่วนที่คลุมแล้ว: 97 (HYDROFORM 25/06 — มีใบ DT เปิดค้างไม่ปิดจนวันนี้) ·
       209 + 232 (TSRA 01/10 — **ไม่มีใบ downtime เลย**) · 567 (Laser LWR กะดึก 24/09 ปิด 22:33 กรอกจบ 08:00) */
export const CLOSE_AHEAD_WARN_MIN = 90;

/**
 * นาทีในช่วง [fromMs, toMs] ที่มีใบ downtime คลุมอยู่ — ใช้ตอบว่า "ปลายกะมีอะไรรองรับแล้วหรือยัง"
 * ใบที่ยังไม่ปิด (`ended_at` ว่าง) ยาวเท่า `duration_min` ที่กรอก — **ไม่ลากถึง "ตอนนี้"**
 * (สูตรเดียวกับที่ `computeSessionOee` ใช้ ⇒ นาทีที่เตือนตรงกับนาทีที่ OEE คิดจริง)
 * 🔴 ยุบช่วงที่ทับกันก่อนบวก — ไลน์เครื่องขนานลง DT หลายใบพร้อมกัน บวกดิบ = คลุมเกินจริง
 */
export function dtCoverMin(downtimes = [], fromMs, toMs) {
  if (!(toMs > fromMs)) return 0;
  const iv = [];
  for (const d of downtimes || []) {
    if (!d?.started_at) continue;
    const s0 = new Date(d.started_at).getTime();
    if (!Number.isFinite(s0)) continue;
    const e0 = d.ended_at ? new Date(d.ended_at).getTime()
      : s0 + (Number(d.duration_min) || 0) * 60000;
    const a = Math.max(s0, fromMs), b = Math.min(e0, toMs);
    if (b > a) iv.push([a, b]);
  }
  if (!iv.length) return 0;
  iv.sort((x, y) => x[0] - y[0]);
  let total = 0, [cs, ce] = iv[0];
  for (const [a, b] of iv.slice(1)) {
    if (a > ce) { total += ce - cs; cs = a; ce = b; } else if (b > ce) ce = b;
  }
  return Math.round((total + (ce - cs)) / 60000);
}

/**
 * เวลาปิดกะที่กรอก "ล้ำหน้าเวลาจริง" กี่นาที และในนั้น **ไม่มีอะไรรองรับกี่นาที**
 * @param downtimes ใบ downtime ของกะนั้น — 🔴 **ไม่ส่งมา = ถือว่าไม่มีอะไรรองรับ** (เตือนเกินจริงได้)
 *   ⇒ ทุกจุดที่เรียกต้องส่ง (มีด่าน `regressionGuards`: `close-time-needs-downtimes`)
 * @returns null = ตรวจไม่ได้ (อ่านเวลาไม่ออก / ไม่รู้ work_date) — **ผู้เรียกต้องปล่อยผ่าน ห้ามบล็อก**
 *   { ok, aheadMin, coveredMin, unaccountedMin, nowHHmm }
 *   `ok=false` ⇒ จอต้องเตือน + เสนอ `nowHHmm` ให้กดแก้ในคลิกเดียว
 *   🔴 **ห้ามแก้ค่าให้เองเงียบๆ** (กฎเดียวกับ `checkShiftTime` — ดัดให้ = เดาแทนคน)
 */
export function checkCloseTime(hhmm, session, nowMs = Date.now(), { downtimes = null } = {}) {
  const r = resolveShiftTime(hhmm, session, nowMs);
  if (!r) return null;
  const aheadMin = Math.round((r.ms - nowMs) / 60000);
  const coveredMin = aheadMin > 0 ? dtCoverMin(downtimes, nowMs, r.ms) : 0;
  const unaccountedMin = Math.max(0, aheadMin - coveredMin);
  const d = new Date(nowMs);
  return {
    ok: unaccountedMin <= CLOSE_AHEAD_WARN_MIN,
    aheadMin, coveredMin, unaccountedMin,
    nowHHmm: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

/** นาที → "3 ชม. 41 นาที" (ข้อความเตือนต้องอ่านแล้วเห็นภาพทันที ไม่ใช่ "221 นาที") */
export function fmtOffset(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} ชม. ${r} นาที` : `${h} ชม.`;
}

/** ป้ายกรอบกะสำหรับโชว์ใต้ช่องกรอกเวลา — "กะนี้: 08:00 → 20:00" (ยังไม่ปิด = "→ ตอนนี้") */
export function windowLabel(session, nowMs = Date.now()) {
  const win = shiftWindow(session, nowMs);
  if (!win) return null;
  const t = (ms) => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  return `${t(win.startMs)} → ${win.hardEnd ? t(win.endMs) : 'ตอนนี้'}`;
}
