/* ═══ 📊 อ่านไฟล์ MB52 (ยอดคงคลัง SAP ราย MAT × รหัสคลัง) — 2026-11-20 · คำสั่ง user "รายงานเทียบกับ SAP รายสัปดาห์"

   🔴 ไฟล์ที่ SAP คายออกมา = TSV UTF-16LE ตั้งนามสกุล .xls ("Dynamic List Display") — ถอดรหัสด้วย
      `decodeSapExport()` ของ `sapBomImport.js` ตัวเดียวกัน (ห้ามเขียนตัวถอดรหัสชุดที่ 2)
   🔴 layout ต่างกันได้ตามคนที่ export (ลำดับคอลัมน์ · คอลัมน์มูลค่า · คอลัมน์เกิน) ⇒ **หาแถวหัวตารางจากชื่อคอลัมน์**
      ต้องมี: Material · SLoc · Unrestr. · ถ้ามีจะใช้: Material Description · BUn · Qual.Insp. · Blocked · Plnt
      หาไม่เจอ = คืน error พร้อมหัวที่เจอ **ห้ามเดาตำแหน่งคอลัมน์**
   · MAT เดียวกันหลายบรรทัด (แยก batch/ราคา) = รวมยอดราย SLoc×MAT · ข้ามบรรทัดรวม (`*`) / หัวซ้ำหน้าใหม่ / แถวว่าง
   · ตัวเลขแบบ SAP "1,480.000" ผ่าน `sapNum()` (ตัวเดียวกับนำเข้า BOM — รูปแบบ ทศนิยม "." เท่านั้น)
   · วันที่บนหัวไฟล์ "20.11.2026" → `reportDate` (YYYY-MM-DD) · ไม่มี = null (ห้ามเดา)
   pure — เทส `__tests__/mb52Import.test.mjs` */
import { decodeSapExport, sapNum } from './sapBomImport.js';

const norm = (s) => String(s ?? '').trim();
const key = (s) => norm(s).toLowerCase().replace(/\.+$/, '').replace(/\s+/g, ' ');

/* ชื่อหัวคอลัมน์ที่รับ (เทียบแบบตรงตัวหลัง normalize) — เจอชื่อใหม่ในไฟล์จริง เพิ่มที่นี่ที่เดียว */
const HEAD = {
  mat:   ['material', 'material number', 'material no'],
  desc:  ['material description', 'material desc'],
  sloc:  ['sloc', 'storage location', 'stor. loc', 'stor.loc', 'storage loc'],
  plant: ['plnt', 'plant'],
  unr:   ['unrestr', 'unrestricted', 'unrestricted use', 'unrestr. use', 'unrestricted stock'],
  qi:    ['qual.insp', 'qual. insp', 'quality inspection', 'in quality insp', 'in qual. insp'],
  blk:   ['blocked', 'blocked stock'],
  bun:   ['bun', 'base unit', 'base unit of measure', 'base uom'],
};
const REQUIRED = ['mat', 'sloc', 'unr'];
const LABEL = { mat: 'Material', sloc: 'SLoc', unr: 'Unrestr.' };

function headCols(cells) {
  const col = {};
  cells.forEach((c, i) => {
    const k = key(c);
    for (const [role, names] of Object.entries(HEAD)) if (col[role] == null && names.includes(k)) col[role] = i;
  });
  return col;
}

/** "20.11.2026" / "20/11/2026" → "2026-11-20" (ไม่เจอ = null) */
export function mb52ReportDate(text) {
  const m = String(text || '').slice(0, 400).match(/\b(\d{2})[./](\d{2})[./](\d{4})\b/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * @param {string} text ข้อความไฟล์ (ถอดรหัสแล้ว)
 * @returns {{ ok, error?, headers?, reportDate, srcRows, rows:[{sloc,mat_no,mat_desc,bun,unrestricted,qual_insp,blocked,src_rows}], slocs, total, warnings }}
 */
export function parseMb52(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.split('\t'));
  const hi = lines.findIndex(r => { const c = headCols(r); return REQUIRED.every(k => c[k] != null); });
  const reportDate = mb52ReportDate(text);
  if (hi < 0) {
    const guess = lines.find(r => r.filter(c => norm(c)).length >= 3) || [];
    return {
      ok: false, reportDate, rows: [], slocs: [], total: 0, srcRows: 0, warnings: [],
      headers: guess.map(norm).filter(Boolean),
      error: `หาหัวตารางไม่เจอ — ต้องมีคอลัมน์ ${REQUIRED.map(k => LABEL[k]).join(' · ')} (SAP ภาษาอังกฤษ) · ส่งไฟล์ให้ผู้ดูแลเพิ่มชื่อคอลัมน์`,
    };
  }
  const col = headCols(lines[hi]);
  const warnings = [];
  if (col.qi == null) warnings.push('ไฟล์ไม่มีคอลัมน์ Qual.Insp. — ยอดตรวจคุณภาพถือเป็น 0');
  if (col.blk == null) warnings.push('ไฟล์ไม่มีคอลัมน์ Blocked — ยอดบล็อกถือเป็น 0');
  const headKey = lines[hi].map(key).join('|');
  const agg = new Map();
  let srcRows = 0, badNum = 0;
  for (const r of lines.slice(hi + 1)) {
    if (r.map(key).join('|') === headKey) continue;               // หัวซ้ำตอนขึ้นหน้าใหม่
    const mat = norm(r[col.mat]);
    const sloc = norm(r[col.sloc]).toUpperCase();
    if (!mat || !sloc || r.some(c => norm(c) === '*')) continue;  // บรรทัดรวม / ว่าง
    const unr = sapNum(r[col.unr]);
    if (unr == null) { badNum++; continue; }
    srcRows++;
    const k = `${sloc}|${mat}`;
    const a = agg.get(k) || { sloc, mat_no: mat, mat_desc: '', bun: '', unrestricted: 0, qual_insp: 0, blocked: 0, src_rows: 0 };
    a.mat_desc = a.mat_desc || (col.desc != null ? norm(r[col.desc]) : '');
    a.bun = a.bun || (col.bun != null ? norm(r[col.bun]) : '');
    a.unrestricted += unr;
    a.qual_insp += col.qi != null ? (sapNum(r[col.qi]) || 0) : 0;
    a.blocked += col.blk != null ? (sapNum(r[col.blk]) || 0) : 0;
    a.src_rows += 1;
    agg.set(k, a);
  }
  if (badNum) warnings.push(`ข้าม ${badNum} บรรทัดที่อ่านยอด Unrestr. ไม่ได้`);
  const rows = [...agg.values()];
  if (!rows.length) return { ok: false, reportDate, rows, slocs: [], total: 0, srcRows, warnings, error: 'ไฟล์ไม่มีแถวยอด (เจอหัวตารางแต่ไม่มีข้อมูล)' };
  return {
    ok: true, reportDate, rows, srcRows, warnings,
    slocs: [...new Set(rows.map(r => r.sloc))].sort(),
    total: rows.reduce((t, r) => t + r.unrestricted, 0),
  };
}

/** ArrayBuffer ของไฟล์ → ผล parseMb52 (ถอดรหัสแบบ SAP export) */
export function parseMb52File(buf) {
  return parseMb52(decodeSapExport(buf));
}

/* ── ฝั่งจอ: สรุปผลเทียบ ── */
export const diffOf = (r) => (Number(r?.esm_qty) || 0) - (Number(r?.sap_qty) || 0);
export const ESM_BASIS_LABEL = {
  line: 'ไลน์ที่ผูกกับรหัสคลัง',
  pile: 'กอง STORE/FG ตามที่จัดเก็บหลักของพาร์ท',
  pile_unknown: 'กอง STORE/FG — พาร์ทยังไม่ได้ตั้งที่จัดเก็บหลัก',
};

/** สรุปราย SLoc: ยอด SAP · ESM · จำนวน MAT ตรง/ต่าง · ผลรวมส่วนต่างสัมบูรณ์ */
export function summarizeBySloc(rows = []) {
  const m = new Map();
  for (const r of rows) {
    const s = m.get(r.sloc) || { sloc: r.sloc, sap: 0, esm: 0, mats: 0, match: 0, diff: 0, absDiff: 0 };
    const d = diffOf(r);
    s.sap += Number(r.sap_qty) || 0; s.esm += Number(r.esm_qty) || 0; s.mats += 1;
    if (d === 0) s.match += 1; else { s.diff += 1; s.absDiff += Math.abs(d); }
    m.set(r.sloc, s);
  }
  return [...m.values()].sort((a, b) => b.absDiff - a.absDiff);
}

/** คำใบ้สาเหตุ (ณ ตอนตรึงยอด) — คืนข้อความสั้นๆ ไว้โชว์ข้างแถว */
export function hintsOf(r) {
  const out = [];
  const n = (v) => Number(v) || 0;
  if (n(r.hint_gap) > 0) out.push(`ไลน์ใช้แล้วแต่สโตร์ยังไม่ลงจ่าย ${n(r.hint_gap).toLocaleString()}`);
  if (n(r.hint_rcpt) > 0) out.push(`รอรับเข้าคลัง ${n(r.hint_rcpt).toLocaleString()}`);
  if (n(r.hint_po) > 0) out.push(`ใบสั่งซื้อยังไม่กดรับ ${n(r.hint_po).toLocaleString()}`);
  if (r.esm_basis === 'pile_unknown') out.push('พาร์ทยังไม่ได้ตั้งที่จัดเก็บหลัก');
  if (r.sap_qty == null) out.push('ไม่มีใน SAP รหัสนี้');
  else if (r.esm_qty == null) out.push('ไม่มีในระบบเรารหัสนี้');
  return out;
}
