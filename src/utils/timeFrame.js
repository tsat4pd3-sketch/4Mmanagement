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
    const s = frameMin(String(p.start_time || '').slice(0, 5));
    if (s == null || isNaN(s)) return null;
    // ⚠️ duration_min มาเป็น "ข้อความ" ได้ — `s + '45'` = ต่อสตริง "72045" → แถบพัก ~50 วัน
    //    คลุมทั้งบอร์ด (oee.js coerce ไว้แล้ว ที่นี่ต้องมาตรฐานเดียวกัน · QC audit 2026-08-20 · T2-12)
    return { s, e: s + (Number(p.duration_min) || 0), label: p.name_th || p.name_en || 'พัก' };
  })
  .filter(Boolean)
  .sort((a, b) => a.s - b.s);
