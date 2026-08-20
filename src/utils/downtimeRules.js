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
