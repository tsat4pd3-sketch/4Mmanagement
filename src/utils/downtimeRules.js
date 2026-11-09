/* ── downtimeRules — นิยาม "downtime เปิดค้าง / ตามแผน / ต้อง Andon" (pure) ──────────────
   แยกออกมาจาก downtimeAlarm.js (2026-08-19) เพื่อให้ lib ที่คำนวณฝั่ง client ล้วน
   (เช่น src/lib/vsmLive.js) import ได้โดยไม่ลาก supabaseClient เข้ามา (ซึ่งใช้ import.meta.env
   ของ Vite → รันใน node:test ไม่ได้) — downtimeAlarm.js re-export ตัวนี้ ทุก import เดิมใช้ได้เหมือนเดิม

   ⚠️ นิยามอยู่ที่นี่ "ที่เดียว" — ห้ามเพิ่มเงื่อนไขเวลาอื่น (เช่น "เพิ่งบันทึกใน X นาที")
   เคยมีแล้วทำเครื่องที่ซ่อมเสร็จกระพริบค้าง คนหน้างานสับสน (ดูประวัติใน downtimeAlarm.js)     */

import { SESSION_STATUSES_LIVE } from './sessionStatus.js';

// รายการยังเปิดค้างอยู่จริง (ไม่สนประเภท)
export function isOpenDT(d) {
  return !d.ended_at && d.duration_min == null;
}

// หยุดตามแผน (ไม่มี join ประเภทมาด้วย = ถือว่านอกแผนไว้ก่อน — ปลอดภัยกว่า)
export function isPlannedDT(d) {
  return d?.dr_downtime_types?.category === 'planned';
}

// ต้อง Andon แดง — เปิดค้าง + นอกแผนเท่านั้น (planned = แสดงแยกแบบสงบ ห้ามซ่อน แต่ไม่ alarm)
export function isAlarmingDT(d) {
  return isOpenDT(d) && !isPlannedDT(d);
}

/* ══ 🔴🔴 กฎเหล็กข้าม session — "ยังหยุดอยู่" ต้องมี **กะที่ยังเปิด** รองรับเสมอ (2026-11-09) ══
 * `ended_at` ว่าง บอกได้แค่ *"แถวนี้ยังไม่ถูกปิด"* — ไม่ได้แปลว่าเครื่องยังหยุดอยู่
 *   · กะยังเปิด  → เครื่องยังหยุดจริง = Andon แดง กระพริบได้
 *   · กะปิดไปแล้ว → **คนลืมปิดรายการ** — ไม่มีอะไรไปปิดให้ภายหลัง และ**ไม่ไหลไปกะใหม่ด้วย**
 *     (ต่อกะหน้าเกิดเฉพาะตอนคนเลือก "ยังซ่อมอยู่ ตัดยอดข้ามกะ" ตอนปิดกะ ⇒ `carry_over=true`
 *      แล้ว DailyReport เปิดแถวต่อให้ในกะถัดไป — แถวที่ถูกลืมมี `carry_over=false` จึงค้างตรงนั้นตลอดกาล)
 * เคสจริงที่ทำให้ต้องมีกฎนี้ (หัวหน้าหน้างานแจ้ง 09/11):
 *   Robot (Alarm/Error) ไลน์ D4 03/11 — กะถูกอนุมัติปิดตั้งแต่ 04/11 แต่แถวยังเปิดค้าง 147 ชม.
 *   ⇒ จอ OEE รายไลน์กระพริบ "🔴 ยังหยุดอยู่" ค้างตลอด · ทั้งโรงงานมี 6 แถวแบบนี้ (เก่าสุด 3,322 ชม.)
 * ⇒ จอที่รู้สถานะกะ **ต้องส่ง `sessionStatus` มาเสมอ** · `forgotten` = ห้ามกระพริบ ห้ามนับเป็น Andon
 *   **แต่ห้ามซ่อน** — ต้องเขียนบนจอว่ามีกี่ใบ (ไม่งั้นไม่มีใครรู้ว่าต้องไปตามปิด และ %A ของกะนั้นสูงกว่าจริง)
 * ⚠️ ไม่รู้สถานะกะ = `unknown` — ผู้เรียกตัดสินเอง **ห้ามบีบเป็น `forgotten` เงียบๆ**               */
export function dtOpenKind(d, sessionStatus) {
  if (!isOpenDT(d)) return 'done';
  if (sessionStatus == null) return 'unknown';
  return SESSION_STATUSES_LIVE.includes(sessionStatus) ? 'open' : 'forgotten';
}

/** แถวที่ "ลืมปิด" (เปิดค้างในกะที่ปิด/โมฆะไปแล้ว) — ไม่ใช่เครื่องหยุดอยู่ */
export const isForgottenDT = (d, sessionStatus) => dtOpenKind(d, sessionStatus) === 'forgotten';

/** ป้าย/สีมาตรฐานของแต่ละสถานะ — ห้ามแต่งข้อความเองในหน้า (จะได้คำเดียวกันทุกจอ) */
export const DT_OPEN_META = {
  open:      { text: 'ยังหยุดอยู่',      short: 'ยังหยุดอยู่', icon: '🔴', color: 'var(--red)',   blink: true },
  forgotten: { text: 'ไม่ได้ปิดรายการ',  short: 'ไม่ได้ปิด',   icon: '⚠️', color: 'var(--amber)', blink: false },
  unknown:   { text: 'ยังหยุดอยู่',      short: 'ยังหยุดอยู่', icon: '🔴', color: 'var(--red)',   blink: true },
  done:      { text: 'กลับมาแล้ว',       short: 'กลับมา',      icon: '✓',  color: 'var(--green)', blink: false },
};

// นาทีที่ผ่านไปตั้งแต่ downtime เริ่ม (ใช้โชว์ "หยุดมาแล้ว X นาที")
export function dtElapsedMin(d, nowMs = Date.now()) {
  const start = d.started_at || d.created_at;
  if (!start) return null;
  return Math.max(0, Math.round((nowMs - new Date(start).getTime()) / 60000));
}

/* ⏱ "หยุดมาแล้วกี่นาที" — รูปแบบเดียวทุกจอ (ผังรวม · จอห้องช่าง · Dashboard)
   ⚠️ ไม่รู้เวลาเริ่ม (กรอกแค่จำนวนนาที) = '—' ห้ามแปลงเป็น 0 (0 อ่านเป็น "เพิ่งหยุด") */
export function fmtDtElapsed(m) {
  if (m == null) return '—';
  return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} น.` : `${m} น.`;
}

export const DT_OPEN_ALERT_MIN_DEFAULT = 15;

/* 🔴 กฎเหล็ก — "หยุดเกินเกณฑ์" ต้องตัดสินจาก **เวลาที่ผ่านไปจริง** ห้ามใช้ `open_alerted_at`
   `open_alerted_at` คือ *ตัวกันแจ้ง Telegram ซ้ำ* ของ edge `downtime-open-scan` เท่านั้น —
   และ edge จะ stamp ให้ **ก็ต่อเมื่อ POST หา send-notification สำเร็จ**
   ⇒ Telegram ล่ม/ปิด rule/ไม่มีห้อง = ธงไม่ถูกตั้ง → **ไซเรนบนจอไม่ดังตลอดกาล**
     และจอห้องช่างอ่านเครื่องที่หยุดมา 3 ชม. เป็น "⏱️ เพิ่งหยุด" (เจอจริง 2026-08-26)
   → จอต้องคิดเองจาก started_at เสมอ (ธงยังใช้ได้ในฐานะ "แจ้ง Telegram ไปแล้ว" เท่านั้น) */
export function isOverDtThreshold(d, thresholdMin = DT_OPEN_ALERT_MIN_DEFAULT, nowMs = Date.now()) {
  const m = dtElapsedMin(d, nowMs);
  return m != null && m >= thresholdMin;
}
