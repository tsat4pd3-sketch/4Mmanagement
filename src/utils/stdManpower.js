/**
 * กำลังคนมาตรฐาน (std_day_shift / std_night_shift = headcount ต่อกะ) — source of truth เดียวทั้งระบบ
 * เพิ่ม 2026-08-05
 *
 * ── ปัญหาเดิม ──────────────────────────────────────────────────────────────
 * `production_lines` เก็บ std_day/night_shift ได้ทั้ง "ไลน์แม่" และ "ไลน์ลูก" แต่ไม่เคยมีกฎ inherit
 * → ข้อมูลจริงเลยมี 3 convention ปนกันในตารางเดียว:
 *     HYDROFORM        แม่ 14/14 · ลูกทั้ง 6 ไลน์ก็อป 14/14 มาหมด   (ก็อปทับ)
 *     LINE APRON ASSY  แม่ 17/17 · ลูก 6+7+6 = 19                   (แม่ ≠ ผลรวมลูก)
 *     GOR / LWR BAR    แม่ 11/11 · ลูก 0/0                          (แม่อย่างเดียว)
 *   ส่วนพนักงานจริง (`employees.line_id`) ผูกกับ **ไลน์แม่ 100%** ทุกกลุ่ม
 * → แต่ละหน้าเลยเดากันเอง แล้วตอบ "ไลน์นี้มีคนกี่คน" ไม่ตรงกัน:
 *     Dashboard   28 (std + heuristic "ลูกไม่มีคน = 0" ที่พังทันทีถ้าลูกมีคนสักคน)
 *     OrderTrace  14 (own → ไม่มีค่อยรวมลูก)
 *     ProductionPlan ทิ้งไลน์แม่ทั้งดุ้น
 *
 * ── กฎที่ใช้ (ยึด pattern เดียวกับ shift_schedules: ลูกตามแม่ เว้นแต่ตั้งเอง) ──
 *   1. ตัวเลขกำลังคนของ "กลุ่ม" อยู่ที่ไลน์แม่ — ตั้งที่แม่แล้ว ห้ามบวกลูกซ้ำ
 *   2. ลูกที่ตั้งค่าเอง (แม่ไม่ได้ตั้ง) → นับที่ลูก
 *   3. คุณสมบัติไลน์ (เช่น "เดินกะดึกได้ไหม") ตกทอดจากแม่ลงลูกได้ — คนละเรื่องกับตัวเลขกำลังคน
 *
 * ── เลือกใช้ตัวไหน ────────────────────────────────────────────────────────
 *   stdCapacityOf  → การ์ดรายไลน์ + ผลรวมทั้งลิสต์ (ไม่นับซ้ำ)  ← ใช้บ่อยสุด
 *   stdGroupOf     → "กลุ่มนี้ทั้งกลุ่มกี่คน" (ไลน์แม่ + ลูกทั้งหมด)
 *   stdInheritedOf → คุณสมบัติไลน์ (มีกะดึกไหม) — ห้ามใช้รวมยอด จะซ้ำกับแม่
 */

/** ค่าที่ไลน์นี้ตั้งไว้เองตรงๆ (ไม่ inherit ไม่รวมลูก) */
export const stdOwnOf = (line, shift) =>
  (shift === 'night' ? line?.std_night_shift : line?.std_day_shift) || 0;

const findLine = (lines, name) =>
  (lines || []).find(l => String(l?.name || '').toLowerCase() === String(name || '').toLowerCase()) || null;

const childrenOf = (lines, name) =>
  (lines || []).filter(l => String(l?.parent_line_name || '').toLowerCase() === String(name || '').toLowerCase());

/**
 * กำลังคนที่ "นับได้" ของไลน์นี้ — ปลอดภัยเมื่อเอาไปบวกรวมทั้งลิสต์ (ไม่ซ้ำกับไลน์แม่)
 *   - ไลน์ลูกที่แม่อยู่ในลิสต์      → 0 เสมอ (แม่ถือยอดกลุ่ม — own หรือ rollup จากลูก)
 *   - ไลน์ลูกที่แม่โดน scope ตัด    → ค่าของตัวเอง (ไม่มีใครนับแทน)
 *   - ไลน์แม่/ไลน์เดี่ยว             → ค่าของตัวเอง · ถ้าไม่ได้ตั้ง = ผลรวมลูก
 * invariant: Σ stdCapacityOf ทั้งครอบครัว = stdGroupOf ของราก (มีเทสคุม)
 */
export function stdCapacityOf(lines, name, shift) {
  const self = findLine(lines, name);
  if (!self) return 0;
  const own = stdOwnOf(self, shift);

  if (self.parent_line_name) {
    const parent = findLine(lines, self.parent_line_name);
    /* ⚠️ ลูกที่ "แม่อยู่ในลิสต์" = 0 เสมอ — แม่เป็นคนถือยอดกลุ่ม (own หรือ rollup จากลูก)
       เดิมลูกนับตัวเองเมื่อแม่ไม่ได้ตั้งค่า → แม่ rollup ลูกด้วย = Σ ทั้งลิสต์นับซ้ำ 2 เท่า
       (เทสจับได้ 2026-08-24: แม่ 0/0 + ลูก 6+7 → รวมได้ 26 แทน 13 · QC audit รอบ 5)
       แม่อยู่นอกลิสต์ (โดน scope ตัด) = ไม่มีใครนับแทน → นับที่ตัวเอง */
    if (parent) return 0;
    return own;
  }
  if (own > 0) return own;
  return childrenOf(lines, self.name).reduce((s, c) => s + stdOwnOf(c, shift), 0);
}

/**
 * กำลังคนรวมทั้งครอบครัว (ไลน์นี้ + ไลน์ลูกทุกชั้น) — ใช้ตอบ "กลุ่มนี้มีคนกี่คน"
 * ไลน์แม่ตั้งไว้ = ค่านั้นคือยอดกลุ่ม (ห้ามบวกลูกซ้ำ) · ไม่ได้ตั้ง = บวกลูก
 */
export function stdGroupOf(lines, name, shift) {
  const self = findLine(lines, name);
  if (!self) return 0;
  const own = stdOwnOf(self, shift);
  if (own > 0) return own;
  let total = 0;
  const walk = (n, depth) => {
    if (depth > 5) return;                       // กัน parent วนกันเอง
    for (const c of childrenOf(lines, n)) {
      const cOwn = stdOwnOf(c, shift);
      if (cOwn > 0) total += cOwn; else walk(c.name, depth + 1);
    }
  };
  walk(self.name, 0);
  return total;
}

/**
 * ค่าของไลน์นี้แบบตกทอดจากไลน์แม่ (own → แม่ → ปู่)
 * ใช้ตอบ **คุณสมบัติ** ของไลน์เท่านั้น เช่น "ไลน์นี้เดินกะดึกได้ไหม" (ไลน์ลูกที่ไม่ตั้งค่า = เดินตามแม่)
 * ⚠️ ห้ามเอาไปบวกรวมทั้งลิสต์ — จะนับซ้ำกับไลน์แม่
 */
export function stdInheritedOf(lines, name, shift) {
  let cur = findLine(lines, name);
  const seen = new Set();
  while (cur && !seen.has(cur.name)) {
    const own = stdOwnOf(cur, shift);
    if (own > 0) return own;
    seen.add(cur.name);
    cur = cur.parent_line_name ? findLine(lines, cur.parent_line_name) : null;
  }
  return 0;
}

/** ไลน์นี้เดินกะดึกได้ไหม (ตัวเองตั้ง หรือ ตกทอดจากไลน์แม่) */
export const hasNightShift = (lines, name) => stdInheritedOf(lines, name, 'night') > 0;
