import { matClassOf, matColor, matDigit, matMatches } from './matPrefix';
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
export function mergeMatRegistry(partsMaster = [], drProducts = []) {
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
    return {
      id: p.mat_no,
      label: `${p.mat_no}${p.name ? ` — ${p.name}` : ''}`,
      sub: p.lines.length ? `ผลิตที่ ${p.lines.join(' · ')}` : 'ไม่ได้ผูกไลน์ผลิต (พาร์ทซื้อนอก/วัตถุดิบ)',
      badge: matClassOf(p.mat_no)?.short || matDigit(p.mat_no) || '—',
      badgeColor: matColor(p.mat_no),
      group: WIP_MAT_GROUPS[r],
      keywords: `${p.mat_no} ${p.name} ${p.lines.join(' ')}`,
      _r: r,
    };
  }).sort((a, b) => a._r - b._r || a.id.localeCompare(b.id));
}

/**
 * กรองตามประเภทวัสดุที่เลือก (เลขตัวแรกตัวเดียว — matMatches ทนค่าเก่า '200'/'300')
 * คืน `hidden` ไปด้วยเสมอ — จอต้องบอกว่าซ่อนไปกี่รายการ ห้ามหายเงียบ
 */
export function filterWipMatByCat(options = [], cat, showAll = false) {
  const d = matDigit(cat);
  if (!d || showAll) return { rows: options, hidden: 0 };
  const rows = options.filter(o => matMatches(o.id, d));
  return { rows, hidden: options.length - rows.length };
}
