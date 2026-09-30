/* แผงตัวสะสม demand ต้องตอบ "อะไรครบล็อตแล้ว" ได้ ไม่ใช่กองการ์ดเรียงตามจำนวน (2026-09-30)
   ⏱️ ทุกเคสส่ง now เข้าไปเอง — ห้ามอ่านนาฬิกาจริง (กันเทสระเบิดเวลา) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupAccumulator, lotSizeOf, STALE_DAYS } from '../pullAccumulator.js';

const NOW = Date.parse('2026-09-30T03:00:00+07:00');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const row = (mat, qty, upd = daysAgo(1)) => ({ child_mat_no: mat, pending_qty: qty, updated_at: upd });

test('แยก 3 กลุ่มตาม "ต้องทำอะไรต่อ" — ครบ / กำลังสะสม / ยังไม่ตั้ง lot', () => {
  const g = groupAccumulator(
    [row('A', 600), row('B', 100), row('C', 50)],
    { A: 600, B: 600 }, NOW);
  assert.deepEqual(g.ready.map(r => r.child_mat_no), ['A']);
  assert.deepEqual(g.waiting.map(r => r.child_mat_no), ['B']);
  assert.deepEqual(g.noLot.map(r => r.child_mat_no), ['C'], 'ไม่มี lot = กลุ่มตั้งค่า ไม่ใช่กลุ่มรอ');
  assert.equal(g.total, 3);
});

test('🔴 เรียง "กำลังสะสม" ด้วย % ของล็อต ไม่ใช่จำนวนดิบ (เคสจริงที่ทำให้บอร์ดอ่านไม่ได้)', () => {
  // 640/4800 = 13% · 519/600 = 86% — เดิมเรียงตามจำนวนดิบ 640 จะขึ้นก่อน ทั้งที่ยังอีกไกล
  const g = groupAccumulator([row('BIG', 640), row('NEAR', 519)], { BIG: 4800, NEAR: 600 }, NOW);
  assert.deepEqual(g.waiting.map(r => r.child_mat_no), ['NEAR', 'BIG']);
  assert.equal(Math.round(g.waiting[0].pct), 87);
});

test('lot ที่ยังไม่ตั้ง ต้องเป็น null ไม่ใช่ 0 (0 จะถูกอ่านว่าครบแล้ว/หารศูนย์)', () => {
  assert.equal(lotSizeOf({ X: 0 }, 'X'), null);
  assert.equal(lotSizeOf({ X: -5 }, 'X'), null);
  assert.equal(lotSizeOf({}, 'X'), null);
  assert.equal(lotSizeOf({ X: '600' }, 'X'), 600, 'ค่าที่มาเป็นสตริงจาก DB ต้องใช้ได้');
  const g = groupAccumulator([row('X', 10)], { X: 0 }, NOW);
  assert.equal(g.ready.length, 0, 'lot=0 ห้ามตกไปกลุ่ม "ครบแล้ว"');
  assert.equal(g.noLot[0].pct, null, 'pct ต้องเป็น null ไม่ใช่ 0');
});

test('ครบล็อตพอดี (qty === lot) นับเป็นครบ', () => {
  const g = groupAccumulator([row('A', 600)], { A: 600 }, NOW);
  assert.equal(g.ready.length, 1);
  assert.equal(g.waiting.length, 0);
});

test('ค้างเกิน 30 วัน ติดธง stale + นับรวมให้จอบอกได้', () => {
  const g = groupAccumulator(
    [row('OLD', 100, daysAgo(STALE_DAYS + 1)), row('NEW', 100, daysAgo(2))],
    { OLD: 600, NEW: 600 }, NOW);
  assert.equal(g.staleCount, 1);
  assert.equal(g.waiting.find(r => r.child_mat_no === 'OLD').stale, true);
  assert.equal(g.waiting.find(r => r.child_mat_no === 'NEW').stale, false);
});

test('updated_at ว่าง/เพี้ยน = ไม่เดาว่าค้าง (ไม่ throw)', () => {
  const g = groupAccumulator([row('A', 10, null), row('B', 10, 'ไม่ใช่วันที่')], { A: 600, B: 600 }, NOW);
  assert.equal(g.staleCount, 0);
});

test('ไม่มีแถว / undefined ต้องไม่ throw', () => {
  const g = groupAccumulator(undefined, {}, NOW);
  assert.deepEqual([g.ready.length, g.waiting.length, g.noLot.length, g.total], [0, 0, 0, 0]);
});

test('ไม่มีแถวไหนหายระหว่างจัดกลุ่ม (กำแพง 98 การ์ดของจริงต้องครบ 98)', () => {
  const rows = Array.from({ length: 98 }, (_, i) => row(`M${i}`, i * 10));
  const map = Object.fromEntries(rows.map((r, i) => (i % 5 === 0 ? [] : [r.child_mat_no, 500]))
    .filter(x => x.length));
  const g = groupAccumulator(rows, map, NOW);
  assert.equal(g.ready.length + g.waiting.length + g.noLot.length, 98);
});
