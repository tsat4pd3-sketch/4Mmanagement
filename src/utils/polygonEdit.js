/* ──────────────────────────────────────────────────────────────────────────
 * polygonEdit.js — กติกาแก้กรอบ polygon บนผังโรงงาน (`/factory-map` · 2026-11-11 · คำสั่ง user)
 *
 * พิกัดทุกตัว = % ของรูปผัง (x = % ความกว้าง · y = % ความสูง · 0-100) เหมือน `factory_line_regions.points`
 * ⇒ ตัดสินมุม/ความเอียงต้องแปลงเป็นหน่วยจริงด้วย `aspect` (กว้าง ÷ สูง ของรูป) ก่อน
 *    (รูปไม่ใช่สี่เหลี่ยมจัตุรัส — dy 1% ≠ dx 1% บนจอ)
 *
 * 1) ลากแบบ "คงมุมฉาก"  — กรอบที่ทุกขอบตั้ง/นอนอยู่แล้ว ลากมุมแล้วจุดข้างเคียงเลื่อนตาม · ลากกลางขอบ = ดันทั้งด้าน
 * 2) ด่านกันพลาด          — ขยับไกลเกินเกณฑ์ = ต้องยืนยัน · เส้นตัดกันเอง = ห้ามบันทึก
 * 4) "จัดให้ตรง"          — ขอบที่เกือบตั้ง/เกือบนอน ดีดเข้าแกน · ขอบเฉียงจริง (เกินเกณฑ์) ไม่แตะ
 * pure ทั้งไฟล์ (มีเทส `__tests__/polygonEdit.test.mjs`)
 * ────────────────────────────────────────────────────────────────────────── */

/** ขอบที่เอียงจากแกนไม่เกินกี่องศา ถือว่า "ตั้ง/นอน" (ใช้ทั้งตัดสินโหมดคงมุมฉาก และปุ่มจัดให้ตรง) */
export const AXIS_TOL_DEG = 10;
/** ลากแล้วจุดใดจุดหนึ่งขยับเกินกี่ % ของผัง (แกนใดแกนหนึ่ง) = ต้องถามยืนยัน (user เลือก 15% · 11/11) */
export const JUMP_CONFIRM_PCT = 15;

const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v) => Math.min(100, Math.max(0, v));
const asp = (aspect) => (Number(aspect) > 0 ? Number(aspect) : 1);

/** ขอบจากจุด a → b เป็นแนวไหน: 'h' นอน · 'v' ตั้ง (ตัดสินด้วยแกนที่ยาวกว่า ในหน่วยจริง) */
export function edgeAxis(a, b, aspect) {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]) / asp(aspect);
  return dx >= dy ? 'h' : 'v';
}

/** มุมเอียงของขอบจากแกนที่ใกล้ที่สุด (องศา · 0 = ตรงแกนเป๊ะ) */
export function edgeTiltDeg(a, b, aspect) {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]) / asp(aspect);
  if (dx === 0 && dy === 0) return 0;
  return (Math.atan2(Math.min(dx, dy), Math.max(dx, dy)) * 180) / Math.PI;
}

/** ทุกขอบตั้ง/นอน (เอียงไม่เกิน tol) ⇒ ลากแบบคงมุมฉากได้ */
export function isAxisAligned(pts, aspect, tol = AXIS_TOL_DEG) {
  if (!Array.isArray(pts) || pts.length < 3) return false;
  return pts.every((p, i) => edgeTiltDeg(p, pts[(i + 1) % pts.length], aspect) <= tol);
}

/**
 * ลากจุดมุม vi ไป (dx, dy) · ortho=true ⇒ จุดข้างเคียงเลื่อนตาม:
 *   ขอบนอน = เพื่อนบ้านรับ dy · ขอบตั้ง = เพื่อนบ้านรับ dx ⇒ แนวขอบเดิมคงอยู่ (สี่เหลี่ยมยังเป็นสี่เหลี่ยม · L/U ยังเป็นมุมฉาก)
 * ortho=false ⇒ ขยับจุดเดียวแบบอิสระ (พฤติกรรมเดิม)
 */
export function dragVertex(base, vi, dx, dy, { ortho = false, aspect = 1 } = {}) {
  const n = base.length;
  const out = base.map(p => [p[0], p[1]]);
  out[vi] = [base[vi][0] + dx, base[vi][1] + dy];
  if (ortho && n >= 3) {
    for (const ni of [(vi - 1 + n) % n, (vi + 1) % n]) {
      if (ni === vi) continue;
      if (edgeAxis(base[vi], base[ni], aspect) === 'h') out[ni][1] += dy;
      else out[ni][0] += dx;
    }
  }
  return out.map(p => [r2(clamp(p[0])), r2(clamp(p[1]))]);
}

/** ลากกลางขอบ ei (จุด ei → ei+1) · ขยับเฉพาะแนวตั้งฉากกับขอบ (ขอบนอนเลื่อนขึ้น-ลง · ขอบตั้งเลื่อนซ้าย-ขวา) */
export function dragEdge(base, ei, dx, dy, { aspect = 1 } = {}) {
  const n = base.length;
  const a = ei, b = (ei + 1) % n;
  const axis = edgeAxis(base[a], base[b], aspect);
  return base.map((p, i) => {
    if (i !== a && i !== b) return [p[0], p[1]];
    return axis === 'h' ? [p[0], r2(clamp(p[1] + dy))] : [r2(clamp(p[0] + dx)), p[1]];
  });
}

/** ระยะที่จุดขยับมากที่สุด (% ของผัง · เอาแกนที่มากกว่า) — base/next ต้องจำนวนจุดเท่ากัน */
export function maxShiftPct(base, next) {
  if (!Array.isArray(base) || !Array.isArray(next) || base.length !== next.length) return Infinity;
  let m = 0;
  base.forEach((p, i) => { m = Math.max(m, Math.abs(next[i][0] - p[0]), Math.abs(next[i][1] - p[1])); });
  return m;
}

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function segCross(p1, p2, p3, p4) {
  const d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2), d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** เส้นขอบตัดกันเอง (รูปไขว้เป็นโบว์) — เช็คเฉพาะขอบที่ไม่ติดกัน · แตะ/ทับแนวพอดีไม่นับ */
export function isSelfIntersecting(pts) {
  const n = Array.isArray(pts) ? pts.length : 0;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;   // ขอบติดกัน
      if (segCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** ตัดสินผลการลากก่อนบันทึก: 'block' (ห้ามบันทึก) · 'confirm' (ถามก่อน) · 'ok' */
export function checkPolygonEdit(base, next, { jumpPct = JUMP_CONFIRM_PCT } = {}) {
  if (isSelfIntersecting(next)) return { verdict: 'block', reason: 'self_intersect' };
  const shift = maxShiftPct(base, next);
  if (shift > jumpPct) return { verdict: 'confirm', reason: 'jump', shift: r2(shift) };
  return { verdict: 'ok', shift: r2(shift) };
}

/**
 * จัดให้ตรง: ขอบที่เอียงไม่เกิน tol ⇒ ดีดเข้าแกน (ใช้ค่าเฉลี่ยของ 2 ปลาย)
 * ขอบที่เอียงเกิน tol = ตั้งใจเฉียง ไม่แตะ (นับใน `skewed` ให้จอบอก)
 * จุดหนึ่งมี 2 ขอบ: ขอบนอนกำหนด y · ขอบตั้งกำหนด x — คนละแกนไม่ชนกัน
 *   ถ้า 2 ขอบของจุดเดียวเป็นแนวเดียวกัน (จุดกลางเส้นตรง) ใช้ค่าเฉลี่ยรวม
 * ผลที่ทำให้เส้นตัดกันเอง ⇒ คืนรูปเดิม (`blocked: true`) ห้ามพังรูปเงียบๆ
 */
export function straightenPolygon(pts, aspect, tol = AXIS_TOL_DEG) {
  const n = Array.isArray(pts) ? pts.length : 0;
  if (n < 3) return { points: pts, changed: false, skewed: 0, blocked: false };
  const xs = pts.map(() => []), ys = pts.map(() => []);
  let skewed = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = pts[i], b = pts[j];
    if (edgeTiltDeg(a, b, aspect) > tol) { skewed++; continue; }
    if (edgeAxis(a, b, aspect) === 'h') { const y = (a[1] + b[1]) / 2; ys[i].push(y); ys[j].push(y); }
    else { const x = (a[0] + b[0]) / 2; xs[i].push(x); xs[j].push(x); }
  }
  const avg = (arr, d) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : d);
  const out = pts.map((p, i) => [r2(avg(xs[i], p[0])), r2(avg(ys[i], p[1]))]);
  const changed = out.some((p, i) => p[0] !== pts[i][0] || p[1] !== pts[i][1]);
  if (changed && isSelfIntersecting(out)) return { points: pts, changed: false, skewed, blocked: true };
  return { points: out, changed, skewed, blocked: false };
}
