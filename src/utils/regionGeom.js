/* เรขาคณิตของกรอบไลน์บนผังโรงงาน (`factory_line_regions.points` = [[x%, y%], …]) — pure ล้วน
   ใช้ร่วม `/factory-map` (FactoryMap.jsx) + `<FactoryMiniMap>` (จอ TV `/tv`)
   ⚠️ 2 จอวาดกรอบชุดเดียวกัน ⇒ จุดยึดป้าย/พื้นที่ต้องคิดสูตรเดียวกัน (เดิมก๊อปไว้ 2 ที่ · 05/10) */

/** พื้นที่ polygon (หน่วย %²) — ใช้จัดลำดับ "กรอบใหญ่ได้เลือกที่วางป้ายก่อน" */
export const polyArea = (pts = []) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a) / 2;
};

/** จุดกึ่งกลาง (เฉลี่ยจุดยอด) */
export const centroid = (pts = []) => (pts.length
  ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
  : [50, 50]);

/** จุดยึดป้าย = กึ่งกลางแนวนอน + ขอบบนสุดของ polygon → ป้ายเกาะขอบบน ไม่ทับกลางผังไลน์ (2026-07-22) */
export const labelAnchor = (pts = []) => (pts.length
  ? [(Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2, Math.min(...pts.map(p => p[1]))]
  : [50, 50]);

/** กรอบสี่เหลี่ยมล้อม polygon (หน่วย %) → { x0, y0, x1, y1, w, h } */
export const bboxOf = (pts = []) => {
  if (!pts.length) return { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
};

/**
 * ป้ายชื่อ "ข้อความล้วนในกรอบตัวเอง" ของทุกกรอบ (กติกาเดียวกับป้าย plain ของ /factory-map)
 *  · กรอบใหญ่ได้วางก่อน · ป้ายห้ามทับกัน (ทับ = ไม่วาด — กรอบสียังบอกสถานะ แตะดูได้)
 *  · `reserved` = กล่องที่จองไว้แล้ว (ป้ายของไลน์ผิดปกติ) หน่วยเดียวกัน
 *  · wrapW/wrapH = ขนาดผังจริง (px) · ไม่รู้ขนาด = คืนตำแหน่งทุกกรอบโดยไม่กันทับ
 *  · charPx/linePx = ขนาดตัวอักษรโดยประมาณ (px)
 * คืน [{ id, name, x, y, w }] หน่วย % (x,y = มุมซ้ายบนของป้าย · w = ความกว้างสูงสุด)
 */
export function plainLabelLayout(regions = [], { wrapW = 0, wrapH = 0, reserved = [], skip = new Set(), charPx = 7.4, linePx = 18 } = {}) {
  const placed = [...reserved];
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const out = [];
  [...regions]
    .filter(r => (r.points || []).length >= 3 && !skip.has(r.line_name))
    .sort((a, b) => polyArea(b.points) - polyArea(a.points))
    .forEach((r) => {
      const bb = bboxOf(r.points);
      const [cx, cy] = centroid(r.points);
      if (!(wrapW > 0 && wrapH > 0)) { out.push({ id: r.id, name: r.line_name, x: cx, y: cy, w: Math.max(bb.w, 8), center: true }); return; }
      const wPct = Math.min((String(r.line_name).length * charPx + 8) / wrapW * 100, Math.max(bb.w, 6));
      const hPct = linePx / wrapH * 100;
      const box = { x: cx - wPct / 2, y: cy - hPct / 2, w: wPct, h: hPct };
      if (placed.some(p => hit(box, p))) return;
      placed.push(box);
      out.push({ id: r.id, name: r.line_name, ...box });
    });
  return out;
}
