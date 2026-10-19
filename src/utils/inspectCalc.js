/* 🧮 จุดตรวจแบบ "คำนวณ" — ค่า = จุด A − จุด B (2026-10-19 · คำขอหน้างาน)
   ใช้ทั้ง PM (`jig_checkpoints.calc`) และ QA (`qa_inspection_items.calc`) — ระบบเดียว เรียนครั้งเดียว
   📄 docs/modules/inspection-point-setup.md §จุดคำนวณ

   รูปแบบที่เก็บ: `{ op: 'diff', a: <id จุด A>, b: <id จุด B>, abs: bool }` · null = จุดวัดปกติ
   🔴 จุดคำนวณ = จุด **variable** ธรรมดาที่ค่าถูกเติมให้ ⇒ ผลลงแถวผลตรวจเหมือนค่าที่คนวัด
      (กราฟ/SPC/ประวัติ/export อ่านได้ทันที ไม่ต้องรู้จักชนิดใหม่) · ตัดสินด้วย LSL/USL ของจุดคำนวณเอง
   🔴 ค่าต้นทางว่าง/ไม่ใช่ตัวเลข = `null` (ยังคิดไม่ได้) **ห้ามเดาเป็น 0**
   🔴 อ้างได้เฉพาะจุดวัดตัวเลขที่ "ไม่ใช่จุดคำนวณ" (กันวนลูป/ลำดับคิด) · ห้ามอ้างตัวเอง · A ≠ B
   🔴 คัดลอกจุดตรวจข้ามเครื่อง/พาร์ท ต้อง remap id ผ่าน `remapCalc()` — id เดิมชี้จุดของต้นทาง */

export const CALC_OP = 'diff';

/** calc ที่ใช้ได้จริง หรือ null (ข้อมูลเพี้ยน/ไม่ครบ = ถือว่าไม่ใช่จุดคำนวณ) */
export function calcOf(p) {
  const c = p?.calc;
  if (!c || c.op !== CALC_OP || !c.a || !c.b) return null;
  return { op: CALC_OP, a: String(c.a), b: String(c.b), abs: !!c.abs };
}

const toNum = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** ค่าของจุดคำนวณจากค่า A, B — คิดไม่ได้ = null · ปัดเศษทศนิยมลอย (0.1−0.3 ไม่ให้เป็น -0.19999…) */
export function calcNumber(calc, a, b) {
  const x = toNum(a), y = toNum(b);
  if (!calc || x == null || y == null) return null;
  const d = calc.abs ? Math.abs(x - y) : x - y;
  return Math.round(d * 1e9) / 1e9;
}

/** สูตรเป็นข้อความ — "#3 − #4" / "|#3 − #4|" · `labelOf(id)` ให้แต่ละจอเลือกป้ายเอง */
export function calcFormula(calc, labelOf = (id) => id) {
  if (!calc) return '';
  const core = `${labelOf(calc.a) ?? '?'} − ${labelOf(calc.b) ?? '?'}`;
  return calc.abs ? `|${core}|` : core;
}

/**
 * ตรวจสูตรทุกจุดก่อนบันทึก — คืน [{ key, msg }] (ว่าง = ใช้ได้)
 * @param points   จุดทั้งชุดในโมดัล
 * @param o.keyOf      (p) => คีย์/id ที่ calc อ้าง
 * @param o.isNumeric  (p) => จุดนี้มีค่าตัวเลขให้คิดไหม (PM/QA นิยามต่างกัน)
 * @param o.hasLimit   (p) => จุดคำนวณตั้งเกณฑ์ตัดสินแล้วหรือยัง
 */
export function calcProblems(points, { keyOf, isNumeric, hasLimit }) {
  const byKey = new Map((points || []).map(p => [keyOf(p), p]));
  const out = [];
  for (const p of points || []) {
    const c = calcOf(p);
    if (!c) continue;
    const k = keyOf(p);
    for (const ref of [c.a, c.b]) {
      const t = byKey.get(ref);
      if (ref === k) out.push({ key: k, msg: 'อ้างตัวเองไม่ได้' });
      else if (!t) out.push({ key: k, msg: 'อ้างจุดที่ถูกลบไปแล้ว — เลือกจุดใหม่' });
      else if (calcOf(t)) out.push({ key: k, msg: 'อ้างจุดคำนวณด้วยกันไม่ได้ — เลือกจุดที่วัดจริง' });
      else if (!isNumeric(t)) out.push({ key: k, msg: 'อ้างได้เฉพาะจุดที่วัดเป็นตัวเลข' });
    }
    if (c.a === c.b) out.push({ key: k, msg: 'จุด A กับ B ต้องเป็นคนละจุด' });
    if (hasLimit && !hasLimit(p)) out.push({ key: k, msg: 'ตั้ง LSL หรือ USL ของค่าผลต่างก่อน — ไม่งั้นระบบตัดสินไม่ได้' });
  }
  return out;
}

/** ย้าย calc ไปชุดใหม่ (คัดลอกข้ามเครื่อง/พาร์ท) — ชี้จุดที่ไม่ได้ไปด้วย = null (กลายเป็นจุดวัดปกติ ไม่ชี้ของคนอื่น) */
export function remapCalc(calc, idMap) {
  const c = calcOf({ calc });
  if (!c) return null;
  const a = idMap?.[c.a], b = idMap?.[c.b];
  return a && b ? { ...c, a, b } : null;
}

/* ── PM: ค่า 3 ครั้ง (v1–v3) → ผลต่างรายครั้ง · ค่าเฉลี่ยของผลต่าง = ผลต่างของค่าเฉลี่ย ── */
export function pmCalcResults(checkpoints, results) {
  let out = results;
  for (const cp of checkpoints || []) {
    const c = calcOf(cp);
    if (!c) continue;
    const ra = results?.[c.a] || {}, rb = results?.[c.b] || {};
    const v = (k) => { const n = calcNumber(c, ra[k], rb[k]); return n == null ? '' : String(n); };
    if (out === results) out = { ...results };
    out[cp.id] = { ...(results?.[cp.id] || {}), v1: v('v1'), v2: v('v2'), v3: v('v3') };
  }
  return out;
}

/* ── QA: ฟอร์มชิ้นที่ N — ค่าเดียวต่อจุด · ต้นทางกด "ข้าม" = จุดคำนวณข้ามด้วย ── */
export function qaCalcDraft(items, draft) {
  let out = draft;
  for (const it of items || []) {
    const c = calcOf(it);
    if (!c) continue;
    const da = draft?.[c.a] || {}, db = draft?.[c.b] || {};
    const skipped = da.judge === 'na' || db.judge === 'na';
    const n = skipped ? null : calcNumber(c, da.value, db.value);
    if (out === draft) out = { ...draft };
    out[it.id] = { ...(draft?.[it.id] || {}), value: n == null ? '' : String(n), judge: skipped ? 'na' : undefined };
  }
  return out;
}
