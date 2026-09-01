import { MAT_CLASSES, classByDigit, matClassOf, matColor, matDigit, matMatches, isSapMat } from './matPrefix';
import { getLineFamilyNames } from './lineHierarchy';

/* ═══════════════════════════════════════════════════════════════════════════
   ตัวเลือก "วัสดุ" ของจุด WIP (LineSetup → แท็บ 📦 จุด WIP)  · 2026-08-31

   ที่มา (feedback หน้างาน): "พาร์ทโชว์ไม่ครบ เหมือนติดฟิลเตอร์อะไรอยู่"
   ของเดิมดึง `dr_products` แล้วกรอง `.eq('line_name', selectedLine)` ตรงเป๊ะ → เหลือไม่กี่ตัว

   🔴 กฎเหล็ก — picker พาร์ทของจุด WIP ห้ามกรองด้วยไลน์ ให้ "เรียงลำดับ" เท่านั้น
   จุด WIP = บัฟเฟอร์ระหว่างขั้น ของในบัฟเฟอร์ถูกผลิตโดย **ไลน์ต้นน้ำ** แล้วถูกกินที่ไลน์นี้
   (HDF1 ปั๊ม → บัฟเฟอร์ → LASER-345 กิน) ⇒ กรองด้วยไลน์ที่ตั้งจุด = ตัดของที่ถูกต้องทิ้งเสมอ
   และแหล่งต้องเป็น **`parts_master` (ทะเบียนกลางของทุก mat)** ไม่ใช่ `dr_products` (มุมการผลิต)
   ไม่งั้นพาร์ทซื้อนอก (3xx) / วัตถุดิบ (5xx) ไม่มีทางโผล่เลย

   ⚠️ คอลัมน์ชื่อ: `parts_master.part_name` · `dr_products.name` (คนละชื่อ — select ผิด = 42703 เงียบ)
   ═══════════════════════════════════════════════════════════════════════════ */

/** ลำดับกลุ่ม — index ตรงกับค่าที่ `rankMat` คืน */
export const WIP_MAT_GROUPS = [
  '🏭 ผลิตที่ไลน์นี้',
  '🔗 ครอบครัวไลน์',
  '⬆️ ไลน์ที่ป้อนงานให้ไลน์นี้',
  '🗂️ ทะเบียนพาร์ททั้งหมด',
];

/**
 * รวมทะเบียนกลาง + มุมการผลิต เป็นลิสต์ mat เดียว
 * mat ที่มีใน dr_products แต่ยังไม่เข้าทะเบียน **ต้องไม่หาย** (ข้อมูลจริงยังมีเลขชั่วคราวอยู่)
 * @returns [{ mat_no, name, lines[] }] เรียงตาม mat_no
 */
export function mergeMatRegistry(partsMaster = [], drProducts = [], opMap = {}) {
  const byMat = new Map();
  for (const p of partsMaster) {
    if (!p?.mat_no) continue;
    byMat.set(p.mat_no, { mat_no: p.mat_no, name: p.part_name || '', lines: [] });
  }
  for (const p of drProducts) {
    if (!p?.mat_no) continue;
    const cur = byMat.get(p.mat_no) || { mat_no: p.mat_no, name: p.name || '', lines: [] };
    if (!cur.name) cur.name = p.name || '';
    if (p.line_name && !cur.lines.includes(p.line_name)) cur.lines.push(p.line_name);
    byMat.set(p.mat_no, cur);
  }
  /* รายการขั้นตอน (Operation) — อยู่เฉพาะใน dr_products (กฎ: ห้ามเอา OP เข้าทะเบียน parts_master)
     ⚠️ ต้อง "ติดป้าย" ไม่ใช่กรองทิ้ง: บัฟเฟอร์ระหว่างขั้นเก็บของหลัง OP นั้นๆ จริง
     (90031601 = ชิ้นงาน HDF1 ที่รอเข้า LASER-345) — เป็นเนื้อหาหลักของจุด WIP เลยด้วยซ้ำ */
  for (const [mat, info] of Object.entries(opMap || {})) {
    const cur = byMat.get(mat);
    if (cur) { cur.isOp = true; cur.opParent = info?.parent || null; cur.opSeq = info?.seq ?? null; }
  }
  return [...byMat.values()].sort((a, b) => String(a.mat_no).localeCompare(String(b.mat_no)));
}

/** 0 = ไลน์นี้ · 1 = ครอบครัวไลน์ · 2 = ไลน์ต้นน้ำ · 3 = ที่เหลือทั้งทะเบียน */
export function rankMat(part, { line, family, upstream }) {
  const ls = part?.lines || [];
  if (ls.includes(line)) return 0;
  if (ls.some(l => family.has(l))) return 1;
  if (ls.some(l => upstream.has(l))) return 2;
  return 3;
}

/**
 * ตัวเลือกสำหรับ <SearchSelect> — เรียงตามความน่าจะเป็น **ไม่ตัดอะไรทิ้ง**
 * @param parts ผลจาก mergeMatRegistry
 * @param lines `production_lines` (ใช้หาไลน์ลูก)
 */
export function buildWipMatOptions(parts = [], { line, lines = [], upstreamLines = new Set() } = {}) {
  /* ⚠️ ครอบครัวไลน์ = แม่ + พี่น้อง + ลูก (getLineFamilyNames) ไม่ใช่แค่ "ตัวเอง + ลูก"
     เคสที่พบบ่อยที่สุดคือ **ของลงทะเบียนที่ไลน์แม่ แต่เปิดจุด WIP ที่ไลน์ลูก**
     (เทสจับได้ตอนเขียน: เลือก Line 60 แล้วของที่ผูก LINE APRON ASSY ตกไปกลุ่มท้ายสุด) */
  const family = new Set(getLineFamilyNames(lines, line));
  family.add(line);
  return parts.map(p => {
    const r = rankMat(p, { line, family, upstream: upstreamLines });
    /* ⚠️ mat_no ของรายการ OP เป็น "ชื่อขั้นตอน" ไม่ใช่เลข SAP → เอา prefix ไปตีความไม่ได้
       ("127 (M6 มีเกลียว)" ขึ้นต้น 1 แต่ไม่ใช่ FG ส่งลูกค้า) · ติดป้าย 🔩 OP แทนป้ายประเภท */
    const opSub = p.isOp
      ? `🔩 ขั้นตอน (OP)${p.opSeq != null ? ` · OP ${p.opSeq}` : ''}${p.opParent ? ` ของ ${p.opParent}` : ' · ยังไม่ผูกพาร์ทจริง'}`
      : '';
    return {
      id: p.mat_no,
      /* ⚠️ label = เลข mat อย่างเดียว — ช่องเลือกอยู่ในแถบข้างที่แคบ ถ้าเอาชื่อมาต่อท้าย
         ค่าที่เลือกแล้วจะถูกตัดกลางคำจนอ่านไม่ออก (feedback หน้างาน) · ชื่อไปอยู่ `sub` ซึ่งตัดบรรทัดได้ */
      label: p.mat_no,
      sub: [p.name, opSub, p.lines.length ? `ผลิตที่ ${p.lines.join(' · ')}` : (p.isOp ? '' : 'ไม่ได้ผูกไลน์ผลิต (พาร์ทซื้อนอก/วัตถุดิบ)')].filter(Boolean).join(' · '),
      // ไม่ใช่ OP และไม่ใช่เลข SAP 8 หลัก = ตอบไม่ได้ ห้ามเอาตัวแรกมาแปะเป็นประเภท ('M'/'E' มั่วๆ)
      badge: p.isOp ? '🔩 OP' : (matClassOf(p.mat_no)?.short || (isSapMat(p.mat_no) ? '—' : '⚠ ไม่ใช่เลข SAP')),
      badgeColor: p.isOp ? 'var(--accent2)' : (isSapMat(p.mat_no) ? matColor(p.mat_no) : 'var(--accent2)'),
      group: WIP_MAT_GROUPS[r],
      keywords: `${p.mat_no} ${p.name} ${p.lines.join(' ')}${p.isOp ? ` OP operation ขั้นตอน ${p.opParent || ''}` : ''}`,
      isOp: !!p.isOp,
      _r: r,
    };
  }).sort((a, b) => a._r - b._r || a.id.localeCompare(b.id));
}

/* ── ประเภทวัสดุของจุด WIP ────────────────────────────────────────────────
   ⚠️ "ขั้นตอนย่อย (Operation)" เป็นตัวเลือกของตัวเอง **ไม่ใช่เบอร์ 9**
   (feedback หน้างาน 2026-08-31: เลือก "9 · เลขภายใน" แล้วเจอแต่รายการ OP → อ่านว่า OP คือเบอร์ 9)
   เบอร์ 9 = เลข SAP ภายในที่ทีมงานตั้งเอง **8 หลัก** (90031601) ซึ่งเป็นพาร์ทจริง
   OP = ชั้นขั้นตอน ไม่มีเลข MAT เลย — คนละเรื่องกันคนละชั้น ห้ามยัดรวมกัน
   ⚠️ ห้ามเพิ่ม OP เข้า `MAT_CLASSES` — นั่นคือ prefix ของเลข SAP ใช้ร่วมทั้งระบบ
      (จะไปโผล่ในตัวกรองของ Parts Master / Heijunka ที่ไม่เกี่ยวข้อง) */
export const WIP_CAT_OP = 'op';

/** ตัวเลือกใน dropdown ประเภทวัสดุ (เลข SAP + ขั้นตอนย่อย) */
export const wipCatOptions = () => [
  ...MAT_CLASSES.map(c => ({ value: c.digit, label: `${c.digit} · ${c.label}` })),
  { value: WIP_CAT_OP, label: '🔩 ขั้นตอนย่อย (Operation) — ไม่มีเลข MAT SAP' },
];

/** normalize ค่าที่เก็บใน DB → ค่าใน dropdown ('200'→'2' · 'op'→'op' · ว่าง→'') */
export const wipCatValue = (cat) => {
  const c = String(cat ?? '').trim();
  if (!c) return '';
  return c === WIP_CAT_OP ? WIP_CAT_OP : matDigit(c);
};

/** ชื่อประเภทสำหรับแสดงผล — ห้ามโชว์เลขดิบ ('9' อ่านไม่รู้เรื่อง) */
export const wipCatLabel = (cat) => {
  const v = wipCatValue(cat);
  if (!v) return '';
  if (v === WIP_CAT_OP) return '🔩 ขั้นตอนย่อย';
  return classByDigit(v)?.label || `ประเภท ${v}`;
};

/**
 * ป้ายประเภทของ "จุด WIP" — ไม่ได้เลือกไว้ ก็อนุมานจากเลข mat ให้
 * (`30052450` → Child Part ซื้อนอก · `is_operation` → ขั้นตอนย่อย)
 *
 * ⚠️ **ป้ายอย่างเดียว ไม่เขียนลง DB** — `material_category` เป็นข้อมูลซ้ำที่ derive จาก mat_no ได้
 * ปล่อยว่างไว้ก็ตอบได้ · แต่ถ้าเขียนทับให้เองแล้วคนเปลี่ยน mat ทีหลัง ป้ายจะค้างผิด (drift)
 * @returns { text, derived } — `derived` = อนุมานจากเลข mat ไม่ใช่ค่าที่คนเลือก
 */
export const wipPointCat = (cat, mat, isOp = false) => {
  const v = wipCatValue(cat);
  if (v) return { text: wipCatLabel(v), derived: false };
  if (isOp) return { text: '🔩 ขั้นตอนย่อย', derived: true };
  const c = matClassOf(mat);
  return c ? { text: c.label, derived: true } : { text: '', derived: false };
};

/**
 * กรองตามประเภทที่เลือก · คืน `hidden` เสมอ — จอต้องบอกว่าซ่อนไปกี่รายการ ห้ามหายเงียบ
 *
 * ⚠️ **ของที่ไม่ใช่เลข MAT SAP (8 หลัก) ไม่เข้าตัวกรองเลข SAP — โชว์เสมอ**
 * รายการ OP ใช้ช่อง mat_no เก็บ "ชื่อขั้นตอน" (`127 (M6 มีเกลียว)`) ⇒ ตอบไม่ได้ว่าประเภทไหน
 * กรองทิ้งคือการ *อ้าง* ว่าไม่ใช่ประเภทนั้น (หลัก "ไม่รู้ ≠ ไม่ใช่") · จำนวนน้อยจึงไม่รกจอ
 */
export function filterWipMatByCat(options = [], cat, showAll = false) {
  const v = wipCatValue(cat);
  if (!v || showAll) return { rows: options, hidden: 0, keptUnjudged: 0 };
  const noSap = (o) => o.isOp || !isSapMat(o.id);
  // เลือก "ขั้นตอนย่อย" = เอาเฉพาะของที่ไม่มีเลข MAT SAP (ไม่ใช่ของแถมจากตัวกรองอื่น)
  if (v === WIP_CAT_OP) {
    const rows = options.filter(noSap);
    return { rows, hidden: options.length - rows.length, keptUnjudged: 0 };
  }
  const rows = options.filter(o => noSap(o) || matMatches(o.id, v));
  return {
    rows,
    hidden: options.length - rows.length,
    keptUnjudged: rows.filter(noSap).length,
  };
}
