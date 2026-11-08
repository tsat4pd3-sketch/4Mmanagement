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

/* ── 🔴 "ใบของตัวเองว่าง" ≠ "ไม่มี BOM" (user แจ้ง 04/11 · เคส 20059152) ──────────────
   `bom_items.parent_mat` ให้ใบของตัวแม่กรอกลูกของพาร์ทนี้ไว้ได้ ⇒ พาร์ทมี BOM จริง
   แต่ `product_id` ของตัวเองไม่มีแถวเลย · นับแค่ใบตัวเอง = ขึ้น "BOM ✗" ทั้งที่แม่สร้างไว้แล้ว
   (วัดทั้งฐานวันนั้น: 31 พาร์ทโดนแบบนี้)                                               */
test('🔴 ลูกถูกกรอกไว้ในใบแม่ = มี BOM แล้ว ห้ามขึ้น "ยังขาด"', () => {
  const part = { mat_no: '20059152' };                       // ใบของตัวเองว่าง
  const r = productReadiness(part, { bom: 0, bomElsewhere: 2, ct: 1, routing: true, kanban: 1 });
  const bom = r.steps.find(s => s.key === 'bom');
  assert.equal(bom.status, 'ok', 'ใบแม่กรอกลูกไว้ให้แล้ว = มี BOM');
  assert.ok(!r.missingRequired.includes('bom'));
});

test('🔴 ครบเพราะใบอื่นกรอกไว้ให้ ต้องเขียนบอกบนจอ (hint) ห้ามขึ้นเขียวเฉยๆ', () => {
  const r = productReadiness({ mat_no: '20059152' }, { bom: 0, bomElsewhere: 2 });
  const bom = r.steps.find(s => s.key === 'bom');
  assert.match(bom.hint || '', /ใบอื่น/, 'ต้องบอกว่าลูกอยู่ในใบอื่น');
  assert.match(bom.hint || '', /2/, 'ต้องบอกจำนวนด้วย');
});

test('ใบของตัวเองมีของ = ไม่ต้องมี hint (พฤติกรรมเดิมห้ามเปลี่ยน)', () => {
  const r = productReadiness({ mat_no: '20059152' }, { bom: 3, bomElsewhere: 0 });
  const bom = r.steps.find(s => s.key === 'bom');
  assert.equal(bom.status, 'ok');
  assert.equal(bom.hint, undefined);
});

test('ไม่มีทั้ง 2 ที่ = ยังขาดจริง (ห้ามกลบเคสที่ขาดจริง)', () => {
  const r = productReadiness({ mat_no: '20059152' }, { bom: 0, bomElsewhere: 0 });
  assert.equal(r.steps.find(s => s.key === 'bom').status, 'miss');
  assert.ok(r.missingRequired.includes('bom'));
});
