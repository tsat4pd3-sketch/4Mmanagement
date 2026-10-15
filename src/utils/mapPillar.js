/* ─────────────────────────────────────────────────────────────────────────────
   🧊 ผังโรงงานโหมด 3D (2.5D) — ความสูงของเสาบนผัง                     (2026-10-14 · mockup ตามคำขอ user)

   เสาตั้งขึ้นจากจุดกลางกรอบไลน์ · สี = หมวดสถานะเดิมของ metric (CAT) · **ความสูงต้องบอกความหมายเดียวต่อจอ**
   · metric OEE ที่มีค่าจริง → สูง = %OEE (0-100)
   · metric อื่น → สูง = "ความรุนแรง" ของหมวดสถานะ (ปัญหายิ่งหนัก ยิ่งสูง — กวาดตาเห็นก่อน)
   🔴 OEE ไม่มีค่า (ไม่มีกะ/ไม่รู้ CT) = ใช้ความสูงต่ำสุดของหมวดนั้น **ห้ามเดาเป็นค่ากลาง** · จอต้องเขียนว่าสูงแปลว่าอะไร
   ⚠️ pure — ห้าม import supabase
   ───────────────────────────────────────────────────────────────────────────── */

export const SEVERITY_H = { down: 1, bad: 0.75, ok: 0.5, busy: 0.32, good: 0.22, waiting: 0.22, idle: 0.06 };

/** → { h: 0..1, basis: 'oee'|'severity' } */
export function pillarHeight(metric, cat, oee) {
  if (metric === 'oee') {
    if (oee != null && Number.isFinite(Number(oee))) return { h: Math.max(0.04, Math.min(1, Number(oee) / 100)), basis: 'oee' };
    return { h: 0.04, basis: 'oee' };
  }
  return { h: SEVERITY_H[cat] ?? 0.06, basis: 'severity' };
}

export const pillarLegend = (metric) => (metric === 'oee'
  ? 'ความสูงกล่อง/เสา = %OEE (ไม่มีค่า = เตี้ยสุด)'
  : 'ความสูงกล่อง/เสา = ความรุนแรง · ยิ่งมีปัญหายิ่งสูง (แดง > ส้ม > เหลือง > เขียว > เทา)');

/* ── ป้ายหัวเสาหลบกันด้วย "แกน Z" (15/10 · คำสั่ง user) ──────────────────────────────────────────
   ผัง 2D หนีกันได้แค่ X/Y (ไลน์ติดกัน = ป้ายทับ) · โหมด 3D ยกป้ายขึ้นสูงจากหัวเสาได้ แล้วโยงเส้นตั้งกลับลงมา
   วิธี: ฉายตำแหน่งป้ายลงจอ (หมุน Z แล้วเอียง X แบบ orthographic — perspective ไกลพอที่จะละได้)
         → วางทีละใบ ใบสำคัญก่อน (เสาสูง = รุนแรงกว่า) · ทับใบที่วางแล้ว = ยกขึ้นทีละครึ่งป้าย
   🔴 ยกเกินเพดานแล้วยังทับ = คืน `ok:false` (จอวาดแบบย่อ) ห้ามยกไม่สิ้นสุดจนป้ายหลุดจอ
   หน่วย: px ของผังก่อน scale (ทุกอย่างถูก scale เท่ากัน จึงเทียบกันได้ตรง) */
const rad = (d) => d * Math.PI / 180;

/** กว้างป้ายโดยประมาณ (px) — ตัวอักษร 12px ~6.8px/ตัว + padding */
export const labelWidthOf = (it, charPx = 6.8) => {
  const nameLen = String(it.name || '').length + (it.group ? 2 + (it.kids ? 6 : 0) : 0) + (it.blink ? 2 : 0);
  return Math.max(nameLen, String(it.text || '').length) * charPx + 20;
};

/**
 * @param {Array<{key,x,y,h}>} items   x/y = % ของผัง · h = 0..1 (สัดส่วนของ maxH)
 * @returns {Map<key,{lift:number, ok:boolean}>}
 */
export function liftLabels(items = [], { Wpx = 0, Hpx = 0, tiltDeg = 48, rotZDeg = -28, maxH = 100, labelH = 36, gap = 10, maxLift = null, charPx = 6.8 } = {}) {
  /* gap กว้างเผื่อ perspective (ป้ายที่ยกสูง = ใกล้คนดูขึ้น = ขยายและเลื่อนเล็กน้อย · การฉายนี้เป็น orthographic) */
  const out = new Map();
  if (!(Wpx > 0 && Hpx > 0)) { items.forEach(it => out.set(it.key, { lift: 0, ok: true })); return out; }
  const t = rad(tiltDeg), r = rad(rotZDeg), sinT = Math.sin(t), cosT = Math.cos(t);
  const cap = maxLift ?? maxH * 1.6;
  const step = (labelH / 2) / Math.max(0.2, sinT);
  const proj = (it) => {
    const lx = (it.x / 100 - 0.5) * Wpx, ly = (it.y / 100 - 0.5) * Hpx;
    return { sx: lx * Math.cos(r) - ly * Math.sin(r), ry: lx * Math.sin(r) + ly * Math.cos(r) };
  };
  const hit = (a, b) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
  const placed = [];
  const order = items.map(it => ({ it, p: proj(it) }))
    .sort((a, b) => (b.it.h - a.it.h) || (b.p.ry - a.p.ry));   // สำคัญก่อน · เท่ากัน = ใบหน้า (ใกล้คนดู) ก่อน
  for (const { it, p } of order) {
    const w = labelWidthOf(it, charPx);
    const H = Math.max(4, it.h * maxH);
    let lift = 0, box = null, ok = false;
    for (; lift <= cap; lift += step) {
      const sy = p.ry * cosT - (H + 6 + lift) * sinT;
      box = { x0: p.sx - w / 2, x1: p.sx + w / 2, y0: sy - labelH, y1: sy };
      if (!placed.some(b => hit(box, b))) { ok = true; break; }
    }
    if (!ok) { lift = Math.min(lift, cap); }
    placed.push(box);
    out.set(it.key, { lift: Math.round(lift), ok });
  }
  return out;
}

/* ── 🔄 มุมกล้องผัง 3D (15/10 · คำสั่ง user "หมุนภาพได้มั้ย") ──────────────────────────────────── */
export const ORBIT_DEFAULT = { rot: -28, tilt: 48 };
export const TILT_MIN = 25, TILT_MAX = 70;   // ต่ำกว่า 25 = แทบมองจากบนลงล่าง (กล่องหาย) · เกิน 70 = เกือบนอนราบ ผังด้านหลังหลุดจอ
export const clampTilt = (t) => Math.max(TILT_MIN, Math.min(TILT_MAX, Number.isFinite(+t) ? +t : ORBIT_DEFAULT.tilt));
/** มุมหมุน → ช่วง (-180, 180] — กันเลขบวมไม่สิ้นสุดตอนหมุนอัตโนมัติทั้งวันบนจอ TV */
export const normDeg = (d) => { const x = ((Number(d) || 0) % 360 + 360) % 360; return x > 180 ? x - 360 : x; };
/** 🔴 หมุนได้แค่รอบแกนตั้ง (Z) และ **ไม่ครบรอบ** — ±ROT_SPAN จากมุมเริ่มต้น (คำสั่ง user 15/10 "อย่าให้หมุน 360 องศา")
 *  หมุนเลยครึ่งรอบ = ผังกลับหัว ซ้าย-ขวาสลับกับที่คนหน้างานคุ้น ⇒ หลงทิศ */
export const ROT_SPAN = 45;
export const ROT_MIN = ORBIT_DEFAULT.rot - ROT_SPAN, ROT_MAX = ORBIT_DEFAULT.rot + ROT_SPAN;
/* ⚠️ ห้าม normDeg ก่อนบีบ — ลากไกลๆ แล้ววนเลข (1722° → -78°) จะเด้งไปขอบตรงข้าม */
export const clampRot = (r) => Math.max(ROT_MIN, Math.min(ROT_MAX, Number.isFinite(+r) ? +r : ORBIT_DEFAULT.rot));
/** ลากเมาส์/นิ้ว → มุมใหม่ (ซ้าย-ขวา = หมุน · ขึ้น-ลง = ก้ม/เงย) — บีบทั้ง 2 แกนในช่วงที่อนุญาต */
export const orbitFromDrag = (start, dx, dy) => ({ rot: clampRot(start.rot + dx * 0.35), tilt: clampTilt(start.tilt - dy * 0.25) });
/** ก้าวถัดไปของทัวร์ — แกว่งไป-กลับในช่วง (ไม่วนรอบ) · คืน { rot, dir } */
export function tourNext(rot, dir, stepDeg = 22.5) {
  let d = dir >= 0 ? 1 : -1;
  let next = rot + d * stepDeg;
  if (next > ROT_MAX + 0.01 || next < ROT_MIN - 0.01) { d = -d; next = rot + d * stepDeg; }
  return { rot: clampRot(next), dir: d };
}
/** ขยับเกินกี่ px ถึงนับเป็น "ลากหมุน" ไม่ใช่ "คลิกเปิดไลน์" */
export const DRAG_SLOP = 6;

/** สเกลให้ผังที่หมุนแล้ว "พอดีกรอบเท่ามุมเริ่มต้น" — หมุนไป 90° ผังกว้างกลายเป็นยาว ถ้าสเกลคงที่จะหลุดจอ
 *  hw = สูง/กว้างของรูปผัง · เทียบขนาดที่ฉายลงจอ (แกน X / แกน Y) กับมุมเริ่มต้น แล้วเอาตัวที่ต้องย่อมากกว่า */
export function orbitScale(rot, tilt, hw, base = 0.72) {
  const a = Number.isFinite(hw) && hw > 0 ? hw : 0.6;
  const proj = (r, t) => {
    const c = Math.abs(Math.cos(rad(r))), s = Math.abs(Math.sin(rad(r)));
    return { x: c + a * s, y: (s + a * c) * Math.cos(rad(t)) };
  };
  const p0 = proj(ORBIT_DEFAULT.rot, ORBIT_DEFAULT.tilt), p = proj(rot, tilt);
  return +(base * Math.min(p0.x / p.x, p0.y / p.y, 1.15)).toFixed(3);
}
