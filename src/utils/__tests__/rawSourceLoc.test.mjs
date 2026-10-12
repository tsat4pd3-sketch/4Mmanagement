import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawSourceLocOf } from '../partRefStock.js';

const products = [
  { mat_no: '20058693', line_name: 'LINE D ( 110&300 Ton )', is_active: true },   // ชิ้นปั๊ม LINE D (ล็อตสโตร์)
  { mat_no: '20066332', line_name: 'LINE C ( 200&250 Ton )', is_active: true },   // ชิ้นปั๊ม ไม่ใช่ล็อต
  { mat_no: '20077777', line_name: 'LINE C ( 200&250 Ton )', is_active: true, is_operation: true },
];
const rules = [{ match_type: 'prefix', match_value: '2', dest_line_name: 'STORE' }, { match_type: 'prefix', match_value: '1', dest_line_name: 'FG WAREHOUSE' }];
const ctx = { consumingLine: 'LINE C ( 200&250 Ton )', products, rules, lotMats: new Set(['20058693']) };

test('rawSourceLocOf — ล็อตสโตร์: ตัดที่ไลน์ที่ผลิต ไม่ใช่ไลน์ที่ใช้ (เคส LINE C −21,600)', () => {
  assert.equal(rawSourceLocOf('20058693', ctx), 'LINE D ( 110&300 Ton )');
});
test('rawSourceLocOf — ชิ้นที่ผลิตเองไม่ใช่ล็อต: คลังตามกฎรับเข้า', () => {
  assert.equal(rawSourceLocOf('20066332', ctx), 'STORE');
});
test('rawSourceLocOf — ของซื้อ 3xx/5xx: คลังรับของซื้อ', () => {
  assert.equal(rawSourceLocOf('50027090', ctx), 'STORE');
  assert.equal(rawSourceLocOf('30052549', { ...ctx, receiptLine: 'S401' }), 'S401');
});
test('rawSourceLocOf — ชั้น OP / ไม่รู้อะไรเลย: ไลน์ที่ใช้ (พฤติกรรมเดิม ไม่เดาคลังใหม่)', () => {
  assert.equal(rawSourceLocOf('20077777', { ...ctx, rules: [] }), 'LINE C ( 200&250 Ton )');
  assert.equal(rawSourceLocOf('X999', { consumingLine: 'L1' }), 'L1');
});

import { splitRawConsume } from '../partRefStock.js';
test('splitRawConsume — ใช้ของที่จ่ายเข้าไลน์ก่อน ส่วนเกินตัดคลังต้นทาง · ผลรวมเท่าเดิม', () => {
  assert.deepEqual(splitRawConsume(2520, { consumingLine: 'GOR', sourceLoc: 'STORE', lineHave: 2380 }),
    [{ loc: 'GOR', qty: 2380 }, { loc: 'STORE', qty: 140 }]);
  assert.deepEqual(splitRawConsume(3600, { consumingLine: 'LINE C', sourceLoc: 'LINE D', lineHave: -500 }),
    [{ loc: 'LINE D', qty: 3600 }], 'ไลน์ติดลบ/ไม่มีของ = ตัดคลังต้นทางทั้งก้อน');
  assert.deepEqual(splitRawConsume(10, { consumingLine: 'L', sourceLoc: 'L', lineHave: 0 }), [{ loc: 'L', qty: 10 }]);
  assert.deepEqual(splitRawConsume(0, { consumingLine: 'L', sourceLoc: 'S' }), []);
});
