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
  sale_trading:   [/sales?\s*from\s*trading/i, /trading\s*goods?/i, /ซื้อมาขายไป/, /trading/i],
  sale_total:     [/total\s*sales?/i, /net\s*sales?/i, /ยอดขายรวม/, /ยอดขายสุทธิ/, /^sales?$/i, /ยอดขาย/],
  cogs:           [/total\s*cogs/i, /cogs/i, /cost\s*of\s*(goods\s*)?sold/i, /ต้นทุนขาย/],   // PL Summary มี "COGS Sale from Product" ก่อน "Total COGS" ⇒ ตัวรวมต้องชนะ
  days_in_month:  [/days?\s*(in|of|per)?\s*month/i, /จำนวนวัน/, /ตัวหารวัน/],
  dl:             [/direct\s*lab(ou?r)?/i, /^dl\b/i, /ค่าแรง(ทาง)?ตรง/, /แรงงานทางตรง/],
  oh:             [/overhead/i, /^oh\b/i, /โสหุ้ย/, /ค่าใช้จ่ายการผลิต/],
  raw_material:   [/raw\s*mat/i, /^rm\b/i, /วัตถุดิบ/],
  inventory_baht: [/inventory\s*balance\s*all/i, /รวมสโตร์|รวมสต[็ิ]อก/, /inventory\s*(balance|value|total)/i, /stock\s*value/i, /มูลค่า(สินค้า)?คงคลัง/, /สต[็ิ]อก/, /inventory/i],   // 8.Inventory: แถวรวม "Inventory Balance All" ก่อนหัวเรื่อง/รายคลัง
  manpower:       [/total\s*head\s*count\s*\(?\s*all/i, /man\s*power/i, /head\s*count/i, /กำลังคน/, /จำนวน(พนักงาน|คน)/],   // 5.Manpower: "Total Head count (All)" ไม่ใช่ (FAC)
  cost_100p:      [/100\s*p/i, /ลดต้นทุน/],   // ไม่จับ "cost reduction" ลอยๆ — PL Summary มีแถว "Deduct Cost Reduction Lump Sum" (ตัวหัก ไม่ใช่ 100P · ค่า 0 ทุกเดือน)
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

/** แถวที่หน้าตาเป็นหัวเดือน (ไม่ดูแถวย่อย) ทุกแถว → [{ row, cols, distinct }] */
function monthRowCandidates(grid) {
  const out = [];
  (grid || []).forEach((r, ri) => {
    if (!Array.isArray(r)) return;
    const named = {}, numeric = {};
    r.forEach((c, ci) => { const m = monthOfHeader(c); if (m) named[ci] = m; const n = monthOfHeader(c, { allowNumeric: true }); if (n) numeric[ci] = n; });
    /* เลข 1-12 ล้วน: ต้องเรียงเพิ่มขึ้นซ้าย→ขวา (หัวเดือนตัวเลขเรียงเสมอ) — แถวข้อมูลที่มี 1/2/3 กระจายอยู่ (เช่น % = 1) ไม่ใช่หัวเดือน */
    const numCols = Object.keys(numeric).map(Number).sort((a, b) => a - b);
    const numSeq = numCols.map(k => numeric[k]);
    /* แถวดัชนี 1,2,3,…,58 ท้ายชีท (4.PL by GL) ก็เรียงเพิ่ม — ถ้าช่องถัดจาก "12" เป็น 13 แสดงว่าเป็นเลขลำดับ ไม่ใช่เดือน */
    const after12 = numSeq.length ? r[numCols[numCols.length - 1] + 1] : null;
    const numericOk = numSeq.length >= 6 && numSeq.every((m, i) => i === 0 || m > numSeq[i - 1]) && after12 !== 13;
    const isNamed = Object.keys(named).length >= 3;
    const pick = isNamed ? named : (numericOk ? numeric : null);
    if (!pick) return;
    out.push({ row: ri, cols: pick, distinct: new Set(Object.values(pick)).size, named: isNamed });
  });
  return out;
}

/** เดือนซ้ำในแถวเดียว (ไฟล์บัญชีมีบล็อกช่วยคำนวณ Jan..Dec ซ้ำ 3-4 ชุดทางขวา · 6.BY Section มี "Dec" ปีก่อนนำหน้า Jan)
 *  ⇒ เลือก "ชุดที่เรียง Jan→Dec ยาวสุด" (เสมอกันเอาซ้ายสุด = ตารางหลัก) · เดือนที่ไม่อยู่ในชุดนั้นค่อยเอาตัวแรกที่เจอ */
export function dedupeMonthCols(cols = {}) {
  const ents = Object.entries(cols).map(([c, m]) => [Number(c), Number(m)]).sort((a, b) => a[0] - b[0]);
  const runs = [];
  ents.forEach((e, i) => { if (i > 0 && e[1] === ents[i - 1][1] + 1) runs[runs.length - 1].push(e); else runs.push([e]); });
  const main = runs.reduce((b, r) => (r.length > (b?.length || 0) ? r : b), null) || [];
  const out = {};
  const have = new Set();
  main.forEach(([c, m]) => { out[c] = m; have.add(m); });
  ents.forEach(([c, m]) => { if (!have.has(m)) { out[c] = m; have.add(m); } });
  return out;
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
  const cands = row != null
    ? (Array.isArray(grid?.[row]) ? monthRowCandidates([grid[row]]).map(c => ({ ...c, row })) : [])
    : monthRowCandidates(grid);
  if (!cands.length) return null;
  /* เลือกแถว: เดือนครบกว่าชนะ · มีแถวย่อย ACTUAL ชนะ (ตารางหลัก) · เซลล์เดือนซ้ำน้อยกว่าชนะ (บล็อกช่วยคำนวณ Jan..Dec×3 แพ้ตารางหลัก) · เสมอ = แถวบน */
  let best = null;
  for (const c of cands) {
    const sub = resolveSubHeaders(grid || [], c.row, c.cols);
    const dups = Object.keys(c.cols).length - c.distinct;
    const score = c.distinct * 100 + (Object.values(sub.how).includes('actual') ? 50 : 0) - Math.min(dups, 40);
    if (!best || score > best.score) best = { row: c.row, cols: dedupeMonthCols(sub.cols), how: sub.how, subRow: sub.subRow, named: c.named, score };
  }
  return { row: best.row, cols: best.cols, how: best.how, subRow: best.subRow, named: best.named };
}

/** เดือนล่าสุดที่ "ปิดแล้ว" ตามตัวเลขในไฟล์ = เดือนสุดท้ายที่ยอดขาย/กำลังคน > 0 (เซลล์เดือนที่ยังไม่ปิดเป็น 0 — จอแสดง "-" เพราะ number format) · ไม่มี = null */
export function lastClosedMonth(values = {}) {
  let last = null;
  for (const k of ['sale_total', 'sale_product', 'manpower', 'cogs']) {
    for (const [m, v] of Object.entries(values[k] || {})) { if (v != null && Math.abs(Number(v)) > 0 && (last == null || Number(m) > last)) last = Number(m); }
  }
  return last;
}

/** เดือนจากชื่อไฟล์รายงาน — "01 Report Monthly FS Jan-2026 TSAT P4.xlsb" → 1 · ไม่เจอ = null
 *  (เดือนหลังจากนี้ในไฟล์เป็นแผน/Rolling หรือ 0 ⇒ ใช้ตั้ง "ถึงเดือน" แทนการเดาจากวันนี้) */
export function monthFromFileName(name = '') {
  const m = String(name).match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s_\-.]*(20\d\d|25\d\d)\b/i);
  return m ? monthOfHeader(m[1]) : null;
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
    /* ตัวแปรที่จับได้ + หัวเดือนเป็นชื่อเดือน (ไม่ใช่เลขดัชนี) + มีแถวย่อย ACTUAL — "4.PL by GL" จับตัวแปรได้เยอะแต่หัวเดือนเป็นแถวดัชนีท้ายชีท ต้องแพ้ "3.PL Summary" */
    const vals = extractValues(grid, { varRows: detectVarRows(grid, { sheetName: name, monthCols: mc.cols }), monthCols: mc.cols, multiplier: 1 });
    const nz = Object.values(vals).filter(m => Object.values(m).some(v => Math.abs(Number(v)) > 0)).length;   // นับเฉพาะตัวแปรที่มีค่าจริง (แถว Golf Car ใน GL เป็น 0 ล้วน)
    const n = nz + (mc.named ? 3 : 0) + (Object.values(mc.how || {}).includes('actual') ? 3 : 0);
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

/** ชนิดของชีท — ชีทสต็อก (8.Inventory Balance) มีแถว "COGS"/"Total Raw Material"/"Sale FG" ที่เป็น**คนละฐาน**กับ PL
 *  (COGS 170M vs PL 129M · RM = มูลค่าสต็อกวัตถุดิบ ไม่ใช่ต้นทุน RM) ⇒ ชีทสต็อกจับอัตโนมัติแค่ inventory_baht/days_in_month · ที่เหลือคนเลือกเองถ้าต้องการ */
export function sheetKind(grid, name = '') {
  if (/inventory|stock|สต[็ิ]อก|คงคลัง/i.test(name)) return 'inventory';
  const head = rowLabels(grid).slice(0, 3).map(x => x.label).join(' ');   // หัวเรื่อง 3 แถวแรกเท่านั้น (แถวรวม "Inventory Balance All" กลางชีทไม่นับ)
  return /inventory\s*balance/i.test(head) ? 'inventory' : 'general';
}
const INVENTORY_VARS = new Set(['inventory_baht', 'days_in_month']);
/* ป้ายที่ "มีคำตรง" แต่ไม่ใช่ตัวแปร — "Inventory Damage Expense" (ค่าใช้จ่าย ไม่ใช่มูลค่าสต็อก) · "Deduct Cost Reduction" (ตัวหัก) */
const LABEL_EXCLUDE = {
  sale_product:   /cogs|cost|gross\s*profit|\bgp\b|accumulate|สะสม|ytd|กำไร|ต้นทุน/i,   // "COGS Sale from Product" · "Gross Profit from Product" · "Accumulate …"
  sale_trading:   /cogs|cost|gross\s*profit|\bgp\b|กำไร|ต้นทุน/i,                       // "COGS Trading Goods" สั้นกว่า "Sales from Trading Goods" แต่ไม่ใช่ยอดขาย
  sale_total:     /cogs|cost|accumulate|สะสม|ytd|\/\s*head|per\s*head|ต่อหัว/i,          // "Accumulate Total Sale" · "Sale All / Head (All)"
  inventory_baht: /damage|expense|ค่าใช้จ่าย|loss|write/i,
  cost_100p:      /deduct|less\s*:/i,
};
const hasNumber = (row) => Array.isArray(row) && row.some(c => typeof c === 'number' && Number.isFinite(c));

/** เดาแถวของแต่ละตัวแปรจากป้าย — ตัวแปรที่เจาะจงกว่าจองแถวก่อน (sale_product/sale_trading ก่อน sale_total · ไม่งั้น "Sales from product" โดน /ยอดขาย/ กิน)
 *  · แถวหัวเรื่องที่ไม่มีตัวเลขเลย ("Inventory Balance (Day) - 2026") ไม่นับ · `sheetName` ใช้ตัดสินชนิดชีท (ดู sheetKind) */
export function detectVarRows(grid, { skipRows = new Set(), sheetName = '', monthCols = null } = {}) {
  const labels = rowLabels(grid).filter(x => !skipRows.has(x.row) && hasNumber(grid[x.row]));
  /* รู้คอลัมน์เดือนแล้ว → แถวที่มีตัวเลขในคอลัมน์เดือนมากกว่าชนะ (5.Manpower มีตารางย่อย "Total Sale (FG+TG+Tooling)" ที่เดือนเป็นแถว — ป้ายสั้นกว่าแต่ช่องเดือนว่าง) */
  const mcols = monthCols ? Object.keys(monthCols).map(Number) : [];
  const filled = (row) => mcols.filter(c => typeof grid[row]?.[c] === 'number').length;
  const taken = new Set();
  const out = {};
  const inv = sheetKind(grid, sheetName) === 'inventory';
  const order = ['sale_product', 'sale_trading', 'cogs', 'sale_total', 'days_in_month', 'raw_material', 'dl', 'oh', 'inventory_baht', 'manpower', 'cost_100p'];
  for (const key of order) {
    if (inv && !INVENTORY_VARS.has(key)) continue;
    /* ไล่ "ตาม pattern" ไม่ใช่ตามลำดับแถว — pattern ที่เจาะจงกว่า (Total COGS · Head count (All)) ชนะแม้อยู่แถวล่างกว่า */
    let hit = null;
    for (const p of VAR_SYNONYMS[key] || []) {
      /* pattern เดียวกันเจอหลายแถว → เอาป้าย "สั้นสุด" = บรรทัดรวม ("Raw Material" ชนะ "Cost of Sales - Raw Material-Golf Car" ใน 4.PL by GL) */
      const cands = labels.filter(x => !taken.has(x.row) && p.test(x.label) && !(LABEL_EXCLUDE[key]?.test(x.label)));
      if (cands.length) {
        hit = cands.reduce((b, x) => {
          const fx = filled(x.row), fb = filled(b.row);
          return fx !== fb ? (fx > fb ? x : b) : (x.label.length < b.label.length ? x : b);
        });
        break;
      }
    }
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
