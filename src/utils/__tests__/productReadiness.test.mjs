import test from 'node:test';
import assert from 'node:assert/strict';
import { productReadiness, READINESS_STEPS } from '../productReadiness.js';

const FG = { mat_no: '10011234', cycle_time_sec: 30 };
const CHILD = { mat_no: '20011234', cycle_time_sec: 30 };
const OP = { mat_no: '20011234-OP20', cycle_time_sec: 30, is_operation: true };
const FULL = { bom: 3, routing: true, packaging: true, kanban: 1 };
const st = (r, k) => r.steps.find(s => s.key === k).status;

test('FG ครบทุกขั้น = ok', () => {
  const r = productReadiness(FG, FULL);
  assert.equal(r.ok, true);
  assert.equal(r.total, READINESS_STEPS.length);
  assert.equal(r.done, r.total);
  assert.deepEqual(r.missing, []);
});

test('ไม่มี BOM / CT = ขาดจริง (miss) — บังคับแล้ววันนี้', () => {
  const r = productReadiness({ mat_no: '10011234' }, { ...FULL, bom: 0 });
  assert.equal(st(r, 'bom'), 'miss');
  assert.equal(st(r, 'ct'), 'miss');            // cycle_time_sec ไม่มี
  assert.deepEqual(r.missingRequired, ['bom', 'ct']);
  assert.equal(r.ok, false);
});

test('🔴 Routing/Packaging ที่ยังไม่ลง = "รอ" (wait) ไม่ใช่ "ขาด" — user: อนาคตต้องบังคับ', () => {
  const r = productReadiness(FG, { bom: 2, kanban: 1 });
  assert.equal(st(r, 'routing'), 'wait');
  assert.equal(st(r, 'packaging'), 'wait');
  assert.deepEqual(r.missingRequired, []);       // ⇒ ตัวกรอง "ยังไม่ครบ (บังคับ)" ต้องไม่เด้งขึ้นมา
  assert.deepEqual(r.missing, ['routing', 'packaging']);
});

test('child part (MAT ขึ้นต้น 2) ไม่ต้องมี packaging = na ไม่นับในตัวหาร', () => {
  const r = productReadiness(CHILD, { bom: 1, routing: true, kanban: 1 });
  assert.equal(st(r, 'packaging'), 'na');
  assert.equal(r.total, READINESS_STEPS.length - 1);
  assert.equal(r.missing.includes('packaging'), false);
});

test('ขั้นตอน (OP) ไม่มี kanban/packaging ของตัวเอง = na — กันเตือนที่ไม่มีวันหาย', () => {
  const r = productReadiness(OP, { bom: 2, routing: true });
  assert.equal(st(r, 'kanban'), 'na');
  assert.equal(st(r, 'packaging'), 'na');
  assert.equal(st(r, 'bom'), 'ok');
  assert.equal(r.total, 3);
});

test('CT = 0 ถือว่ายังไม่ได้ตั้ง (ไม่ใช่ "มีค่าแล้ว")', () => {
  const r = productReadiness({ mat_no: '10011234', cycle_time_sec: 0 }, FULL);
  assert.equal(st(r, 'ct'), 'miss');
});
