/* ═══ ปลายทางของ "สต๊อกที่อยู่ผิดที่" — เสนอลำดับ ไม่ตัดตัวเลือกทิ้ง (2026-09-03) ═════════
   ใช้กับแผง 🔀 ย้ายมินิสโตร์ (StockMoveToChild)

   ที่มา (feedback หน้างาน): "มันเลือกไป HDF1 หรือ 2 ไม่ได้ มีให้เลือกแค่ laser
   ตัวนี้เป็นเหล็กจาก supplier ที่จะต้องเข้า hdf1 หรือ 2 ก่อน แล้วผลิตเป็น OP hydroform
   ค่อยส่งเข้า laser345 หรือ laser789"  +  "ละมีไปอยู่ไลน์ apron assy อีก มั่วไปหมดเลย"

   ⚠️ ทำไมตัวเสนอเดิมมองไม่เห็น HDF1/HDF2:
      มันอ่าน **BOM ของ FG** อย่างเดียว (FG → ลูก) แล้วเอา `dr_products.line_name` ของ FG เป็นปลายทาง
      แต่ BOM ในระบบนี้ "แบน" — 5xx ถูกผูกใต้ FG 1xx โดยตรง ข้ามขั้นขึ้นรูปไปเลย
      และ **ชั้น OP ถูกห้ามเข้า BOM โดยกฎ** (CLAUDE.md: ห้ามเอารายการ OP เข้า BOM/kanban/parts_master)
      ⇒ เส้น "coil → HDF1 → OP → LASER" ไม่มีอยู่ใน BOM ตั้งแต่ต้น หา HDF1 จาก BOM ไม่มีทางเจอ

   🔴 กฎของไฟล์นี้: **เสนอลำดับ ไม่ตัดตัวเลือกทิ้ง**
      ไลน์ลูกทุกตัวของแผนกนั้นต้องอยู่ในลิสต์เสมอ + ไลน์ขึ้นรูปแผนกอื่นเมื่อแผนกนี้ไม่มี
      (เดิมเสนอได้ 1 ตัวแล้วตัดที่เหลือทิ้ง = ทางตัน เลือกตัวที่ถูกไม่ได้เลย)
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/* ไลน์ที่ "รับวัตถุดิบจาก supplier ได้โดยตรง" = ไลน์ขึ้นรูป
   pattern โรงงานนี้: coil 5xx → ปั๊ม/ไฮโดรฟอร์ม → ได้ชั้น OP/blank → ค่อยเข้าเลเซอร์/ประกอบ */
export const FORMING_TYPES = ['stamping', 'hydroform'];
export const isFormingLine = (t) => FORMING_TYPES.includes(t);

const norm = (s) => String(s ?? '').trim();
const digitOf = (mat) => {
  const m = norm(mat).replace(/[\s-]/g, '');
  return /^\d{8}$/.test(m) ? m[0] : null;      // เลข SAP จริง 8 หลักเท่านั้น (กฎ matPrefix)
};

/* ชื่อพาร์ทที่บอกว่าเป็น "ของกลางทางของงานปั๊ม" — ใช้จัดลำดับเท่านั้น ห้ามใช้สรุป
   (user ยืนยัน: "งาน blank ที่จะอยู่ไลน์ปั๊ม") · 2xx บาง เป็น blank บางเป็นชิ้นประกอบแล้ว
   เลขตัวแรกจึงตัดสินไม่ได้ ต้องดูชื่อประกอบ */
const BLANK_WORDS = ['BLANK', 'COIL', 'SHEET', 'บลั้ง', 'แบลงค์'];
export const looksLikeBlank = (partName) =>
  BLANK_WORDS.some(w => norm(partName).toUpperCase().includes(w));

/**
 * จัดลำดับปลายทางของสต๊อกที่ค้างผิดที่
 *
 * @param {string} mat
 * @param {object} ctx
 *   @param {string}   ctx.at          ไลน์ที่ของค้างอยู่ตอนนี้
 *   @param {string}   ctx.partName
 *   @param {object}   ctx.childrenOf  { parentName: [childName...] }
 *   @param {object}   ctx.typeOf      { lineName: line_type }
 *   @param {string[]} ctx.usedAt      ไลน์ที่ BOM ชี้ว่าใช้ mat นี้ (ไลน์ลูกเท่านั้น)
 *   @param {string}   ctx.madeAt      ไลน์ที่ผลิต mat นี้เอง (dr_products.line_name)
 *   @param {string[]} ctx.allLeaf     ไลน์ลูก/ไลน์เดี่ยวทั้งโรงงาน (ปลายทางที่เป็นไปได้ทั้งหมด)
 * @returns {{groups:Array, best:string|null, sure:boolean, warn:object|null, needsForming:boolean}}
 */
/** ของชิ้นนี้ต้องผ่านขั้นขึ้นรูปก่อนไหม
 *  5xx (วัตถุดิบ) = ใช่แน่นอน · 2xx ดูชื่อว่าเป็น blank/coil ไหม (เลขตัวแรกตัดสินไม่ได้)
 *  ⚠️ mat ที่ไม่ใช่เลข SAP 8 หลัก = ไม่ตัดสิน (ไม่รู้ ≠ ไม่ใช่) */
export const needsFormingFirst = (mat, partName) => {
  const d = digitOf(mat);
  return d === '5' || (d === '2' && looksLikeBlank(partName));
};

/** เตือนตอน "จ่ายพาร์ทเข้าไลน์" — ปิดที่ต้นเหตุ ไม่ให้ของไปกองผิดที่ตั้งแต่แรก
 *  🔴 เตือนอย่างเดียว ห้ามบล็อก — line_type อาจยังไม่ได้ตั้ง และบางไลน์ปั๊ม+ประกอบรวมกันจริง */
export function checkStockPlacement(mat, partName, lineType) {
  if (!needsFormingFirst(mat, partName)) return null;
  if (lineType == null || lineType === '') return null;      // ไม่รู้ประเภทไลน์ = ไม่เดา
  if (isFormingLine(lineType)) return null;
  return {
    code: 'needs_forming_line',
    text: `${digitOf(mat) === '5' ? 'วัตถุดิบ (5xx)' : 'งาน blank'} ต้องเข้าไลน์ขึ้นรูป (ปั๊ม/ไฮโดรฟอร์ม) ก่อน — ไลน์นี้เป็นขั้นถัดไป`,
  };
}

export function moveTargets(mat, ctx = {}) {
  const { at, partName, childrenOf = {}, typeOf = {}, usedAt = [], madeAt = null, allLeaf = [] } = ctx;
  const kids  = (childrenOf[at] || []).map(norm).filter(Boolean);
  const kidSet = new Set(kids);
  const type  = (n) => typeOf[n] ?? null;

  const d = digitOf(mat);
  const needsForming = needsFormingFirst(mat, partName);

  const bom     = [...new Set(usedAt.map(norm).filter(n => kidSet.has(n)))];
  const forming = kids.filter(n => isFormingLine(type(n)));
  const made    = norm(madeAt) || null;

  const seen = new Set();
  const take = (arr) => arr.filter(n => n && !seen.has(n) && (seen.add(n), true));
  const groups = [];
  const push = (key, label, note, arr) => { const l = take(arr); if (l.length) groups.push({ key, label, note, lines: l }) };

  if (needsForming) {
    /* ของยังไม่ผ่านขั้นขึ้นรูป → ไลน์ขึ้นรูปมาก่อนเสมอ แม้ BOM จะไม่ได้ชี้มา
       (BOM แบนจึงชี้ไปไลน์ปลายน้ำ ซึ่งเป็นขั้นถัดไป ไม่ใช่ที่รับวัตถุดิบ) */
    push('forming', '⭐ ไลน์ขึ้นรูปในแผนกนี้', 'วัตถุดิบ/งาน blank ต้องขึ้นรูปก่อน', forming);
    if (made && kidSet.has(made)) push('made', '⭐ ไลน์ที่ผลิตพาร์ทนี้', 'จาก Product Master', [made]);
    /* แผนกนี้ไม่มีไลน์ขึ้นรูปเลย = ของอยู่ผิดแผนก ปลายทางที่ถูกอยู่คนละแผนก
       ⚠️ ต้องเสนอข้ามแผนก ไม่งั้นไม่มีตัวเลือกไหนถูกเลย (เคสจริง coil ค้างที่ LINE APRON ASSY) */
    if (!forming.length) {
      const outside = allLeaf.map(norm).filter(n => !kidSet.has(n) && n !== norm(at) && isFormingLine(type(n)));
      const madeOut = made && !kidSet.has(made) ? [made] : [];
      push('made_out', '⭐ ไลน์ที่ผลิตพาร์ทนี้ (คนละแผนก)', 'จาก Product Master', madeOut);
      push('forming_out', '🏭 ไลน์ขึ้นรูปแผนกอื่น', 'แผนกนี้ไม่มีไลน์ขึ้นรูป', outside);
    }
    push('bom', '📋 ตาม BOM (ขั้นถัดไป)', 'BOM ชี้มา แต่เป็นขั้นหลังขึ้นรูป', bom);
  } else {
    push('bom', '⭐ ตาม BOM', 'ไลน์ที่ใช้พาร์ทนี้จริง', bom);
    if (made && kidSet.has(made)) push('made', 'ไลน์ที่ผลิตพาร์ทนี้', 'จาก Product Master', [made]);
  }
  push('rest', '📦 ไลน์ลูกอื่นในแผนกนี้', null, kids);

  const top   = groups[0]?.lines || [];
  const total = groups.reduce((s, g) => s + g.lines.length, 0);

  /* เตือนเมื่อของอยู่ผิดแผนกจริงๆ — ไม่ใช่แค่ผิดชั้น
     เตือนอย่างเดียว ไม่บล็อก (บางไลน์ปั๊ม+ประกอบรวมกันจริง) */
  let warn = null;
  if (needsForming && !forming.length) warn = {
    code: 'no_forming_in_dept',
    text: `${d === '5' ? 'วัตถุดิบ (5xx)' : 'งาน blank'} ค้างอยู่แผนกที่ไม่มีไลน์ขึ้นรูป — ปลายทางที่ถูกน่าจะอยู่คนละแผนก`,
  };

  return {
    groups,
    best: top.length === 1 ? top[0] : null,
    sure: top.length === 1,
    warn,
    needsForming,
    total,
  };
}
