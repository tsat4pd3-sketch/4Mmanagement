import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflowDestOf, refStockOf, splitLevels } from '../partRefStock.js';

const RULES = [
  { match_type: 'prefix', match_value: '1', dest_line_name: 'FG WAREHOUSE', is_active: true },
  { match_type: 'prefix', match_value: '2', dest_line_name: 'STORE', is_active: true },
  { match_type: 'mat', match_value: '20099999', dest_line_name: 'SUB APRON', is_active: true },
];
const PRODUCTS = [
  { mat_no: '10076603', line_name: 'LINE A ( 800 Ton )', is_active: true },
  { mat_no: '20059076', line_name: 'LINE A ( 800 Ton )', is_active: true },
  { mat_no: '20063136', line_name: 'LINE D ( 110&300 Ton )', is_active: true },
  { mat_no: '20099999', line_name: 'LINE A ( 800 Ton )', is_active: true },
  { mat_no: '20077777', line_name: 'LINE A ( 800 Ton )', is_active: true, is_operation: true },
];
const ctx = { lineName: 'LINE A ( 800 Ton )', products: PRODUCTS, rules: RULES };

test('กฎ MAT ชนะ prefix · ไม่มีกฎ = null', () => {
  assert.equal(inflowDestOf('10076603', RULES), 'FG WAREHOUSE');
  assert.equal(inflowDestOf('20099999', RULES), 'SUB APRON');
  assert.equal(inflowDestOf('50031625', RULES), null);
});

test('ไลน์ผลิตเอง → อ้างคลัง · ของที่ไลน์อื่นผลิต/ชั้น OP → อ้างหน้าไลน์เหมือนเดิม', () => {
  assert.deepEqual(refStockOf('10076603', ctx), { kind: 'produce', loc: 'FG WAREHOUSE' });
  assert.deepEqual(refStockOf('20059076', ctx), { kind: 'produce', loc: 'STORE' });
  assert.deepEqual(refStockOf('20063136', ctx), { kind: 'consume', loc: 'LINE A ( 800 Ton )' });
  assert.deepEqual(refStockOf('20077777', ctx), { kind: 'consume', loc: 'LINE A ( 800 Ton )' });
  assert.deepEqual(refStockOf('99999999', ctx), { kind: 'consume', loc: 'LINE A ( 800 Ton )' });
});

test('เคสจริง LINE A 08/10: FG 1,000 < min 1,700 → ต้องผลิต 700 ถึง max · ไม่มียอดคลัง = ยังเช็คไม่ได้', () => {
  const stock = { 'FG WAREHOUSE|10076603': 1000, 'STORE|20059076': 4000 };
  const r = splitLevels([
    { mat_no: '10076603', min_qty: 1700, max_qty: 1700 },
    { mat_no: '20059076', min_qty: 1500 },
    { mat_no: '20099999', min_qty: 400 },
    { mat_no: '20063136', min_qty: 100 },
  ], ctx, (loc, mat) => stock[`${loc}|${mat}`] ?? null);
  assert.deepEqual(r.produceDue.map(x => [x.mat_no, x.loc, x.have, x.suggestQty]), [['10076603', 'FG WAREHOUSE', 1000, 700]]);
  assert.equal(r.produceOk, 1);
  assert.deepEqual(r.produceUnknown.map(x => [x.mat_no, x.loc]), [['20099999', 'SUB APRON']]);
  assert.deepEqual(r.consumeLevels.map(x => x.mat_no), ['20063136']);
});

test('พาร์ทที่สโตร์คุมเป็นล็อต → อ้างยอดที่ไลน์ผลิตเอง (ปิดล็อตลงที่นั่น) แต่ยังเป็น "ผลิตเติม"', () => {
  const c = { ...ctx, lotMats: new Set(['20059076']) };
  assert.deepEqual(refStockOf('20059076', c), { kind: 'produce', loc: 'LINE A ( 800 Ton )' });
  assert.deepEqual(refStockOf('20063136', { ...c, lotMats: ['20063136'] }), { kind: 'consume', loc: 'LINE A ( 800 Ton )' });  // ไลน์อื่นผลิต = ไม่เกี่ยว
});
