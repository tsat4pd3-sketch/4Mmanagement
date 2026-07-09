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
