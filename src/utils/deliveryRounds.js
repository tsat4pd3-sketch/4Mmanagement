/* ─── Delivery-round helpers (single source of truth) ────────────────────────
   รอบส่งภายใน Store → ไลน์ผลิต — สถานะ/เวลา คำนวณที่เดียว
   เดิมซ้ำ 2 ก๊อป: getRoundStatus (HeijunkaKanban) vs statusOf (LineStock)
   → เพี้ยนที่ขอบกรอบวันงาน (LineStock เทียบ frame-min ไม่เช็ควันย้อนหลัง/ล่วงหน้า)
   รวมมาที่นี่ 2026-07-21 · ทุกหน้าที่โชว์สถานะรอบส่งต้อง import จากไฟล์นี้

   กรอบวันงาน = 08:00 → 08:00 ของวันถัดไป (รอบที่ delivery < 08:00 = กะดึกข้ามวัน) */

export function addMinutes(timeStr, mins) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.slice(0, 5).split(':').map(Number);
  const total = h * 60 + m + (mins || 0);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/* แปลงเวลา "HH:MM" ของ workDate ให้เป็น ms จริง — ห่อข้ามเที่ยงคืนเข้ากรอบ 08:00→08:00 ของวันนั้น */
export function timeStrToMs(workDate, t) {
  if (!t) return null;
  const gridStartMs = new Date(`${workDate}T08:00:00`).getTime();
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  let ms = gridStartMs + h * 3600000 + m * 60000;
  if (h < 8) ms += 24 * 3600000;
  return ms;
}

/* กรอบวันงาน 08:00 → 08:00 ของวันถัดไป (ms) */
export function dayFrameMs(workDate) {
  const startMs = new Date(`${workDate}T08:00:00`).getTime();
  return { startMs, endMs: startMs + 24 * 3600000 };
}

/* ระยะเวลาส่งของรอบ (นาที) = จำนวนจุด × นาที/จุด */
export const roundDeliveryMin = (r) => (r.points_count || 1) * (r.time_per_point_min || 10);

export const ST_WAIT    = { label: '⬜ รอ', color: 'var(--muted)', bg: 'var(--bg2)', border: 'var(--border)', top: 'var(--border2)' };
export const ST_OVERDUE = { label: '🔴 ค้างส่ง', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.3)', top: '#ef4444' };
export const ST_PREPARE = { label: '⏳ กำลังเตรียม', color: '#0ea5e9', bg: 'rgba(14,165,233,0.08)', border: 'rgba(14,165,233,0.3)', top: '#0ea5e9' };

/* สถานะรอบจัดส่ง — เทียบเวลาจริงบนกรอบ 08:00→08:00 ของ workDate จึงไม่เพี้ยนตอนรอบข้ามเที่ยงคืน
   วันย้อนหลัง: รอบที่ยังไม่ยืนยัน = ค้างส่ง · วันล่วงหน้า: ทุกรอบ = รอ
   confirmedSet = Set ของ key ที่ยืนยันส่งแล้ว · receivedMap[key] = แถว delivery (มี received_status) */
export function getRoundStatus(r, confirmedSet, receivedMap, workDate, nowMs) {
  const key = `${r.line_name}|${r.shift}|${r.round_no}`;
  if (confirmedSet.has(key)) {
    const recv = receivedMap?.[key];
    if (recv?.received_status === 'full')
      return { label: '✔️ รับครบแล้ว', color: '#22c55e', bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', top: '#22c55e', d: recv };
    if (recv?.received_status === 'partial')
      return { label: '⚠️ รับไม่ครบ', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', top: '#f59e0b', d: recv };
    return { label: '📦 ส่งแล้ว · รอรับ', color: '#0ea5e9', bg: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.3)', top: '#0ea5e9', d: recv };
  }
  const { startMs, endMs } = dayFrameMs(workDate);
  if (nowMs < startMs) return { ...ST_WAIT, d: null };      // วันงานยังไม่เริ่ม
  if (nowMs >= endMs)  return { ...ST_OVERDUE, d: null };   // วันงานจบไปแล้วแต่ไม่มีการยืนยันส่ง
  const cutoffMs   = timeStrToMs(workDate, r.cutoff_time);
  const deliveryMs = timeStrToMs(workDate, r.delivery_time);
  const finishMs   = deliveryMs == null ? null : deliveryMs + roundDeliveryMin(r) * 60000;
  if (finishMs != null && nowMs >= finishMs) return { ...ST_OVERDUE, d: null };
  if (cutoffMs != null && deliveryMs != null && nowMs >= cutoffMs && nowMs < deliveryMs) return { ...ST_PREPARE, d: null };
  return { ...ST_WAIT, d: null };
}
