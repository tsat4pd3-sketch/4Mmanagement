/* ── downtimeRules — นิยาม "downtime เปิดค้าง / ตามแผน / ต้อง Andon" (pure) ──────────────
   แยกออกมาจาก downtimeAlarm.js (2026-08-19) เพื่อให้ lib ที่คำนวณฝั่ง client ล้วน
   (เช่น src/lib/vsmLive.js) import ได้โดยไม่ลาก supabaseClient เข้ามา (ซึ่งใช้ import.meta.env
   ของ Vite → รันใน node:test ไม่ได้) — downtimeAlarm.js re-export ตัวนี้ ทุก import เดิมใช้ได้เหมือนเดิม

   ⚠️ นิยามอยู่ที่นี่ "ที่เดียว" — ห้ามเพิ่มเงื่อนไขเวลาอื่น (เช่น "เพิ่งบันทึกใน X นาที")
   เคยมีแล้วทำเครื่องที่ซ่อมเสร็จกระพริบค้าง คนหน้างานสับสน (ดูประวัติใน downtimeAlarm.js)     */

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
