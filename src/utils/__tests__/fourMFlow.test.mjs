import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fourMFlow } from '../fourMFlow.js';

const states = (f) => f.steps.map(s => s.state + (s.tone ? '/' + s.tone : ''));

test('4M flow — pending → SV current · pending_qa → QA current · approved = ครบ', () => {
  assert.deepEqual(states(fourMFlow({ status: 'pending' })), ['done', 'current', 'todo', 'todo']);
  assert.match(fourMFlow({ status: 'pending' }).waiting, /SV/);
  assert.deepEqual(states(fourMFlow({ status: 'pending_qa' })), ['done', 'done', 'current', 'todo']);
  assert.deepEqual(states(fourMFlow({ status: 'approved' })), ['done', 'done', 'done', 'done']);
  assert.equal(fourMFlow({ status: 'approved' }).waiting, null);
  assert.deepEqual(states(fourMFlow({ status: 'pending_doc' })), ['current', 'todo', 'todo', 'todo']);
  assert.match(fourMFlow({ status: 'pending_doc' }).waiting, /OJT/);
});

test('🔴 requires_qa=false เท่านั้นที่ไม่มีขั้น QA (null = ต้องผ่าน QA)', () => {
  assert.equal(fourMFlow({ status: 'pending', requires_qa: false }).steps.length, 3);
  assert.equal(fourMFlow({ status: 'pending', requires_qa: null }).steps.length, 4);
  assert.equal(fourMFlow({ status: 'pending' }).steps.length, 4);
});

test('ตีกลับ — ตกที่ SV ถ้ายังไม่มี sv_approved_at · ตกที่ QA ถ้ามี', () => {
  assert.deepEqual(states(fourMFlow({ status: 'rejected' })), ['done', 'done/bad', 'todo', 'todo']);
  assert.deepEqual(states(fourMFlow({ status: 'rejected', sv_approved_at: 'x' })), ['done', 'done', 'done/bad', 'todo']);
  // ใบไม่ต้อง QA แต่ SV เซ็นแล้วค่อยตีกลับ (รีเซ็ต) — ตกที่ SV
  assert.deepEqual(states(fourMFlow({ status: 'rejected', sv_approved_at: 'x', requires_qa: false })), ['done', 'done/bad', 'todo']);
  assert.equal(fourMFlow({ status: 'rejected' }).closed, true);
});

test('สถานะที่ไม่รู้จัก = known:false ห้ามเดา', () => {
  const f = fourMFlow({ status: 'open' });
  assert.equal(f.known, false); assert.equal(f.waiting, null); assert.ok(f.steps.every(s => s.state === 'todo'));
});
