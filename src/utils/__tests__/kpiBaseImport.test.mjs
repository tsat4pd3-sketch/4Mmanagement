import test from 'node:test';
import assert from 'node:assert/strict';
import { monthOfHeader, detectMonthColumns, detectVarRows, parseNum, extractValues, rowLabels } from '../kpiBaseImport.js';

const grid = [
  ['TSAT Monthly Report FY2026', null, null],
  ['Item', 'Jan-26', 'Feb-26', 'Mar-26', 'Apr-26', 'May-26', 'Jun-26', 'Total'],
  ['Total Sales', '150,000,000', 120000000, '(5,000)', '-', null, 100],
  ['Sales from product', 140000000, 110000000, 1, 1, 1, 1],
  ['Sales from trading goods', 10000000, 10000000],
  ['Direct Labour (DL)', '1,200,000.50', 1000000],
  ['Overhead', 800000, 900000],
  ['Raw Material', 70000000, 60000000],
  ['COGS', 120000000, 100000000],
  ['Manpower (head)', 300, 310],
];

test('monthOfHeader: Date · Jan/Jan-26 · ม.ค./ม.ค. 69 · เลข 1-12 เฉพาะเมื่ออนุญาต · ข้อความอื่น = null', () => {
  assert.equal(monthOfHeader(new Date(2026, 8, 1)), 9);
  assert.equal(monthOfHeader('Jan'), 1); assert.equal(monthOfHeader('Jan-26'), 1); assert.equal(monthOfHeader('September 2026'), 9);
  assert.equal(monthOfHeader('ม.ค.'), 1); assert.equal(monthOfHeader('ม.ค. 69'), 1); assert.equal(monthOfHeader('ธันวาคม'), 12);
  assert.equal(monthOfHeader(3), null); assert.equal(monthOfHeader(3, { allowNumeric: true }), 3); assert.equal(monthOfHeader(13, { allowNumeric: true }), null);
  assert.equal(monthOfHeader('Total'), null); assert.equal(monthOfHeader('Item'), null);
});

test('detectMonthColumns: เจอแถวหัวเดือนแล้ว map คอลัมน์→เดือน · ไม่นับคอลัมน์ Total', () => {
  const r = detectMonthColumns(grid);
  assert.equal(r.row, 1);
  assert.deepEqual(r.cols, { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 });
  assert.equal(detectMonthColumns([['a', 'b'], ['x', 1]]), null);
  // เลข 1-12 ล้วน ต้องมี ≥ 6 ช่อง
  assert.deepEqual(detectMonthColumns([['', 1, 2, 3, 4, 5, 6, 7]]).cols, { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7 });
  assert.equal(detectMonthColumns([['', 1, 2, 3]]), null);
});

test('detectVarRows: ตัวเจาะจงจองก่อน — "Sales from product" ไม่โดน Total Sales กิน · ป้ายไทย/ตัวย่อ', () => {
  const v = detectVarRows(grid);
  assert.equal(v.sale_total, 2); assert.equal(v.sale_product, 3); assert.equal(v.sale_trading, 4);
  assert.equal(v.dl, 5); assert.equal(v.oh, 6); assert.equal(v.raw_material, 7); assert.equal(v.cogs, 8); assert.equal(v.manpower, 9);
  const th = detectVarRows([['ยอดขายรวม', 1], ['ยอดขายจากสินค้า', 2], ['ค่าแรงทางตรง', 3], ['ค่าโสหุ้ย', 4], ['ต้นทุนวัตถุดิบ', 5], ['กำลังคน', 6]]);
  assert.deepEqual(th, { sale_total: 0, sale_product: 1, dl: 2, oh: 3, raw_material: 4, manpower: 5 });
  assert.deepEqual(detectVarRows([['อะไรก็ไม่รู้', 1]]), {});
});

test('parseNum: คอมม่า · วงเล็บลบ · ขีด = ไม่มี · ข้อความ = null · 0 จริงคือ 0', () => {
  assert.equal(parseNum('150,000,000'), 150000000); assert.equal(parseNum('1,200,000.50'), 1200000.5);
  assert.equal(parseNum('(5,000)'), -5000); assert.equal(parseNum('-'), null); assert.equal(parseNum(''), null); assert.equal(parseNum(null), null);
  assert.equal(parseNum('abc'), null); assert.equal(parseNum(0), 0); assert.equal(parseNum('-12'), -12); assert.equal(parseNum(new Date()), null);
});

test('extractValues: คูณตัวคูณหน่วยเฉพาะตัวเงิน · กำลังคน/วันไม่คูณ · ช่องว่าง/ขีดไม่ใส่ (ห้ามเป็น 0)', () => {
  const mc = detectMonthColumns(grid).cols;
  const v = extractValues(grid, { varRows: detectVarRows(grid), monthCols: mc, multiplier: 1000 });
  assert.equal(v.sale_total[1], 150000000 * 1000); assert.equal(v.sale_total[3], -5000 * 1000);
  assert.equal(v.sale_total[4], undefined, 'ขีด = ไม่มีค่า'); assert.equal(v.sale_total[5], undefined);
  assert.equal(v.manpower[1], 300, 'กำลังคนไม่คูณ');
  assert.equal(v.dl[1], 1200000.5 * 1000);
  assert.equal(extractValues(grid, { varRows: { dl: 99 }, monthCols: mc }).dl, undefined);
  assert.equal(rowLabels(grid).length, 10);
});

/* ── 19/10 ไฟล์จริง "01 Report Monthly FS Jan-2026 TSAT P4.xlsb" (ภาพหน้าจอ) ───────────────────────────── */
import { resolveSubHeaders, limitMonths, rollingMonths, bestSheet, magnitudeWarning, dedupeMonthCols, monthFromFileName, lastClosedMonth, sheetKind } from '../kpiBaseImport.js';

/* ทรง B — ชีท "3.PL Summary": หัวเดือน merge คร่อม PLAN|Rolling|ACTUAL|DIFF · แถวย่อย Amount|% · ตัวเลขเป็นล้านบาทไม่เขียนหน่วย
   (คอลัมน์ซ่อนของจริงยังอยู่ใน sheet_to_json — จำลองด้วยคอลัมน์ว่าง) */
const PL = [
  ['No.', 'Particulars', 'FY2025', null, 'JANUARY', null, null, null, null, null, null, null, null, 'FEBRUARY', null, null, null, null, null, null, null, null, 'MARCH'],
  [null, null, 'Amount', '%', 'PLAN', null, 'Rolling', null, 'ACTUAL', null, 'DIFF A-P', null, null, 'PLAN', null, 'Rolling', null, 'ACTUAL', null, 'DIFF A-P', null, null, 'PLAN', null, 'Rolling', null, 'ACTUAL'],
  [null, null, null, null, 'Amount', '%', 'Amount', '%', 'Amount', '%', 'Amount', '%', '%-%', 'Amount', '%', 'Amount', '%', 'Amount', '%', 'Amount', '%', '%-%', 'Amount', '%', 'Amount', '%', 'Amount', '%'],
  [1, 'Sales from Product', 2038.94, '100.00%', 157.19, 1, 157.19, 1, 137.27, 1, -19.93, -0.1268, null, 158.25, 1, 158.25, 1, '-', null, -158.25, -1, null],
  [2, 'Raw Material', 1377.26, '67.55%', 106.26, 0.676, 106.26, 0.676, 87.89, 0.6403, -18.37, null, null, 108.04, 0.68, 108.04, 0.68, '-', null, -108.04, -1, null],
  [3, 'Direct Labour', 52.43, '2.57%', 3.86, 0.0245, 3.86, 0.0245, 3.88, 0.0283, 0.02, null, null, 3.86, 0.0244, 3.86, 0.0244, '-', null, -3.86, -1, null],
  [4, 'Overhead Expenses', 182.16, '8.93%', 14.41, 0.0917, 14.41, 0.0917, 14.41, 0.105, -0.45, null, null, 14.43, 0.0912, 14.43, 0.0912, '-', null, -14.43, -1, null],
  [5, 'COGS Sale from Product', 1611.85, '79.05%', 124.53, 0.7922, 124.53, 0.7922, 105.72, 0.7702, -18.81, null, null, 126.33, 0.7983, 126.33, 0.7983, '-', null, -126.33, -1, null],
  [7, 'Sales from Trading Goods', 246.69, '100.00%', 17.42, 1, 17.42, 1, 18.08, 1, 0.66, null, null, 17.49, 1, 17.49, 1, '-', null, -17.49, -1, null],
  [13, 'Total Sales', 2291.10, '100.00%', 174.61, 1, 174.61, 1, 165.71, 1, -8.90, null, null, 175.74, 1, 175.74, 1, '-', null, -175.74, -1, null],
  [14, 'Total COGS', 1860.60, '81.21%', 141.86, 0.8124, 141.86, 0.8124, 129.24, 0.7799, -12.62, null, null, 143.73, 0.8179, 143.73, 0.8179, '-', null, -143.73, -1, null],
];

test('ทรง B (PL Summary): หัวเดือนคร่อมบล็อก → เลือกคอลัมน์ ACTUAL→Amount ของแต่ละเดือน · เดือนที่ ACTUAL เป็น "-" ไม่ได้ค่า', () => {
  const r = detectMonthColumns(PL);
  assert.equal(r.row, 0);
  assert.deepEqual(r.cols, { 8: 1, 17: 2, 26: 3 }, 'ม.ค. = คอลัมน์ ACTUAL Amount (8) · ก.พ. = 17 ไม่ใช่คอลัมน์แรกของบล็อก (4/13) · มี.ค. (เดือนสุดท้าย) ใช้ความกว้างบล็อกเดียวกัน');
  assert.deepEqual(r.how, { 1: 'actual', 2: 'actual', 3: 'actual' }); assert.equal(r.subRow, 1);
  const v = detectVarRows(PL);
  assert.equal(v.sale_product, 3); assert.equal(v.raw_material, 4); assert.equal(v.dl, 5); assert.equal(v.oh, 6);
  assert.equal(v.sale_trading, 8); assert.equal(v.sale_total, 9);
  assert.equal(v.cogs, 10, '"Total COGS" ชนะ "COGS Sale from Product" แม้อยู่แถวล่างกว่า');
  const vals = extractValues(PL, { varRows: v, monthCols: r.cols, multiplier: 1_000_000 });
  assert.deepEqual(vals.sale_product, { 1: 137_270_000 }, 'ก.พ. ACTUAL "-" = ไม่มี (ไม่ใช่ 0 · ไม่หยิบ PLAN 158.25)');
  assert.deepEqual(vals.dl, { 1: 3_880_000 }); assert.deepEqual(vals.oh, { 1: 14_410_000 }); assert.deepEqual(vals.cogs, { 1: 129_240_000 });
  assert.ok(Math.abs(vals.raw_material[1] / vals.sale_product[1] - 0.6403) < 1e-3, '%RM ม.ค. = 64.03% ตรงคอลัมน์ % ของใบ');
  // เตือนหน่วย: เลือก ×1 แล้วยอดขายโรงงานแค่ 137.27 บาท ⇒ น่าจะล้านบาท (เตือน ไม่สลับให้)
  const raw = extractValues(PL, { varRows: v, monthCols: r.cols, multiplier: 1 });
  assert.match(magnitudeWarning(raw, 1), /ล้านบาท/);
  assert.equal(magnitudeWarning(vals, 1_000_000), '');
  assert.equal(magnitudeWarning({ manpower: { 1: 383 } }, 1), '', 'กำลังคนไม่ใช่ตัวเงิน ไม่เตือน');
});

/* ทรง B — ชีท "5.Manpower": เดือนละ Plan|Rolling (ไม่มี ACTUAL · ไม่มีแถว Amount) · Rolling ของเดือนอนาคต = แผน */
const MP = [
  ['Description', '2025', null, '2026', null, 'Jan', null, 'Feb', null, 'Mar', null, 'Apr', null],
  [null, 'Dec', 'Avg.', 'Commit', 'Target', 'Plan', 'Rolling', 'Plan', 'Rolling', 'Plan', 'Rolling', 'Plan', 'Rolling'],
  ['Direct', 180, 188, 184, 184, 190, 182, 182, 181, 181, 181, 181, 181],
  ['Total Head count (FAC)', 345, 356, 351, 351, 357, 349, 348, 348, 348, 348, 348, 348],
  ['Total Head count (All)', 376, 387, 386, 386, 392, 384, 384, 383, 383, 383, 383, 383],
  ['Total Sale (FG+TG+Tooling) (MB)', 2291.1, 2291.1, 2118.7, 2177.82, 165.04, 165.71, 181.02, 181.02, 227.12, 227.12, 197.15, 197.15],
];

test('ทรง B (Manpower): ไม่มี ACTUAL → ใช้ Rolling + รายงานว่าเดือนไหนใช้ Rolling · "Head count (All)" ชนะ (FAC) · limitMonths ตัดเดือนอนาคต', () => {
  const r = detectMonthColumns(MP);
  assert.deepEqual(r.cols, { 6: 1, 8: 2, 10: 3, 12: 4 }, 'คอลัมน์ Rolling ของแต่ละเดือน (เดือนสุดท้ายใช้ความกว้างบล็อกเดียวกัน)');
  assert.deepEqual(rollingMonths(r.how), [1, 2, 3, 4]);
  assert.equal(detectVarRows(MP).manpower, 4);
  const cols = limitMonths(r.cols, 1);
  assert.deepEqual(cols, { 6: 1 });
  assert.deepEqual(extractValues(MP, { varRows: detectVarRows(MP), monthCols: cols, multiplier: 1_000_000 }).manpower, { 1: 384 }, 'กำลังคนไม่คูณหน่วยเงิน');
  assert.deepEqual(limitMonths(r.cols, 0), {});
  // ทรง A เดิม: ไม่มีแถวย่อย ⇒ คอลัมน์เดิม how=null
  const a = detectMonthColumns(grid);
  assert.deepEqual(a.cols, { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 }); assert.equal(a.subRow, null); assert.deepEqual(rollingMonths(a.how), []);
  assert.deepEqual(resolveSubHeaders([[]], 0, {}), { cols: {}, how: {}, subRow: null });
  // เลือกแถวหัวเดือนเองก็ยังผ่านตัวแก้แถวย่อย
  assert.deepEqual(detectMonthColumns(PL, { row: 0 }).cols, { 8: 1, 17: 2, 26: 3 });
});

test('bestSheet: เลือกชีทที่จับตัวแปรได้มากสุด ไม่ใช่ชีทแรก', () => {
  assert.equal(bestSheet({ '1.Sale': [['Company: TSAT P4'], ['Period', '2025', '2026'], ['Jan', 1, 2]], '3.PL Summary': PL, '5.Manpower': MP }), '3.PL Summary');
  assert.equal(bestSheet({ x: [['nothing']] }), null);
});

/* ── โครงจริงจากไฟล์ .xlsb ที่ user ส่ง 19/10 (อ่านผ่าน pyxlsb · ตัวเลขถูก user แปลงแล้ว) ──
   PL Summary จริง: บล็อกต่อเดือน = Factory|Allocate|PLAN|Factory|Allocate|Rolling|Factory|Allocate|ACTUAL|DIFF (ละ 2 คอลัมน์ Amount/%)
   + ทางขวามีบล็อกช่วยคำนวณ Jan..Dec ซ้ำอีก 3 ชุด (คอลัมน์เดียวต่อเดือน) · เดือนที่ยังไม่ปิด ACTUAL = 0 (จอแสดง "-" เพราะ number format) · ค่าในเซลล์เป็น "บาท" (จอแสดงล้านเพราะ format) */
const blk = (plan, roll, act) => [plan * 0.4, 0.4, plan * 0.6, 0.6, plan, 1, roll * 0.4, 0.4, roll * 0.6, 0.6, roll, 1, act * 0.4, 0.4, act * 0.6, 0.6, act, 1, act - plan, -0.1, 0];
const SUBH = ['Factory', null, 'Allocate', null, 'PLAN', null, 'Factory', null, 'Allocate', null, 'Rolling', null, 'Factory', null, 'Allocate', null, 'ACTUAL', null, 'DIFF A-P', null, null];
const SUB2 = ['Amount', '%', 'Amount', '%', 'Amount', '%', 'Amount', '%', 'Amount', '%', 'Amount', '%', 'Amount', '%', 'Amount', '%', 'Amount', '%', 'Amount', '%', '%-%'];
const MON = ['JANUARY', 'FEBRUARY', 'MARCH'];
const plRow = (no, label, fy, jan, feb, mar, helper) => [null, no, label, fy, 1, ...blk(jan[0], jan[1], jan[2]), ...blk(feb[0], feb[1], feb[2]), ...blk(mar[0], mar[1], mar[2]), null, ...helper];
const PLR = [
  [null, 'No.', 'Particulars', 'FY2025', null, ...MON.flatMap(m => [m, ...Array(20).fill(null)]), null, 'Jan', 'Feb', 'Mar', null, 'Jan', 'Feb', 'Mar'],
  [null, null, null, 'A12', null, ...SUBH, ...SUBH, ...SUBH, null, 'YTD', 'YTD', 'YTD', null, 'A1R11', 'A1R11', 'A1R11'],
  [null, null, null, 'Amount', '%', ...SUB2, ...SUB2, ...SUB2, null, null, null, null, null, null, null, null],
  plRow(1, 'Sales from Product', 2038938446.51, [157193320, 157193320, 137267250.25], [158250871, 158250871, 0], [181130000, 181130000, 0], [137267250.25, 137267250.25, 137267250.25, null, 137267250.25, 137267250.25, 137267250.25]),
  plRow(2, 'Raw Material', 1377260000, [106260000, 106260000, 87887116.17], [108040000, 108040000, 0], [1, 1, 0], [87887116.17, 87887116.17, 87887116.17, null, 1, 1, 1]),
  plRow(3, 'Deduct Cost Reduction  Lump Sum', 0, [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0, null, 0, 0, 0]),
  plRow(4, 'Direct Labour', 52430000, [3860000, 3860000, 3881757.77], [3860000, 3860000, 0], [1, 1, 0], [3881757.77, 3881757.77, 3881757.77, null, 1, 1, 1]),
  plRow(5, 'Overhead Expenses', 182160000, [14410000, 14410000, 13954502.41], [14430000, 14430000, 0], [1, 1, 0], [13954502.41, 13954502.41, 13954502.41, null, 1, 1, 1]),
  plRow(6, 'COGS Sale from Product', 1611850000, [124530000, 124530000, 105720000], [126330000, 126330000, 0], [1, 1, 0], [1, 1, 1, null, 1, 1, 1]),
  plRow(7, 'Gross Profit from Product', 427080000, [32660000, 32660000, 31540000], [31920000, 31920000, 0], [1, 1, 0], [1, 1, 1, null, 1, 1, 1]),
  plRow(8, 'Sales from Trading Goods', 246690000, [17420000, 17420000, 18079576.11], [17490000, 17490000, 0], [1, 1, 0], [1, 1, 1, null, 1, 1, 1]),
  plRow(9, 'COGS Trading Goods', 245470000, [17330000, 17330000, 17990000], [17400000, 17400000, 0], [1, 1, 0], [1, 1, 1, null, 1, 1, 1]),
  plRow(13, 'Total Sales', 2291104273.38, [174608530.93, 174608530.93, 165711043.49], [175738399.07, 175738399.07, 0], [199935855.46, 199935855.46, 0], [165711043.49, 165711043.49, 165711043.49, null, 1, 1, 1]),
  plRow(14, 'Total COGS', 1860600000, [141860000, 141860000, 129240780.93], [143730000, 143730000, 0], [1, 1, 0], [1, 1, 1, null, 1, 1, 1]),
];

test('ไฟล์จริง PL Summary: บล็อก Factory|Allocate|PLAN|…|ACTUAL + บล็อกช่วยคำนวณซ้ำทางขวา → เลือก ACTUAL Amount ของตารางหลัก · "Total COGS"/"Sales from Trading Goods" ไม่โดนบรรทัดย่อยกิน · เดือนยังไม่ปิด = 0', () => {
  const mc = detectMonthColumns(PLR);
  assert.equal(mc.row, 0); assert.equal(mc.named, true);
  const vr = detectVarRows(PLR, { sheetName: '3.PL Summary' });
  const lab = (r) => rowLabels(PLR).find(x => x.row === r)?.label;
  assert.equal(lab(vr.sale_product), 'Sales from Product'); assert.equal(lab(vr.sale_trading), 'Sales from Trading Goods');
  assert.equal(lab(vr.cogs), 'Total COGS'); assert.equal(lab(vr.sale_total), 'Total Sales');
  assert.equal(lab(vr.raw_material), 'Raw Material'); assert.equal(lab(vr.dl), 'Direct Labour'); assert.equal(lab(vr.oh), 'Overhead Expenses');
  assert.equal(vr.cost_100p, undefined, '"Deduct Cost Reduction Lump Sum" = ตัวหัก ไม่ใช่ 100P');
  const v = extractValues(PLR, { varRows: vr, monthCols: mc.cols, multiplier: 1 });
  assert.deepEqual(v.sale_product, { 1: 137267250.25, 2: 0, 3: 0 }, 'ม.ค. = ACTUAL จริง (ไม่ใช่ PLAN 157.19M · ไม่ใช่บล็อกขวา) · เดือนยังไม่ปิด = 0 ในไฟล์');
  assert.deepEqual(v.sale_total, { 1: 165711043.49, 2: 0, 3: 0 }); assert.deepEqual(v.cogs, { 1: 129240780.93, 2: 0, 3: 0 });
  assert.ok(Math.abs(v.raw_material[1] / v.sale_product[1] - 0.6403) < 1e-3);
  assert.equal(lastClosedMonth(v), 1, 'เดือนสุดท้ายที่มียอด > 0 = ม.ค. ⇒ "ถึงเดือน" ต้องเป็น ม.ค. ไม่งั้นบันทึก 0');
  assert.equal(magnitudeWarning(v, 1), '', 'ค่าในเซลล์เป็นบาทจริง (137,267,250) ไม่ใช่ 137.27 — ไม่เตือน');
  assert.equal(sheetKind(PLR, '3.PL Summary'), 'general');
});

test('dedupeMonthCols: เลือกชุด Jan→Dec ที่ยาวสุด · เสมอเอาซ้ายสุด · "Dec" ปีก่อนที่นำหน้า Jan (6.BY Section) แพ้ชุดหลัก', () => {
  const bySec = { 2: 12, 5: 1, 8: 2, 11: 3, 14: 4, 17: 5, 20: 6, 23: 7, 26: 8, 29: 9, 32: 10, 35: 11, 38: 12 };
  const { 2: _dec25, ...rest } = bySec;
  assert.deepEqual(dedupeMonthCols(bySec), rest, 'Dec@2 (ปีก่อน) ไม่อยู่ในชุด Jan..Dec ⇒ ใช้ Dec@38');
  assert.deepEqual(dedupeMonthCols({ 2: 12, 5: 1, 8: 2 }), { 2: 12, 5: 1, 8: 2 }, 'เดือนที่ไม่มีในชุดหลักเอาตัวแรกที่เจอ');
  assert.deepEqual(dedupeMonthCols({ 29: 1, 50: 2, 71: 3, 302: 1, 303: 2, 304: 3 }), { 29: 1, 50: 2, 71: 3 }, 'เสมอ 3 เดือนเท่ากัน ⇒ ซ้ายสุด');
  assert.deepEqual(dedupeMonthCols({ 10: 1, 20: 6, 30: 7, 40: 8 }), { 10: 1, 20: 6, 30: 7, 40: 8 }, 'เดือนที่ไม่อยู่ในชุดหลักยังเก็บไว้');
  assert.deepEqual(dedupeMonthCols({}), {});
});

test('แถวดัชนี 1..58 ท้ายชีท (4.PL by GL) ไม่ใช่หัวเดือน · แถวช่วยคำนวณ Jan..Dec×3 (5.Manpower แถว 11) แพ้ตารางหลักที่มีแถวย่อย Actual', () => {
  const idx = [['x', 'y', ...Array.from({ length: 58 }, (_, i) => i + 1)]];
  assert.equal(detectMonthColumns(idx), null, 'ช่องถัดจาก 12 เป็น 13 = เลขลำดับ');
  const helper = ['No.', 'Particulars', 'Biz Plan', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'FY2024', null, 'No.', 'Particulars', 'Biz Plan', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const main = [null, 'Description', '2025', null, '2026', null, 'Jan', null, null, 'Feb', null, null, 'Mar', null, null, 'Apr', null, null, 'May', null, null, 'Jun', null, null, 'Jul', null, null, 'Aug', null, null, 'Sep', null, null, 'Oct', null, null, 'Nov', null, null, 'Dec'];
  const sub = [null, null, 'Dec', 'Avg.', 'Commit', 'Target', 'Plan', 'Rolling', 'Actual', 'Plan', 'Rolling', 'Actual', 'Plan', 'Rolling', 'Actual', 'Plan', 'Rolling', 'Actual', 'Plan', 'Rolling', 'Actual', 'Plan', 'Rolling', 'Actual', 'Plan', 'Rolling', 'Actual', 'Plan', 'Rolling', 'Actual', 'Plan', 'Rolling', 'Actual', 'Plan', 'Rolling', 'Actual', 'Plan', 'Rolling', 'Actual', 'Plan', 'Rolling', 'Actual'];
  const row = (label, jan) => [null, label, 376, 387, 386, 386, 393, 393, jan, 392, 392, 0, 392, 392, 0, 392, 392, 0, 384, 384, 0, 383, 383, 0, 383, 383, 0, 383, 383, 0, 383, 383, 0, 383, 383, 0, 383, 383, 0, 383, 383, 0];
  const MP2 = [helper, main, sub, row('Total Head count (FAC)', 348), row('Total Head count (All)', 382), row('Accumulate Total Sale', 165711043.49), row('Total Sale (FG+TG+Tooling) (MB.)', 165711043.49), row('Sale All / Head (All)', 433798.5)];
  const mc = detectMonthColumns(MP2);
  assert.equal(mc.row, 1, 'ตารางหลัก (แถว 2) ไม่ใช่แถวช่วยคำนวณ (แถว 1) แม้แถวนั้นมีเซลล์เดือนมากกว่า');
  assert.deepEqual(mc.how[1], 'actual'); assert.equal(mc.cols[8], 1);
  const MP3 = [...MP2, [null, 'Total Sale (FG+TG+Tooling)'], [null, 'Press,Assy', 'Jan', 174608530.93, 174608530.93, 165711043.49]];   // ตารางย่อยท้ายชีท (เดือนเป็นแถว)
  const vr = detectVarRows(MP3, { sheetName: '5.Manpower', monthCols: mc.cols });
  const lab = (r) => rowLabels(MP3).find(x => x.row === r)?.label;
  assert.equal(lab(vr.manpower), 'Total Head count (All)');
  assert.equal(lab(vr.sale_total), 'Total Sale (FG+TG+Tooling) (MB.)', 'ไม่ใช่ "Accumulate Total Sale" · ไม่ใช่ "Sale All / Head" · ไม่ใช่ป้ายตารางย่อยที่ช่องเดือนว่าง');
  const v = extractValues(MP2, { varRows: vr, monthCols: limitMonths(mc.cols, 1), multiplier: 1 });
  assert.deepEqual(v.manpower, { 1: 382 }); assert.deepEqual(v.sale_total, { 1: 165711043.49 });
});

test('ชีทสต็อก (8.Inventory Balance): จับแค่ "Inventory Balance All" · ไม่จับ COGS/RM/Sale ของชีทนี้ (คนละฐานกับ PL) · แถวหัวเรื่องไม่มีตัวเลขไม่นับ', () => {
  const INV = [
    ['Company: TSAT P.4'], ['Inventory Balance (Day) -  2026'],
    ['Store', 'Location', 'Type', 'Responsible', 'FY2025', null, null, null, 'FY2025'],
    [null, null, null, null, ' Commit ', ' Days ', ' Target ', ' Days ', 'PP', 'RM', 'Jan', '/sale', 'Days', 'PP', 'RM', 'Feb', '/sale', 'Days', 'PP', 'RM', 'Mar', '/sale', 'Days'],
    ['P404', 'Assy 3 FTM/AAT', 'SM', 'คุณ ก', 153849.9, 0.04, 140666.35, 0.03, 0, 0, 227355.31, 0, 0.05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['1010', 'Total Raw Material', null, null, 1, 4.73, 1, 3.54, 1, 1, 20815960.51, 0.1, 4.69, 1, 1, 23536645.16, 0, 0, 1, 1, 24672873.28, 0, 0],
    [null, 'รวมสโตร์ - Steel', null, 'Day / Month', 78989442.63, 14, 73347339.58, 13, 1, 1, 86476224.2, 0.5, 15.75, 1, 1, 94485834.31, 0, 0, 1, 1, 88502524.78, 0, 0],
    [null, 'Inventory Balance All', null, null, 78989442.63, 14, 73347339.58, 13, 1, 1, 86476224.2, 0.5, 15.75, 1, 1, 94485834.31, 0, 0, 1, 1, 88502524.78, 0, 0],
    [null, 'Inventory Turn Ove (Day)', null, 'Day accumulate', 78989442.63, 14, 73347339.58, 13, 0, 0, 2.03, 0, 16, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [null, 'Sale FG', null, null, 1943328211.65, null, 2001628058, null, null, null, 173293062.23, null, null, null, null, 163968908.54],
    [null, 'COGS', null, null, 2059367611.34, null, 2059367611.34, null, null, null, 170209462.08, null, null, null, null, 165920970.92],
  ];
  assert.equal(sheetKind(INV, '8. Inventory Balance.'), 'inventory'); assert.equal(sheetKind(INV, 'Sheet1'), 'inventory', 'ดูจากหัวเรื่องในชีทก็ได้');
  const mc = detectMonthColumns(INV);
  assert.deepEqual(mc.cols, { 10: 1, 15: 2, 20: 3 }, 'คอลัมน์ "Jan" = ยอดรวมเดือน (ไม่ใช่ PP/RM/Days ข้างๆ)');
  const vr = detectVarRows(INV, { sheetName: '8. Inventory Balance.' });
  assert.deepEqual(Object.keys(vr), ['inventory_baht']);
  assert.equal(rowLabels(INV).find(x => x.row === vr.inventory_baht)?.label, 'Inventory Balance All', 'ไม่ใช่หัวเรื่อง "Inventory Balance (Day)" (ไม่มีตัวเลข) · ไม่ใช่ Turn Over (วัน)');
  assert.deepEqual(extractValues(INV, { varRows: vr, monthCols: mc.cols, multiplier: 1 }).inventory_baht, { 1: 86476224.2, 2: 94485834.31, 3: 88502524.78 });
  // ชีทเดียวกันถ้าไม่บอกชื่อและไม่มีหัวเรื่อง ⇒ general: COGS/RM จับได้ (ให้คนตัดสิน)
  assert.ok(detectVarRows(INV.slice(2), { sheetName: 'x' }).cogs != null);
});

test('monthFromFileName: ชื่อไฟล์รายงานบัญชี "… Jan-2026 …" → 1 · ไม่มีเดือน = null · bestSheet เลือก PL Summary ไม่ใช่ GL/ดัชนี', () => {
  assert.equal(monthFromFileName('4) 01 Report Monthly FS Jan-2026  TSAT P4(for claude).xlsb'), 1);
  assert.equal(monthFromFileName('Report FS Sep_2026.xlsx'), 9); assert.equal(monthFromFileName('FS December 2026.xlsx'), 12);
  assert.equal(monthFromFileName('report.xlsx'), null); assert.equal(monthFromFileName(''), null);
  const GL = [PLR[0], PLR[1], PLR[2], plRow(1, 'Domestic Sales - Trading Goods- Golf Car', 0, [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0, null, 0, 0, 0]), plRow(2, 'Sales from Product', 1, [1, 1, 137267250.25], [1, 1, 0], [1, 1, 0], [1, 1, 1, null, 1, 1, 1]),
    plRow(3, 'Inventory Damage Expense', 1, [1, 1, 5000], [1, 1, 0], [1, 1, 0], [1, 1, 1, null, 1, 1, 1]), plRow(4, 'Cost of Sales - Raw Material-Golf Car', 0, [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0, null, 0, 0, 0])];
  const vg = detectVarRows(GL, { sheetName: '4. PL by GL V5' });
  assert.equal(vg.inventory_baht, undefined, '"Inventory Damage Expense" ไม่ใช่มูลค่าสต็อก');
  assert.equal(bestSheet({ '1.Sale.': [['Sale From Product'], ['Period', '2025', '2026'], ['Jan', 1, 2]], '3.PL Summary': PLR, '4. PL by GL V5': GL, '5.Manpower': MP }), '3.PL Summary');
});
