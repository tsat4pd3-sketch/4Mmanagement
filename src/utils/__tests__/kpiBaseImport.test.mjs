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
