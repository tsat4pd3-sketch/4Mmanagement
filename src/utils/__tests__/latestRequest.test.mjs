import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatestGate } from '../useLatestRequest.js';

test('คำขอใหม่ทำให้คำขอเก่าหมดสิทธิ์ set state', () => {
  const g = createLatestGate();
  const a = g.begin();
  assert.equal(a(), true);
  const b = g.begin();
  assert.equal(a(), false);   // คำตอบของ a มาทีหลัง ⇒ ทิ้ง
  assert.equal(b(), true);
});

test('invalidate (unmount) = ทุกคำขอที่ค้างหมดสิทธิ์', () => {
  const g = createLatestGate();
  const a = g.begin();
  g.invalidate();
  assert.equal(a(), false);
});

test('gate แยกกันต่อ instance', () => {
  const g1 = createLatestGate(), g2 = createLatestGate();
  const a = g1.begin(); g2.begin();
  assert.equal(a(), true);
});
