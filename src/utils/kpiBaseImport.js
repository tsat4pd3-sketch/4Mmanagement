/* ══ 📥 อ่าน Excel "monthly report" ของบัญชี → ตัวเลขฐาน KPI (2026-10-15 · user: "บัญชีจะส่งไฟล์ excel มาให้ทุกเดือน ทำหน้าอัพโหลดให้อ่านเลย") ═══
   ตัวอ่านเป็นแบบ "เดาแล้วให้คนยืนยัน": หาแถวตัวแปรจากคำในป้าย (synonyms) + หาคอลัมน์เดือนจากหัวตาราง แล้วโชว์ตารางตรวจก่อนบันทึกเสมอ
   · เดาไม่เจอ = ช่องว่างให้คนเลือกเอง **ห้ามเดาเป็น 0** · pure ทั้งไฟล์ (ตัวอ่าน xlsx อยู่ในโมดัล) · เทส `kpiBaseImport.test.mjs`
   19/10 เห็นไฟล์จริง "01 Report Monthly FS <เดือน>-<ปี> TSAT P4.xlsb" (ภาพหน้าจอ 4 ชีท) ⇒ รองรับ 2 ทรง:
   · ทรง A: หัวเดือน 1 แถว คอลัมน์ละเดือน (ไฟล์ทั่วไป)
   · ทรง B (3.PL Summary · 5.Manpower): หัวเดือนเป็นช่อง merge คร่อมบล็อก `PLAN | Rolling | ACTUAL | DIFF` แล้วมีแถวย่อย `Amount | %`
     ⇒ ต้องเลือก "ACTUAL → Amount" ของแต่ละเดือน (ไม่มี ACTUAL ค่อยถอยไป Rolling · Rolling ของเดือนที่ยังไม่ปิด = แผน ⇒ จอต้องเตือน)
   · ตัวเลขใน PL Summary เป็น "ล้านบาท" โดยไม่เขียนหน่วย ⇒ `magnitudeWarning()` เตือนเมื่อตัวเงินเล็กผิดสังเกต (เตือน ไม่เดาแทน)
   · 1.Sale (เดือนเป็นแถว · ตัวเลขไม่ตรง PL) และ 8.Inventory Balance (รายคลัง P4xx · ต้องผูกคลัง→หน่วย) ยังไม่อ่าน — รอไฟล์จริง */
import { KPI_BASE_VARS } from './kpiSetup.js';

/* คำที่บัญชีมักใช้เรียกแต่ละตัวแปร (ไทย/อังกฤษ · ตัวพิมพ์ไม่สน · เว้นวรรค/ขีดไม่สน) — ลำดับสำคัญ: ตัวที่เจาะจงกว่าอยู่ก่อน */
export const VAR_SYNONYMS = {
  sale_product:   [/sales?\s*from\s*product/i, /product\s*sales?/i, /ยอดขาย(จาก)?สินค้า(ผลิต)?/, /ขายสินค้า/],
  sale_trading:   [/trading\s*goods?/i, /sales?\s*from\s*trading/i, /ซื้อมาขายไป/, /trading/i],
  sale_total:     [/total\s*sales?/i, /net\s*sales?/i, /ยอดขายรวม/, /ยอดขายสุทธิ/, /^sales?$/i, /ยอดขาย/],
  cogs:           [/total\s*cogs/i, /cogs/i, /cost\s*of\s*(goods\s*)?sold/i, /ต้นทุนขาย/],   // PL Summary มี "COGS Sale from Product" ก่อน "Total COGS" ⇒ ตัวรวมต้องชนะ
  days_in_month:  [/days?\s*(in|of|per)?\s*month/i, /จำนวนวัน/, /ตัวหารวัน/],
  dl:             [/direct\s*lab(ou?r)?/i, /^dl\b/i, /ค่าแรง(ทาง)?ตรง/, /แรงงานทางตรง/],
  oh:             [/overhead/i, /^oh\b/i, /โสหุ้ย/, /ค่าใช้จ่ายการผลิต/],
  raw_material:   [/raw\s*mat/i, /^rm\b/i, /วัตถุดิบ/],
  inventory_baht: [/inventory/i, /stock\s*value/i, /มูลค่า(สินค้า)?คงคลัง/, /สต[็ิ]อก/],
  manpower:       [/total\s*head\s*count\s*\(?\s*all/i, /man\s*power/i, /head\s*count/i, /กำลังคน/, /จำนวน(พนักงาน|คน)/],   // 5.Manpower: "Total Head count (All)" ไม่ใช่ (FAC)
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

/** หาแถวหัวเดือนในแถวเดียว (ไม่ดูแถวย่อย) → { row, cols } | null */
function monthRowOnly(grid) {
  let best = null;
  (grid || []).forEach((r, ri) => {
    if (!Array.isArray(r)) return;
    const named = {}, numeric = {};
    r.forEach((c, ci) => { const m = monthOfHeader(c); if (m) named[ci] = m; const n = monthOfHeader(c, { allowNumeric: true }); if (n) numeric[ci] = n; });
    /* เลข 1-12 ล้วน: ต้องเรียงเพิ่มขึ้นซ้าย→ขวา (หัวเดือนตัวเลขเรียงเสมอ) — แถวข้อมูลที่มี 1/2/3 กระจายอยู่ (เช่น % = 1) ไม่ใช่หัวเดือน */
    const numSeq = Object.keys(numeric).map(Number).sort((a, b) => a - b).map(k => numeric[k]);
    const numericOk = numSeq.length >= 6 && numSeq.every((m, i) => i === 0 || m > numSeq[i - 1]);
    const pick = Object.keys(named).length >= 3 ? named : (numericOk ? numeric : null);
    if (!pick) return;
    const distinct = new Set(Object.values(pick)).size;
    if (!best || distinct > best.distinct) best = { row: ri, cols: pick, distinct };
  });
  return best ? { row: best.row, cols: best.cols } : null;
}

const SUB_ACTUAL = /^actual|^act\.?$|จริง/;
const SUB_ROLLING = /^rolling|^roll/;
const SUB_AMOUNT = /^amount|^amt|จำนวนเงิน|^บาท|^mb$|^thb/;

/** ทรง B: หัวเดือนคร่อมบล็อก → หาคอลัมน์ "ACTUAL (→ Amount)" ของแต่ละเดือนในแถวย่อยถัดลงไป ≤ 3 แถว
 *  คืน { cols: {colIdx: month}, how: {month: 'actual'|'rolling'|null}, subRow } — ไม่เจอแถวย่อย = ทรง A (คอลัมน์เดิม how=null) */
export function resolveSubHeaders(grid, row, cols) {
  const ents = Object.entries(cols).map(([c, m]) => [Number(c), m]).sort((a, b) => a[0] - b[0]);
  if (!ents.length) return { cols: {}, how: {}, subRow: null };
  const gaps = ents.slice(1).map((e, i) => e[0] - ents[i][0]).filter(g => g > 0).sort((a, b) => a - b);
  const span = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1;   // ความกว้างบล็อกโดยทั่วไป (median) — ใช้กับเดือนสุดท้าย
  const outCols = {}, how = {};
  let subRow = null;
  ents.forEach(([c, m], i) => {
    const end = i + 1 < ents.length ? ents[i + 1][0] : c + span;
    let pickCol = c, pickedBy = null;
    for (let dr = 1; dr <= 3 && !pickedBy; dr++) {
      const r = grid[row + dr];
      if (!Array.isArray(r)) break;
      let act = null, roll = null;
      for (let k = c; k < end; k++) {
        const t = norm(r[k]); if (!t) continue;
        if (act == null && SUB_ACTUAL.test(t)) act = k;
        else if (roll == null && SUB_ROLLING.test(t)) roll = k;
      }
      if (act == null && roll == null) continue;
      pickCol = act ?? roll; pickedBy = act != null ? 'actual' : 'rolling'; subRow = row + dr;
      /* แถวย่อยชั้นถัดไป "Amount | %" — เอา Amount ตัวแรกก่อนถึงหัวย่อยถัดไปของแถวเดียวกัน */
      const r2 = grid[row + dr + 1];
      if (Array.isArray(r2)) {
        let nextSub = end;
        for (let k = pickCol + 1; k < end; k++) { if (norm(r[k])) { nextSub = k; break; } }
        for (let k = pickCol; k < nextSub; k++) { if (SUB_AMOUNT.test(norm(r2[k]))) { pickCol = k; break; } }
      }
    }
    outCols[pickCol] = m; how[m] = pickedBy;
  });
  return { cols: outCols, how, subRow };
}

/** หาแถวหัวเดือน: แถวที่มีคอลัมน์เดือน ≥ 3 เดือนต่างกัน (เลข 1-12 ล้วนนับเมื่อมี ≥ 6 ช่องเรียงกัน)
 *  → { row, cols: {colIdx: month}, how: {month: 'actual'|'rolling'|null}, subRow } | null · ทรง B แก้คอลัมน์เป็น ACTUAL→Amount ให้แล้ว */
export function detectMonthColumns(grid, { row = null } = {}) {
  const base = row != null ? (Array.isArray(grid?.[row]) ? monthRowOnly([grid[row]]) : null) : monthRowOnly(grid);
  if (!base) return null;
  const r = row != null ? row : base.row;
  const sub = resolveSubHeaders(grid || [], r, base.cols);
  return { row: r, cols: sub.cols, how: sub.how, subRow: sub.subRow };
}

/** ตัดเดือนที่เกิน "เดือนล่าสุดที่ปิดแล้ว" ออก — คอลัมน์ Rolling/Plan ของเดือนอนาคตมีตัวเลข (= แผน) ห้ามนำเข้าเป็นจริง */
export const limitMonths = (monthCols = {}, maxMonth = 12) => Object.fromEntries(Object.entries(monthCols).filter(([, m]) => Number(m) <= Number(maxMonth)));

/** เดือนที่ "ใช้ Rolling แทน ACTUAL" — จอต้องเตือน (Rolling ของเดือนที่ยังไม่ปิด = แผน) */
export const rollingMonths = (how = {}) => Object.entries(how).filter(([, v]) => v === 'rolling').map(([m]) => Number(m)).sort((a, b) => a - b);

/** เลือกชีทที่น่าจะใช่ที่สุด: เจอแถวหัวเดือน + จับตัวแปรได้มากสุด (ไฟล์บัญชีมี 10+ ชีท ชีทแรกไม่ใช่เสมอ) → ชื่อชีท | null */
export function bestSheet(sheets = {}) {
  let best = null;
  for (const [name, grid] of Object.entries(sheets)) {
    const mc = detectMonthColumns(grid);
    if (!mc || !Object.keys(mc.cols).length) continue;
    const n = Object.keys(detectVarRows(grid)).length;
    if (!best || n > best.n) best = { name, n };
  }
  return best?.name ?? null;
}

const MONEY_VARS = new Set(['sale_total', 'sale_product', 'sale_trading', 'cogs', 'dl', 'oh', 'raw_material', 'inventory_baht', 'cost_100p']);
/** ตัวเงินเล็กผิดสังเกต (ยอดขายโรงงานหลักร้อย) ทั้งที่เลือก "บาท ×1" ⇒ ไฟล์น่าจะเป็นล้านบาท — คืนข้อความเตือน | '' (เตือน ไม่สลับให้เอง) */
export function magnitudeWarning(values = {}, multiplier = 1) {
  if (Number(multiplier) !== 1) return '';
  let maxV = null, key = null;
  for (const [k, months] of Object.entries(values)) {
    if (!MONEY_VARS.has(k)) continue;
    for (const v of Object.values(months || {})) { if (v != null && (maxV == null || Math.abs(v) > maxV)) { maxV = Math.abs(v); key = k; } }
  }
  if (maxV == null || maxV >= 100_000) return '';
  const label = KPI_BASE_VARS.find(v => v.key === key)?.label || key;
  return `⚠ ${label} สูงสุดแค่ ${maxV.toLocaleString('th-TH')} บาท — ไฟล์บัญชีมักเป็น "ล้านบาท" โดยไม่เขียนหน่วย เช็คช่อง "หน่วยเงินในไฟล์" ก่อนนำเข้า`;
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
    /* ไล่ "ตาม pattern" ไม่ใช่ตามลำดับแถว — pattern ที่เจาะจงกว่า (Total COGS · Head count (All)) ชนะแม้อยู่แถวล่างกว่า */
    let hit = null;
    for (const p of VAR_SYNONYMS[key] || []) { hit = labels.find(x => !taken.has(x.row) && p.test(x.label)); if (hit) break; }
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
      vals[m] = key === 'manpower' || key === 'days_in_month' ? n : Math.round(n * mul * 100) / 100;   // จำนวนคน/วัน ไม่คูณหน่วยเงิน · ตัวเงินปัดที่สตางค์ (129.24 × 1e6 = 129240000.00000001)
    }
    if (Object.keys(vals).length) out[key] = vals;
  }
  return out;
}

export const IMPORT_MULTIPLIERS = [
  { value: 1, label: 'บาท (×1)' }, { value: 1000, label: 'พันบาท (×1,000)' }, { value: 1_000_000, label: 'ล้านบาท (×1,000,000)' },
];
export const importableVars = () => KPI_BASE_VARS.map(v => v.key);
