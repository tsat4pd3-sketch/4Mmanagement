/* คิวรับเข้าคลัง — ปิดกฎ ≠ ต้องยืนยัน (2026-10-02) · เวลาตรึงค่าเสมอ (ด่านนาฬิกา +400 วัน) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inflowModeOf, inflowPatchFor, inflowModesFor, lotMatsOf, receiptAgeMin, isStaleReceipt, ageText,
  validateReceive, receiptZoneStatus, sortReceipts, DEFAULT_STALE_MIN, groupReceipts, allocateFifo,
} from '../stockReceipts.js';

const NOW = Date.parse('2026-10-02T09:00:00Z');

test('โหมดกฎ 3 ทาง — ปิดคือปิด ไม่ใช่ยืนยัน', () => {
  assert.equal(inflowModeOf({ is_active: false, mode: 'confirm' }), 'off');
  assert.equal(inflowModeOf({ is_active: true, mode: 'confirm' }), 'confirm');
  assert.equal(inflowModeOf({ is_active: true, mode: 'auto' }), 'auto');
  assert.equal(inflowModeOf({ is_active: true }), 'auto');
  assert.equal(inflowModeOf(null), 'off');
});

test('เลือกโหมดแล้วเขียนค่าถูก · ปิดแล้วจำโหมดเดิมไว้', () => {
  assert.deepEqual(inflowPatchFor('confirm', {}), { is_active: true, mode: 'confirm' });
  assert.deepEqual(inflowPatchFor('auto', { mode: 'confirm' }), { is_active: true, mode: 'auto' });
  assert.deepEqual(inflowPatchFor('off', { mode: 'confirm' }), { is_active: false, mode: 'confirm' });
});

test('อายุใบ + เกณฑ์ค้าง', () => {
  const r = { status: 'pending', created_at: '2026-10-02T04:00:00Z' };   // 300 น.
  assert.equal(receiptAgeMin(r, NOW), 300);
  assert.equal(isStaleReceipt(r, 240, NOW), true);
  assert.equal(isStaleReceipt(r, 360, NOW), false);
  assert.equal(isStaleReceipt({ ...r, status: 'received' }, 240, NOW), false);
  assert.equal(isStaleReceipt(r, null, NOW), 300 > DEFAULT_STALE_MIN);
  assert.equal(receiptAgeMin({ created_at: 'x' }, NOW), null);
});

test('ข้อความอายุ', () => {
  assert.equal(ageText(null), '—');
  assert.equal(ageText(45), '45 น.');
  assert.equal(ageText(135), '2 ชม. 15 น.');
  assert.equal(ageText(120), '2 ชม.');
  assert.equal(ageText(60 * 26), '1 วัน 2 ชม.');
});

test('ยอดตรง = รับได้ · ไม่ตรง = ต้องมีเหตุผล · 0 ชิ้นรับได้ถ้าบอกเหตุผล', () => {
  assert.equal(validateReceive({ expected: 60, qty: 60 }).ok, true);
  const short = validateReceive({ expected: 60, qty: 55 });
  assert.equal(short.ok, false);
  assert.equal(short.diff, -5);
  assert.equal(validateReceive({ expected: 60, qty: 55, reason: 'ของเสีย 5' }).ok, true);
  assert.equal(validateReceive({ expected: 60, qty: 0, reason: 'ของยังไม่มาถึง' }).ok, true);
  assert.equal(validateReceive({ expected: 60, qty: -1, reason: 'x' }).ok, false);
  assert.equal(validateReceive({ expected: 60, qty: '' }).ok, false);
});

test('โซน: ใบรอรับที่ค้างเกินเกณฑ์แยกเป็น stale · เรียงค้างนานก่อน', () => {
  const a = { id: 'a', status: 'pending', created_at: '2026-10-02T08:30:00Z' };
  const b = { id: 'b', status: 'pending', created_at: '2026-10-02T03:00:00Z' };
  assert.equal(receiptZoneStatus(a, () => 240, NOW), 'pending');
  assert.equal(receiptZoneStatus(b, () => 240, NOW), 'stale');
  assert.deepEqual(sortReceipts([a, b]).map(r => r.id), ['b', 'a']);
});

test('🔧 โหมดปิดล็อต (19/10) — เฉพาะกฎ MAT · ปิดแล้วเปิดกลับได้โหมดเดิม · lotMatsOf อ่านจากกฎ', () => {
  assert.equal(inflowModeOf({ is_active: true, mode: 'lot' }), 'lot');
  assert.equal(inflowModeOf({ is_active: false, mode: 'lot' }), 'off');
  assert.deepEqual(inflowPatchFor('lot', {}), { is_active: true, mode: 'lot' });
  assert.deepEqual(inflowPatchFor('off', { mode: 'lot' }), { is_active: false, mode: 'lot' });
  assert.ok(inflowModesFor({ match_type: 'mat' }).some(m => m.key === 'lot'));
  assert.ok(!inflowModesFor({ match_type: 'prefix' }).some(m => m.key === 'lot'), 'prefix ห้ามเป็นโหมดล็อต (ทั้งตระกูลหายเงียบ)');
  const lots = lotMatsOf([
    { match_type: 'mat', match_value: '20066660', mode: 'lot', is_active: true },
    { match_type: 'mat', match_value: '20058498', mode: 'confirm', is_active: true },
    { match_type: 'mat', match_value: '20059344', mode: 'lot', is_active: false },
    { match_type: 'prefix', match_value: '2', mode: 'lot', is_active: true },
  ]);
  assert.deepEqual([...lots], ['20066660']);
});

/* ═══ 🧺 ยุบใบเป็นกอง + ปันยอดแบบ FIFO (22/10) ═══════════════════════════════════
   เคสจริงที่ทำให้ต้องมี: 20058498 ค้าง 169 ใบ / 2,324 ชิ้น / 3 วัน เส้นทางเดียวกันเป๊ะ */
const slip = (id, exp, at, over = {}) => ({
  id, qty_expected: exp, created_at: at, status: 'pending',
  mat_no: '20058498', part_name: 'SUPT ASY RAD ก่อนชุบ', source_line: 'Assy GOR', dest_line_name: 'STORE', ...over,
});

test('ยุบเฉพาะใบที่เส้นทางเหมือนกันเป๊ะ — ปลายทางต่าง = คนละกอง', () => {
  const g = groupReceipts([
    slip('a', 14, '2026-10-19T01:00:00Z'),
    slip('b', 14, '2026-10-19T02:00:00Z'),
    slip('c', 14, '2026-10-19T03:00:00Z', { dest_line_name: 'FG WAREHOUSE' }),
    slip('d', 14, '2026-10-19T04:00:00Z', { source_line: 'Line 60' }),
    slip('e', 14, '2026-10-19T05:00:00Z', { mat_no: '20058495' }),
  ]);
  assert.equal(g.length, 4);
  assert.equal(g[0].count, 2);
  assert.equal(g[0].expected, 28);
});

test('ใบที่ไม่ได้รออยู่ ไม่เข้ากอง', () => {
  assert.equal(groupReceipts([
    slip('a', 14, '2026-10-19T01:00:00Z', { status: 'received' }),
    slip('b', 14, '2026-10-19T02:00:00Z', { status: 'cancelled' }),
  ]).length, 0);
});

test('กองที่ค้างนานสุดขึ้นก่อน · ในกองเรียงใบเก่าก่อน', () => {
  const g = groupReceipts([
    slip('new', 10, '2026-10-21T00:00:00Z', { mat_no: 'B' }),
    slip('old2', 10, '2026-10-19T09:00:00Z'),
    slip('old1', 10, '2026-10-19T01:00:00Z'),
  ]);
  assert.equal(g[0].mat_no, '20058498');
  assert.deepEqual(g[0].slips.map(s => s.id), ['old1', 'old2']);
});

test('🔴 กองที่อ่านเวลาไม่ออกต้องต่อท้าย ห้ามหายจากจอ', () => {
  const g = groupReceipts([
    slip('x', 10, null, { mat_no: 'NOTIME' }),
    slip('y', 10, '2026-10-19T01:00:00Z'),
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[g.length - 1].mat_no, 'NOTIME');
});

test('นับได้ตรงยอดรวม — ทุกใบได้เต็มตามใบ', () => {
  const s = [slip('a', 14, '1'), slip('b', 14, '2'), slip('c', 14, '3')];
  const r = allocateFifo(s, 42);
  assert.deepEqual(r.parts.map(p => p.alloc), [14, 14, 14]);
  assert.equal(r.diff, 0);
  assert.equal(r.zeroed, 0);
});

test('🔴 นับได้น้อยกว่า — ใบเก่าได้ก่อนจนหมด ใบท้ายได้ 0 (ห้ามเฉลี่ยเป็นทศนิยม)', () => {
  const s = [slip('a', 14, '1'), slip('b', 14, '2'), slip('c', 14, '3')];
  const r = allocateFifo(s, 20);
  assert.deepEqual(r.parts.map(p => p.alloc), [14, 6, 0]);
  assert.ok(r.parts.every(p => Number.isInteger(p.alloc)));
  assert.equal(r.diff, -22);
  assert.equal(r.zeroed, 1);
});

test('นับได้เกิน — ส่วนเกินลงใบใหม่สุด', () => {
  const r = allocateFifo([slip('a', 14, '1'), slip('b', 14, '2')], 30);
  assert.deepEqual(r.parts.map(p => p.alloc), [14, 16]);
  assert.equal(r.diff, 2);
});

test('นับได้ 0 — ทุกใบได้ 0 และนับว่าเป็นใบที่ยังมาไม่ถึงทั้งกอง', () => {
  const r = allocateFifo([slip('a', 14, '1'), slip('b', 14, '2')], 0);
  assert.deepEqual(r.parts.map(p => p.alloc), [0, 0]);
  assert.equal(r.zeroed, 2);
  assert.equal(r.diff, -28);
});

test('ยอดที่กรอกเป็นเศษ/ติดลบ/อ่านไม่ออก = ไม่ปันให้ใบไหนเลย (จอต้องกันก่อนถึงตรงนี้)', () => {
  for (const bad of [-5, 'x', null, undefined, NaN]) {
    const r = allocateFifo([slip('a', 14, '1')], bad);
    assert.equal(r.got, 0);
    assert.deepEqual(r.parts.map(p => p.alloc), [0]);
  }
  assert.equal(allocateFifo([slip('a', 14, '1')], 7.9).parts[0].alloc, 7);
});

test('กองเปล่า — ไม่ระเบิด', () => {
  const r = allocateFifo([], 10);
  assert.deepEqual(r.parts, []);
  assert.equal(r.expected, 0);
  assert.equal(r.diff, 10);
});

test('เคสจริง 20058498: 169 ใบ 2,324 ชิ้น นับได้จริง 2,300', () => {
  /* 163 ใบ × 14 = 2,282 (19/10) + 6 ใบ × 7 = 42 (20/10) → 169 ใบ / 2,324 ชิ้น */
  const s = Array.from({ length: 163 }, (_, i) => slip('s' + i, 14, '2026-10-19T' + String(i % 24).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + ':00Z'))
    .concat(Array.from({ length: 6 }, (_, i) => slip('t' + i, 7, '2026-10-20T0' + i + ':00:00Z')));
  const g = groupReceipts(s);
  assert.equal(g.length, 1);
  assert.equal(g[0].count, 169);
  assert.equal(g[0].expected, 2324);
  const r = allocateFifo(g[0].slips, 2300);
  assert.equal(r.parts.reduce((a, p) => a + p.alloc, 0), 2300);
  assert.equal(r.diff, -24);
  assert.equal(r.zeroed, 3);          // 3 ใบท้ายไม่ได้เลย เพราะยอดที่นับได้หมดก่อน
});
