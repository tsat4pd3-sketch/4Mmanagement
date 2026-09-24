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
