/* นิยาม "งานค้าง" ของใบส่งของ — เพิ่มสถานะ cancelled แล้วต้องไม่มีจอไหนนับผิด (2026-09-25) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { openOnly, isOpenOrder, isClosedOrder, isCancelled, isShipped, CLOSED_STATUSES, SHIPPED, CANCELLED }
  from '../shipStatus.js';

test('ปิดแล้ว = shipped หรือ cancelled เท่านั้น', () => {
  assert.deepEqual([...CLOSED_STATUSES].sort(), ['cancelled', 'shipped']);
});

test('สถานะระหว่างทางทุกตัวยังนับเป็นงานค้าง', () => {
  for (const st of ['pending', 'confirmed', 'prepared', 'loaded']) {
    assert.equal(isOpenOrder({ status: st }), true, st);
    assert.equal(isClosedOrder({ status: st }), false, st);
  }
});

test('shipped และ cancelled ไม่ใช่งานค้าง', () => {
  assert.equal(isOpenOrder({ status: SHIPPED }), false);
  assert.equal(isOpenOrder({ status: CANCELLED }), false);
  assert.equal(isClosedOrder({ status: CANCELLED }), true);
});

test('แยก "ส่งแล้ว" ออกจาก "ยกเลิก" ได้ — คนละความหมาย ห้ามนับรวมกันในตัวเลขส่งสำเร็จ', () => {
  assert.equal(isShipped({ status: SHIPPED }), true);
  assert.equal(isShipped({ status: CANCELLED }), false);
  assert.equal(isCancelled({ status: CANCELLED }), true);
  assert.equal(isCancelled({ status: SHIPPED }), false);
});

test('แถวว่าง/undefined ต้องไม่ throw และถือว่ายังเปิดอยู่ (ไม่เดาว่าปิด)', () => {
  assert.equal(isOpenOrder(undefined), true);
  assert.equal(isOpenOrder({}), true);
  assert.equal(isCancelled(null), false);
});

test('openOnly ต่อท้ายคิวรีด้วย not-in ที่ครอบทุกสถานะปิด', () => {
  const calls = [];
  const fake = { not: (col, op, val) => { calls.push([col, op, val]); return 'CHAINED'; } };
  assert.equal(openOnly(fake), 'CHAINED', 'ต้องคืน query กลับไปให้ต่อ .gte/.lte ได้');
  assert.deepEqual(calls, [['status', 'in', '("shipped","cancelled")']]);
});

test('เพิ่มสถานะปิดใหม่ในอนาคต ต้องไหลเข้า openOnly เอง (ไม่ต้องไล่แก้ทุกจอ)', () => {
  // คีย์ของดีไซน์นี้: สตริงใน openOnly สร้างจาก CLOSED_STATUSES ไม่ได้ hardcode ซ้ำ
  const calls = [];
  openOnly({ not: (c, o, v) => { calls.push(v); return null; } });
  for (const st of CLOSED_STATUSES) assert.ok(calls[0].includes(`"${st}"`), st);
});
