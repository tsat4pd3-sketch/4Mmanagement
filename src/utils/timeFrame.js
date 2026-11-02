/* นาทีบนกรอบวันงาน 08:00 → 08:00 (ก่อน 08:00 = ช่วงดึกของวันงาน → +1440) */
export const FRAME_START = 8 * 60;
export const frameMin = (hhmm) => {
  if (!hhmm) return null;
  const m = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  return m < FRAME_START ? m + 1440 : m;
};
export const frameMinFromIso = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return frameMin(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
};

/* แปลง break_policies (DR) → ช่วงเวลาพักบนกรอบวันงาน [{ s, e, label }] (นาที)
   กรอบเดียวยาว 24 ชม. ครอบทั้งกะเช้า-กะดึก จึงใช้ทุก policy ที่ active โดยไม่ต้องแยก shift */
export const breaksToFrame = (policies) => (policies || [])
  .map(p => {
    /* 🔚 พักที่ผูก "ปลายกะ" (`anchor = 'shift_end'` — 5ส. ท้ายกะ · `start_time = null`) วาดที่นี่ไม่ได้
       กรอบนี้ยาว 24 ชม. ครอบทั้ง 2 กะ ⇒ ไม่รู้ว่าแต่ละกะเลิกกี่โมง (17:30 / 20:00 / 17:00 วันหยุด / 08:00)
       🔴 **ข้ามอย่างตั้งใจ ไม่ใช่เผลอ** — แถบเงาหายไปเฉยๆ (ตัวเลข %A/%P ไม่เกี่ยวกับตัวนี้เลย
          เพราะคิดที่ `breakIntervalsIn` ซึ่งรับ `shiftEndMs`) · จะวาดได้ต้องส่งเวลาเลิกกะของแถวเข้ามา
          แล้วเปลี่ยนมาใช้ `breakBandsIn` (utils/oee) — ยังไม่ทำ (known gap 20/10) */
    if (p.anchor === 'shift_end') return null;
    const s = frameMin(String(p.start_time || '').slice(0, 5));
    if (s == null || isNaN(s)) return null;
    // ⚠️ duration_min มาเป็น "ข้อความ" ได้ — `s + '45'` = ต่อสตริง "72045" → แถบพัก ~50 วัน
    //    คลุมทั้งบอร์ด (oee.js coerce ไว้แล้ว ที่นี่ต้องมาตรฐานเดียวกัน · QC audit 2026-08-20 · T2-12)
    return { s, e: s + (Number(p.duration_min) || 0), label: p.name_th || p.name_en || 'พัก' };
  })
  .filter(Boolean)
  .sort((a, b) => a.s - b.s);
