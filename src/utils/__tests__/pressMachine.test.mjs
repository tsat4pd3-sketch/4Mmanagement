import test from 'node:test';
import assert from 'node:assert/strict';
import { isPressType, showsShutHeight } from '../pressMachine.js';

test('ช่อง shut height — เฉพาะเครื่องปั๊ม · มีค่าอยู่แล้วโชว์เสมอ (ห้ามซ่อนข้อมูลที่มี)', () => {
  assert.equal(isPressType('Metal Forming'), true);
  assert.equal(isPressType('Press 800T'), true);
  assert.equal(isPressType('เครื่องปั๊ม'), true);
  assert.equal(isPressType('Robot-Handling+Stan Gun'), false);
  assert.equal(isPressType('Projection Welding'), false);
  assert.equal(isPressType(null), false);
  assert.equal(showsShutHeight({ typeLabel: 'Robot - Handling' }), false);
  assert.equal(showsShutHeight({ typeLabel: 'Robot - Handling', min: '200' }), true);
  assert.equal(showsShutHeight({ typeLabel: 'Robot - Handling', min: '', max: 0 }), true);
  assert.equal(showsShutHeight({ typeLabel: 'Metal Forming' }), true);
});
