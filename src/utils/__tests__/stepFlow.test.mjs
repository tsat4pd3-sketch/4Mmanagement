import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linearFlow, scrapReportFlow, pmCoordinationFlow, shiftCloseFlow, ojtFlow } from '../stepFlow.js';

const st = (f) => f.steps.map(s => s.state + (s.tone ? '/' + s.tone : ''));
const STEPS = [{ key: 'a', label: 'A', who: 'คน A', action: 'ทำ A' }, { key: 'b', label: 'B', who: 'คน B' }, { key: 'c', label: 'C' }];

test('linearFlow — at ชี้ขั้นปัจจุบัน · index = length = จบครบ · waiting = who — action', () => {
  const f = linearFlow({ status: 'x', steps: STEPS, at: { x: 1, y: 3 } });
  assert.deepEqual(st(f), ['done', 'current', 'todo']); assert.equal(f.waiting, 'คน B — B'); assert.equal(f.closed, false);
  const g = linearFlow({ status: 'y', steps: STEPS, at: { x: 1, y: 3 } });
  assert.deepEqual(st(g), ['done', 'done', 'done']); assert.equal(g.closed, true); assert.equal(g.waiting, null);
  assert.equal(linearFlow({ status: 'w', steps: STEPS, at: { w: 0 } }).waiting, 'คน A — ทำ A');
});

test('linearFlow — exits หยุดที่ขั้น at (ค่าคงที่/ฟังก์ชัน) ใส่ tone + label · เกินขอบ = หนีบ', () => {
  const f = linearFlow({ status: 'cancelled', steps: STEPS, at: {}, exits: { cancelled: { tone: 'none', label: 'ยกเลิก', at: 1 } } });
  assert.deepEqual(st(f), ['done', 'done/none', 'todo']); assert.match(f.steps[1].label, /ยกเลิก/); assert.equal(f.closed, true);
  const g = linearFlow({ status: 'rejected', steps: STEPS, row: { late: true }, at: {}, exits: { rejected: { tone: 'bad', at: (r) => (r.late ? 9 : 0) } } });
  assert.deepEqual(st(g), ['done', 'done', 'done/bad']);
  assert.deepEqual(st(linearFlow({ status: 'rejected', steps: STEPS, exits: { rejected: { tone: 'bad' } } })), ['done/bad', 'todo', 'todo']);
});

test('🔴 สถานะที่ไม่รู้จัก = known:false ทุกขั้น todo ไม่มี waiting', () => {
  const f = linearFlow({ status: 'open', steps: STEPS, at: { x: 1 } });
  assert.equal(f.known, false); assert.equal(f.waiting, null); assert.ok(f.steps.every(s => s.state === 'todo'));
});

test('flow ของใบที่สถานะอยู่ในหน้า — scrap · PM coordination · ขอปิดกะ · OJT', () => {
  assert.deepEqual(st(scrapReportFlow({ status: 'submitted' })), ['done', 'current', 'todo']);
  assert.deepEqual(st(scrapReportFlow({ status: 'approved' })), ['done', 'done', 'done']);
  assert.deepEqual(st(pmCoordinationFlow({ status: 'cancelled', notified_at: 'x' })), ['done', 'done/none', 'todo']);
  assert.deepEqual(st(pmCoordinationFlow({ status: 'notified' })), ['done', 'current', 'todo']);
  const pc = shiftCloseFlow({ status: 'pending_close' });
  assert.deepEqual(st(pc), ['done', 'current', 'todo']); assert.match(pc.waiting, /SV/);
  assert.deepEqual(st(shiftCloseFlow({ status: 'void' })), ['done/none', 'todo', 'todo']);
  assert.equal(shiftCloseFlow({ status: 'weird' }).known, false);
  assert.deepEqual(st(ojtFlow({ status: 'open' })), ['done', 'current', 'todo']);
  assert.deepEqual(st(ojtFlow({ status: 'open', approved_at: 'x', approver_uid: 'u' })), ['done', 'done', 'current']);
  assert.deepEqual(st(ojtFlow({ status: 'completed' })), ['done', 'done', 'done']);
});
