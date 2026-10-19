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
import { resolveSubHeaders, limitMonths, rollingMonths, bestSheet, magnitudeWarning } from '../kpiBaseImport.js';

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
