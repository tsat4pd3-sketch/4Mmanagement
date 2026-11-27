import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTone, buildSendBoard, buildRecvBoard, storeTvSteps, STORE_TV_FLIP_SEC } from '../storeTvBoard.js';

const NOW = Date.parse('2026-11-24T10:00:00Z');
const ago = (m) => new Date(NOW - m * 60000).toISOString();

test('เกณฑ์ที่ user เคาะ: เหลือง > 15 นาที · แดง > 30 นาที · สลับ 20 วิ', () => {
  assert.equal(STORE_TV_FLIP_SEC, 20);
  assert.equal(callTone(15), 'ok');
  assert.equal(callTone(16), 'warn');
  assert.equal(callTone(30), 'warn');
  assert.equal(callTone(31), 'bad');
  assert.equal(callTone(null), 'none');
});

test('ส่งของ: รอนานสุดก่อน · ส่งแล้วท้ายสุดไม่ไล่สี · นอกขอบเขตนับว่าซ่อน', () => {
  const b = buildSendBoard([
    { id: 1, status: 'pending', line_name: 'A', requested_at: ago(5) },
    { id: 2, status: 'preparing', line_name: 'A', requested_at: ago(40) },
    { id: 3, status: 'delivered', line_name: 'A', requested_at: ago(90), delivered_at: ago(60) },
    { id: 4, status: 'pending', line_name: 'B', requested_at: ago(20) },
    { id: 5, status: 'pending', line_name: 'X', requested_at: ago(99) },
    { id: 6, status: 'pending', line_name: 'A', requested_at: null },
  ], { now: NOW, inScope: (l) => l !== 'X' });
  assert.deepEqual(b.cards.map(c => c.id), [2, 4, 1, 6, 3]);
  assert.deepEqual(b.cards.map(c => c.tone), ['bad', 'warn', 'ok', 'none', 'done']);
  assert.deepEqual(b.kpi, { pending: 3, preparing: 1, delivered: 1, late: 1 });
  assert.equal(b.hiddenScope, 1);
  assert.equal(b.unknownAge, 1);
});

test('รับของ: ยุบกอง · เกินกฎคลัง = แดง · กรองคลังของจอนี้แล้วบอกว่าซ่อน', () => {
  const r = (id, src, dest, mins, qty = 10) => ({ id, status: 'pending', mat_no: 'M1', source_line: src, dest_line_name: dest, created_at: ago(mins), qty_expected: qty });
  const b = buildRecvBoard([r(1, 'L1', 'STORE', 300), r(2, 'L1', 'STORE', 10), r(3, 'L1', 'FG', 30), r(4, 'Z', 'STORE', 5)],
    { now: NOW, staleOf: () => 240, inScope: (l) => l !== 'Z' });
  assert.equal(b.cards.length, 2);   // กอง L1→STORE (2 ใบ) + L1→FG
  const store = b.cards.find(c => c.line === 'L1 → STORE');
  assert.equal(store.count, 2); assert.equal(store.qty, 20); assert.equal(store.tone, 'bad');
  assert.equal(b.kpi.slips, 3); assert.equal(b.kpi.stale, 1);
  assert.equal(b.hiddenScope, 1);
  const only = buildRecvBoard([r(1, 'L1', 'STORE', 5), r(3, 'L1', 'FG', 5)], { now: NOW, dest: 'FG' });
  assert.equal(only.cards.length, 1); assert.equal(only.hiddenDest, 1);
});

test('ลำดับหน้า: ส่งของทุกหน้า → รับของทุกหน้า · ไม่มีใบยังได้ 1 หน้า', () => {
  assert.deepEqual(storeTvSteps(0, 0).map(s => s.view), ['send', 'recv']);
  assert.deepEqual(storeTvSteps(9, 3).map(s => `${s.view}${s.page}`), ['send0', 'send1', 'recv0']);
});
