import test from 'node:test';
import assert from 'node:assert/strict';
import { pairQtyPlan, pairOrderGaps } from '../pairOrder.js';

const O = (id, mat, extra = {}) => ({ id, mat_no: mat, status: 'open', qty_ok: 0, ...extra });
const PAIR = { '10076601': '10076602', '10076602': '10076601' };
const pairOf = (m) => PAIR[(m || '').trim().toUpperCase()] || null;

test('เสนอลงยอดอีกข้างเมื่อยอดต่างกัน', () => {
  const p = pairQtyPlan(O(1, 'A'), O(2, 'B', { qty_ok: 0 }), 120);
  assert.equal(p.to, 120); assert.equal(p.from, 0); assert.equal(p.locked, false);
});

test('🔴 ยอดตรงกันอยู่แล้ว = ไม่ต้องถาม (ห้ามรบกวนทุกครั้งที่กด)', () => {
  assert.equal(pairQtyPlan(O(1, 'A'), O(2, 'B', { qty_ok: 120 }), 120), null);
});

test('ไม่มีคู่ / คู่ถูกยกเลิก = ไม่เสนอ', () => {
  assert.equal(pairQtyPlan(O(1, 'A'), null, 50), null);
  assert.equal(pairQtyPlan(O(1, 'A'), O(2, 'B', { status: 'cancelled' }), 50), null);
});

test('คู่ปิดไปแล้ว = เสนอได้ แต่ต้องติดธง locked (จะไปทับใบที่ปิดแล้ว)', () => {
  const p = pairQtyPlan(O(1, 'A'), O(2, 'B', { status: 'confirmed', qty_ok: 100 }), 120);
  assert.equal(p.locked, true); assert.equal(p.from, 100);
});

test('ยอดไม่ใช่ตัวเลข = ไม่เสนอ (ห้ามเขียน NaN ไปอีกข้าง)', () => {
  assert.equal(pairQtyPlan(O(1, 'A'), O(2, 'B'), NaN), null);
  assert.equal(pairQtyPlan(O(1, 'A'), O(2, 'B'), ''), null);
});

test('🔴 แยก "ไม่มีคู่เลย" ออกจาก "มีแต่ยังไม่ผูก" — คนละงานกัน', () => {
  const g1 = pairOrderGaps([O(1, '10076601')], pairOf);
  assert.equal(g1.missing.length, 1);
  assert.equal(g1.missing[0].pair_mat_no, '10076602');
  assert.equal(g1.unlinked.length, 0);

  const g2 = pairOrderGaps([O(1, '10076601'), O(2, '10076602')], pairOf);
  assert.equal(g2.missing.length, 0);
  assert.equal(g2.unlinked.length, 2);                    // ทั้ง 2 ใบชี้หากันได้
  assert.equal(g2.unlinked[0].candidate.id, 2);
});

test('ผูกกันแล้ว = เงียบ', () => {
  const g = pairOrderGaps([O(1, '10076601', { paired_order_id: 2 }), O(2, '10076602', { paired_order_id: 1 })], pairOf);
  assert.deepEqual([g.missing.length, g.unlinked.length], [0, 0]);
});

test('ใบที่ยกเลิกแล้วไม่นับเป็นคู่ และไม่ถูกฟ้อง', () => {
  const g = pairOrderGaps([O(1, '10076601'), O(2, '10076602', { status: 'cancelled' })], pairOf);
  assert.equal(g.missing.length, 1);                      // คู่ถูกยกเลิก = เหมือนไม่มี
  assert.equal(g.unlinked.length, 0);
});

test('สินค้าไม่ใช่งานคู่ = ไม่ยุ่ง', () => {
  const g = pairOrderGaps([O(1, '99999999')], pairOf);
  assert.deepEqual([g.missing.length, g.unlinked.length], [0, 0]);
});
