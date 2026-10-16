/* ══ 📥 อ่าน Excel "monthly report" ของบัญชี → ตัวเลขฐาน KPI (2026-10-15 · user: "บัญชีจะส่งไฟล์ excel มาให้ทุกเดือน ทำหน้าอัพโหลดให้อ่านเลย") ═══
   ยังไม่เห็นไฟล์จริงของบัญชี ⇒ ตัวอ่านเป็นแบบ "เดาแล้วให้คนยืนยัน": หาแถวตัวแปรจากคำในป้าย (synonyms) + หาคอลัมน์เดือนจากหัวตาราง
   แล้วโชว์ตารางตรวจก่อนบันทึกเสมอ · เดาไม่เจอ = ช่องว่างให้คนเลือกเอง **ห้ามเดาเป็น 0** · pure ทั้งไฟล์ (ตัวอ่าน xlsx อยู่ในโมดัล) · เทส `kpiBaseImport.test.mjs` */
import { KPI_BASE_VARS } from './kpiSetup.js';

/* คำที่บัญชีมักใช้เรียกแต่ละตัวแปร (ไทย/อังกฤษ · ตัวพิมพ์ไม่สน · เว้นวรรค/ขีดไม่สน) — ลำดับสำคัญ: ตัวที่เจาะจงกว่าอยู่ก่อน */
export const VAR_SYNONYMS = {
  sale_product:   [/sales?\s*from\s*product/i, /product\s*sales?/i, /ยอดขาย(จาก)?สินค้า(ผลิต)?/, /ขายสินค้า/],
  sale_trading:   [/trading\s*goods?/i, /sales?\s*from\s*trading/i, /ซื้อมาขายไป/, /trading/i],
  sale_total:     [/total\s*sales?/i, /net\s*sales?/i, /ยอดขายรวม/, /ยอดขายสุทธิ/, /^sales?$/i, /ยอดขาย/],
  cogs:           [/cogs/i, /cost\s*of\s*(goods\s*)?sold/i, /ต้นทุนขาย/],
  days_in_month:  [/days?\s*(in|of|per)?\s*month/i, /จำนวนวัน/, /ตัวหารวัน/],
  dl:             [/direct\s*lab(ou?r)?/i, /^dl\b/i, /ค่าแรง(ทาง)?ตรง/, /แรงงานทางตรง/],
  oh:             [/overhead/i, /^oh\b/i, /โสหุ้ย/, /ค่าใช้จ่ายการผลิต/],
  raw_material:   [/raw\s*mat/i, /^rm\b/i, /วัตถุดิบ/],
  inventory_baht: [/inventory/i, /stock\s*value/i, /มูลค่า(สินค้า)?คงคลัง/, /สต[็ิ]อก/],
  manpower:       [/man\s*power/i, /head\s*count/i, /กำลังคน/, /จำนวน(พนักงาน|คน)/],
  cost_100p:      [/100\s*p/i, /cost\s*reduction/i, /ลดต้นทุน/],
};

const MONTH_TOKENS = [
  ['jan', 'january', 'ม.ค.', 'มค', 'มกราคม'], ['feb', 'february', 'ก.พ.', 'กพ', 'กุมภาพันธ์'], ['mar', 'march', 'มี.ค.', 'มีค', 'มีนาคม'],
  ['apr', 'april', 'เม.ย.', 'เมย', 'เมษายน'], ['may', 'พ.ค.', 'พค', 'พฤษภาคม'], ['jun', 'june', 'มิ.ย.', 'มิย', 'มิถุนายน'],
  ['jul', 'july', 'ก.ค.', 'กค', 'กรกฎาคม'], ['aug', 'august', 'ส.ค.', 'สค', 'สิงหาคม'], ['sep', 'sept', 'september', 'ก.ย.', 'กย', 'กันยายน'],
  ['oct', 'october', 'ต.ค.', 'ตค', 'ตุลาคม'], ['nov', 'november', 'พ.ย.', 'พย', 'พฤศจิกายน'], ['dec', 'december', 'ธ.ค.', 'ธค', 'ธันวาคม'],
];
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[\s_\-–—]+/g, ' ');

/** เซลล์หัวคอลัมน์นี้คือเดือนไหน (1-12) — รับ Date (cellDates) · "Jan"/"Jan-26"/"ม.ค." · ตัวเลข 1-12 (เฉพาะเมื่อ allowNumeric) */
export function monthOfHeader(cell, { allowNumeric = false } = {}) {
  if (cell == null || cell === '') return null;
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) return cell.getMonth() + 1;
  if (typeof cell === 'number') return allowNumeric && Number.isInteger(cell) && cell >= 1 && cell <= 12 ? cell : null;
  const s = norm(cell).replace(/\./g, '.');
  if (allowNumeric && /^(0?[1-9]|1[0-2])$/.test(s)) return Number(s);
  const head = s.replace(/[^a-zก-๙.]/g, '');          // "jan-26" → "jan" · "ม.ค. 69" → "ม.ค."
  for (let i = 0; i < 12; i++) {
    if (MONTH_TOKENS[i].some(t => head === t.replace(/\./g, '.') || head.startsWith(t) && t.length >= 3)) return i + 1;
  }
  return null;
}

/** หาแถวหัวเดือน: แถวที่มีคอลัมน์เดือน ≥ 3 เดือนต่างกัน (เลข 1-12 ล้วนนับเมื่อมี ≥ 6 ช่องเรียงกัน) → { row, cols: {colIdx: month} } | null */
export function detectMonthColumns(grid) {
  let best = null;
  (grid || []).forEach((r, ri) => {
    if (!Array.isArray(r)) return;
    const named = {}, numeric = {};
    r.forEach((c, ci) => { const m = monthOfHeader(c); if (m) named[ci] = m; const n = monthOfHeader(c, { allowNumeric: true }); if (n) numeric[ci] = n; });
    const pick = Object.keys(named).length >= 3 ? named : (Object.keys(numeric).length >= 6 ? numeric : null);
    if (!pick) return;
    const distinct = new Set(Object.values(pick)).size;
    if (!best || distinct > best.distinct) best = { row: ri, cols: pick, distinct };
  });
  return best ? { row: best.row, cols: best.cols } : null;
}

/** ป้ายของแถว = เซลล์ข้อความแรกที่ไม่ว่าง (ก่อนถึงคอลัมน์ตัวเลข) */
export const rowLabel = (row) => {
  if (!Array.isArray(row)) return '';
  for (const c of row) { if (typeof c === 'string' && c.trim()) return c.trim(); }
  return '';
};
export const rowLabels = (grid) => (grid || []).map((r, i) => ({ row: i, label: rowLabel(r) })).filter(x => x.label);

/** เดาแถวของแต่ละตัวแปรจากป้าย — ตัวแปรที่เจาะจงกว่าจองแถวก่อน (sale_product/sale_trading ก่อน sale_total · ไม่งั้น "Sales from product" โดน /ยอดขาย/ กิน) */
export function detectVarRows(grid, { skipRows = new Set() } = {}) {
  const labels = rowLabels(grid).filter(x => !skipRows.has(x.row));
  const taken = new Set();
  const out = {};
  const order = ['sale_product', 'sale_trading', 'cogs', 'sale_total', 'days_in_month', 'raw_material', 'dl', 'oh', 'inventory_baht', 'manpower', 'cost_100p'];
  for (const key of order) {
    const pats = VAR_SYNONYMS[key] || [];
    const hit = labels.find(x => !taken.has(x.row) && pats.some(p => p.test(x.label)));
    if (hit) { out[key] = hit.row; taken.add(hit.row); }
  }
  return out;
}

/** ตัวเลขจากเซลล์บัญชี — "1,234.50" · "(1,234)" = ลบ · "-"/"–"/"" = ไม่มี · ตัวเลขแท้ผ่านตรง · ข้อความอื่น = null */
export function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return null;
  let s = String(v).trim();
  if (!s || /^[-–—]+$/.test(s)) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[,\s฿]/g, '').replace(/^-/, () => { neg = !neg; return ''; });
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** ดึงค่าตามแผนที่ (แถวตัวแปร × คอลัมน์เดือน) → { varKey: { month: value } } · คูณตัวคูณหน่วย (ไฟล์เป็น "พันบาท"/"ล้านบาท") */
export function extractValues(grid, { varRows = {}, monthCols = {}, multiplier = 1 } = {}) {
  const out = {};
  const mul = Number(multiplier) || 1;
  for (const [key, ri] of Object.entries(varRows)) {
    if (ri == null || !Array.isArray(grid?.[ri])) continue;
    const row = grid[ri];
    const vals = {};
    for (const [ci, m] of Object.entries(monthCols)) {
      const n = parseNum(row[Number(ci)]);
      if (n == null) continue;
      vals[m] = key === 'manpower' || key === 'days_in_month' ? n : n * mul;   // จำนวนคน/วัน ไม่คูณหน่วยเงิน
    }
    if (Object.keys(vals).length) out[key] = vals;
  }
  return out;
}

export const IMPORT_MULTIPLIERS = [
  { value: 1, label: 'บาท (×1)' }, { value: 1000, label: 'พันบาท (×1,000)' }, { value: 1_000_000, label: 'ล้านบาท (×1,000,000)' },
];
export const importableVars = () => KPI_BASE_VARS.map(v => v.key);
