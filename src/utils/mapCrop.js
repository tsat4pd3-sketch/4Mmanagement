/* ✂️ ครอปผังให้เหลือเฉพาะโซนที่มีหมุด (2026-10-16 · user "อยากให้มีฟังชั่นออโต้ครอปเอามาแค่โซนที่มีหมุด")
   ใช้ที่ `components/MachineFloorMap.jsx` (prop `autoCrop`) · pure ล้วน
   หน่วย = % ของรูปจริง (ตรงกับ pos_top/pos_left ที่เก็บใน DB) */
// กรอบที่มีหมุด (หน่วย % ของรูปจริง) + ขอบ PAD · กว้าง/สูงไม่ต่ำกว่า MIN_SPAN กันซูมจนแตก — pure
export const CROP_PAD = 7, CROP_MIN_SPAN = 28
export function cropBox(points = []) {
  const xs = [], ys = []
  for (const p of points) {
    const x = parseFloat(p?.pos_left), y = parseFloat(p?.pos_top)
    if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y) }
  }
  if (!xs.length) return { x0: 0, y0: 0, x1: 100, y1: 100 }
  const span = (lo, hi) => {
    let a = Math.min(...lo) - CROP_PAD, b = Math.max(...hi) + CROP_PAD
    if (b - a < CROP_MIN_SPAN) { const c = (a + b) / 2; a = c - CROP_MIN_SPAN / 2; b = c + CROP_MIN_SPAN / 2 }
    if (a < 0) { b -= a; a = 0 }
    if (b > 100) { a -= b - 100; b = 100 }
    return [Math.max(0, a), Math.min(100, b)]
  }
  const [x0, x1] = span(xs, xs), [y0, y1] = span(ys, ys)
  return { x0, y0, x1, y1 }
}
