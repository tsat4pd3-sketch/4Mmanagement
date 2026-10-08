/* เรขาคณิตของหมุด callout (ป้ายเลข + เส้น + ลูกศรชี้จุดจริง) — pure ล้วน เทสได้ (2026-09-21)
 *
 * แยกออกจาก `CalloutPin.jsx` เพราะ feedback หน้างาน: *"อยากปรับทิศทางลูกศร ให้ลากปรับได้
 * เพื่อไม่ให้ทับกัน"* — จุดที่อยู่ใกล้กันได้ทิศอัตโนมัติเหมือนกันหมด ป้าย/ลูกศรเลยซ้อนกัน
 *
 * โมเดล: ตำแหน่งป้าย = **offset จากจุดจริง** เก็บเป็น % ของกล่องรูป (ไม่ใช่ px)
 *   ⇒ ย่อ/ขยาย/ซูมรูป แล้วป้ายยังอยู่ทิศเดิมสัดส่วนเดิม (กฎเดียวกับ xPct/yPct ของจุด)
 * `offX/offY` เป็น null = **ใช้ทิศอัตโนมัติแบบเดิมเป๊ะ** ⇒ หมุดเก่าทุกตัวหน้าตาไม่เปลี่ยน
 */

const clampPct = (v) => Math.min(100, Math.max(0, Number(v) || 0));

/** ทิศอัตโนมัติ (พฤติกรรมเดิมตั้งแต่ 2026-07-14) — หลบขอบ: ใกล้ขวาไปซ้าย · ใกล้บนไปล่าง */
export function autoOffsetPx(xPct, yPct, size) {
  const off = size * 1.55;
  return { dx: (xPct > 72 ? -1 : 1) * off, dy: (yPct < 22 ? 1 : -1) * off };
}

/**
 * คำนวณพิกัดทั้งหมดของหมุด 1 ตัว (หน่วย px ในกล่องรูป)
 *   px,py = จุดจริง · bx,by = จุดกึ่งกลางป้ายเลข (หลัง clamp ไม่ให้หลุดกล่อง)
 * ⚠️ clamp ป้ายไว้ในกล่องเสมอ — ลากออกนอกรูปแล้วป้ายหายไปเลยคือของที่ "พังแล้วแก้ไม่ได้"
 */
export function calloutLayout({ xPct, yPct, layerW = 0, layerH = 0, size = 26, offX = null, offY = null }) {
  const px = (clampPct(xPct) / 100) * layerW;
  const py = (clampPct(yPct) / 100) * layerH;
  const custom = Number.isFinite(offX) && Number.isFinite(offY);
  const d = custom
    ? { dx: (offX / 100) * layerW, dy: (offY / 100) * layerH }
    : autoOffsetPx(clampPct(xPct), clampPct(yPct), size);
  const m = size * 0.7;
  const bx = Math.min(Math.max(m, px + d.dx), Math.max(m, layerW - m));
  const by = Math.min(Math.max(m, py + d.dy), Math.max(m, layerH - m));
  return { px, py, bx, by, custom };
}

/** px → offset % ของกล่องรูป (ใช้ตอนปล่อยเมาส์เพื่อเก็บลงฐาน) · กล่องกว้าง/สูง 0 = คืน null ห้ามหาร 0 */
export function offsetPctFromPx(px, py, bx, by, layerW, layerH) {
  if (!(layerW > 0) || !(layerH > 0)) return null;
  const r = (v) => Math.round(v * 100) / 100;          // ทศนิยม 2 ตำแหน่งพอ (ละเอียดกว่า 1 px บนจอ 4K)
  return { dx: r(((bx - px) / layerW) * 100), dy: r(((by - py) / layerH) * 100) };
}

/** ลากแล้วนับว่า "ลากจริง" หรือแค่คลิกสั่น — กันลากเสร็จแล้วไป trigger onClick (ลบหมุด/เปิด modal) */
export const DRAG_SLOP_PX = 4;
export const movedEnough = (dx, dy) => Math.hypot(dx, dy) >= DRAG_SLOP_PX;
