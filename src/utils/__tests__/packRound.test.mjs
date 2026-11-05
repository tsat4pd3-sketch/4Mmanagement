import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packSplit, packWithCarry, carryKey, packSizeOf, packSplitText } from '../packRound.js';

test('ตัวอย่าง user: ต้องการ 120 · กล่อง 100 → ส่ง 100 ทด 20', () => {
  const r = packSplit(120, 100);
  assert.deepEqual([r.state, r.send, r.carry, r.packs], ['send', 100, 20, 1]);
});

test('ห้ามส่งเกินกล่อง และห้ามส่งเศษ — 3 รอบต่อกัน ทดสะสมถูก', () => {
  let carry = 0;
  const out = [120, 90, 50].map(d => { const r = packWithCarry(carry, d, 100); carry = r.carry; return [r.total, r.state, r.send, r.carry]; });
  assert.deepEqual(out, [[120, 'send', 100, 20], [110, 'send', 100, 10], [60, 'wait', 0, 60]]);
});

test('ไม่ถึง 1 กล่อง = wait ไม่ส่ง (user เคาะ: รอรอบถัดไป)', () => {
  const r = packSplit(318, 800);
  assert.equal(r.state, 'wait'); assert.equal(r.send, 0); assert.equal(r.carry, 318);
});

test('ลงตัวพอดี = ไม่มีทด', () => {
  const r = packSplit(7200, 1200);
  assert.deepEqual([r.state, r.send, r.carry, r.packs], ['send', 7200, 0, 6]);
});

test('ไม่รู้ขนาดกล่อง = no_pkg · send/carry null (ห้ามเดา ห้ามส่งเต็มยอด)', () => {
  for (const p of [null, undefined, 0, -5, '', 'abc']) {
    const r = packSplit(500, p);
    assert.equal(r.state, 'no_pkg'); assert.equal(r.send, null); assert.equal(r.carry, null);
  }
  assert.equal(packSizeOf('100'), 100);
});

test('ไม่มีความต้องการ = none', () => {
  assert.equal(packSplit(0, 100).state, 'none');
  assert.equal(packSplit(-3, 100).state, 'none');
  assert.equal(packSplit(null, null).state, 'none');
});

test('ทศนิยมไม่หลุด (0.3 / 0.1 = 3 กล่อง ไม่ใช่ 2)', () => {
  const r = packSplit(0.3, 0.1);
  assert.equal(r.packs, 3); assert.equal(r.carry, 0);
});

test('คีย์ทดแยกไลน์ — พาร์ทเดียวกันคนละไลน์ไม่ปน', () => {
  assert.notEqual(carryKey('Assy GOR', '30042571'), carryKey('Line 61', '30042571'));
  assert.equal(carryKey(' LINE B ', '10104918 '), carryKey('LINE B', '10104918'));
});

test('ป้ายบนจอ', () => {
  assert.match(packSplitText(packSplit(120, 100)), /ส่ง 100 \(1 กล่อง × 100\) · ทด 20/);
  assert.match(packSplitText(packSplit(60, 100)), /ยังไม่ถึง 1 กล่อง/);
  assert.match(packSplitText(packSplit(60, null)), /ยังไม่ได้ตั้งขนาดกล่อง/);
});

import { planLineRequest } from '../packRound.js';
test('planLineRequest: ใบผลิตเปิด → เทียบ WIP หน้าไลน์ → ครบกล่องค่อยเบิก', () => {
  // ต้องใช้ 1,036 · หน้าไลน์มี 0 · กล่อง 300 → เบิก 900 (ทด 136 รอใบถัดไป)
  assert.deepEqual((({ action, qty, carry }) => ({ action, qty, carry }))(planLineRequest({ need: 1036, onHand: 0, pkg: 300 })), { action: 'insert', qty: 900, carry: 136 });
  // หน้าไลน์ติดลบ = นับเป็น 0 ไม่ใช่ของติดลบมาเพิ่มความต้องการ
  assert.equal(planLineRequest({ need: 500, onHand: -9000, pkg: 100 }).qty, 500);
  // หน้าไลน์พอ = ไม่ต้องเบิก
  assert.equal(planLineRequest({ need: 500, onHand: 600, pkg: 100 }).action, 'covered');
  // ไม่ถึง 1 กล่อง = รอ (สะสมจากใบผลิตถัดไป)
  assert.equal(planLineRequest({ need: 300, onHand: 0, pkg: 800 }).action, 'wait');
  // มีใบรอหยิบอยู่แล้ว น้อยกว่าเป้า = เพิ่มยอด · มากกว่า/เท่า = ไม่ลดเอง
  assert.deepEqual((({ action, qty }) => ({ action, qty }))(planLineRequest({ need: 2000, onHand: 0, pendingQty: 900, pkg: 300 })), { action: 'raise', qty: 1800 });
  assert.equal(planLineRequest({ need: 300, onHand: 0, pendingQty: 900, pkg: 300 }).action, 'covered');
  // ไม่รู้ขนาดกล่อง = ไม่เดา
  assert.equal(planLineRequest({ need: 500, onHand: 0, pkg: null }).action, 'no_pkg');
});
