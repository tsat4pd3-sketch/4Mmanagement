import test from 'node:test';
import assert from 'node:assert/strict';
import { pillarHeight, SEVERITY_H } from '../mapPillar.js';

test('OEE: สูงตาม %OEE · clamp 0-100', () => {
  assert.equal(pillarHeight('oee', 'good', 80).h, 0.8);
  assert.equal(pillarHeight('oee', 'good', 140).h, 1);
});
test('OEE ไม่มีค่า = เตี้ยสุด ห้ามเดาค่ากลาง', () => {
  assert.equal(pillarHeight('oee', 'idle', null).h, 0.04);
});
test('metric อื่น: ปัญหาหนักกว่าต้องสูงกว่า', () => {
  const h = (c) => pillarHeight('health', c, null).h;
  assert.ok(h('down') > h('bad') && h('bad') > h('ok') && h('ok') > h('good') && h('good') > h('idle'));
  assert.equal(pillarHeight('health', 'ไม่รู้จัก', null).h, SEVERITY_H.idle);
});
