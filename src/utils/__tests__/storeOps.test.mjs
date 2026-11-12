import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeOfMat, OPS_STORES_OUT, WIP_STORES } from '../storeOps.js';

test('storeOfMat: 1xx FG · 2xx semi · 3xx สโตร์ภายนอก · 5xx raw · อื่นๆ = other (ห้ามหาย)', () => {
  assert.equal(storeOfMat('10052995'), 'fg');
  assert.equal(storeOfMat(' 20063136'), 'child');
  assert.equal(storeOfMat('30052550'), 'ext');
  assert.equal(storeOfMat('50027083'), 'raw');
  assert.equal(storeOfMat('40001234'), 'other');
  assert.equal(storeOfMat(''), 'other');
  assert.equal(storeOfMat(null), 'other');
});
test('ตู้งานสโตร์ไม่มีแท็บ wip แล้ว และครอบทุกตู้ที่ใบเบิกไปลงได้', () => {
  assert.ok(!OPS_STORES_OUT.includes('wip'));
  for (const s of WIP_STORES) assert.ok(OPS_STORES_OUT.includes(s), s);
});

import { OPS_STORES_IN } from '../storeOps.js';
test('ขาออก/ขาเข้า ไม่ซ้อนกัน — ใบล็อต/รอรับเข้า/รับกลับชุบ อยู่ขาเข้าเท่านั้น', () => {
  for (const k of ['lots', 'receipts', 'plating_in', 'purchase']) { assert.ok(OPS_STORES_IN.includes(k), k); assert.ok(!OPS_STORES_OUT.includes(k), k); }
});
