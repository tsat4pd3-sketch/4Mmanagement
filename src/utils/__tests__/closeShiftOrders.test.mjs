/* ปิดกะ — ใบไหนยกเอง ใบไหนต้องให้คนตัดสิน (src/utils/closeShiftOrders.js)
   ที่มา: คำสั่ง user 20/10 "ยกยอดแค่ใบที่ทำไม่จบครึ่งๆกลางๆ ที่เหลือออโต้ยกไปเลย" */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeQtyOf, splitCloseOrders, autoCarryPatch, autoCarryText } from '../closeShiftOrders.js';

const O = (id, qty, qty_actual = 0) => ({ id, qty, qty_actual, mat_no: `MAT${id}` });

test('ยังไม่แตะเลย = ยกอัตโนมัติ · แตะแล้ว = ต้องให้คนตัดสิน', () => {
  const orders = [O('a', 100), O('b', 100, 40), O('c', 100), O('d', 100, 100)];
  const { autoCarry, needDecision } = splitCloseOrders(orders, {});
  assert.deepEqual(autoCarry.map(o => o.id), ['a', 'c']);
  assert.deepEqual(needDecision.map(o => o.id), ['b', 'd']);   // ครบเป้าก็ต้องกด "ผลิตครบแล้ว" เอง
});

test('🔴 ยอดที่คนเพิ่งพิมพ์ในหน้าปิดกะ ชนะ qty_actual — ไม่งั้นยอดที่กรอกหายไปกับการยกอัตโนมัติ', () => {
  const orders = [O('a', 100)];                       // qty_actual = 0
  const { autoCarry, needDecision } = splitCloseOrders(orders, { a: '25' });
  assert.equal(autoCarry.length, 0);
  assert.deepEqual(needDecision.map(o => o.id), ['a']);
});

test('พิมพ์ 0 ทับ = ยังไม่แตะ (ยกอัตโนมัติ) · ช่องว่าง = ถอยไป qty_actual ไม่ใช่ 0', () => {
  assert.equal(closeQtyOf(O('a', 100, 7), { a: '0' }), 0);     // ตั้งใจพิมพ์ 0
  assert.equal(closeQtyOf(O('a', 100, 7), { a: '' }), 7);      // ช่องว่าง → ค่าที่บันทึกไว้
  assert.equal(closeQtyOf(O('a', 100, 7), {}), 7);             // ไม่มีคีย์เลย → ค่าที่บันทึกไว้
  assert.equal(closeQtyOf(O('a', 100, 7), { a: 'abc' }), 7);   // ค่าพัง → ค่าที่บันทึกไว้ ห้ามกลายเป็น 0
});

test('ข้อมูลพัง/ว่าง ต้องไม่ระเบิด', () => {
  assert.deepEqual(splitCloseOrders(null, null), { autoCarry: [], needDecision: [] });
  assert.deepEqual(splitCloseOrders([null, undefined], {}), { autoCarry: [], needDecision: [] });
  assert.equal(closeQtyOf(null, {}), 0);
});

test('payload ยกอัตโนมัติ — qty_actual = 0 · ไม่มี carry_over_from_session_id (กันใบชี้หาตัวเอง)', () => {
  const p = autoCarryPatch(O('a', 250), { shiftLabel: 'กะเช้า', dateLabel: '20/10/2569' });
  assert.equal(p.status, 'carry_over');
  assert.equal(p.qty_actual, 0);
  assert.ok(!('carry_over_from_session_id' in p));
  assert.match(p.carry_over_note, /ยังไม่ได้ผลิต 0\/250/);
  assert.match(p.carry_over_note, /กะเช้า 20\/10\/2569/);
});

test('ข้อความบนจอ — 0 ใบ = ไม่เขียนอะไร · มีใบ = ต้องบอกจำนวนใบและชิ้น (ห้ามยกเงียบ)', () => {
  assert.equal(autoCarryText(0, 0), null);
  const t = autoCarryText(3, 1200);
  assert.match(t, /3 ใบ/);
  assert.match(t, /1,200 ชิ้น/);
});
