import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sapPendingFields, summarizeSapPending } from '../sapPending.js';

const NOW = new Date('2026-11-04T09:00:00Z');
test('ปิดสวิตช์ = ไม่เขียนอะไร', () => {
  assert.deepEqual(sapPendingFields({ on: false, qty: 50 }), { fields: {}, error: null });
});
test('เปิดสวิตช์ = ต้องมียอด > 0 และไม่เกินยอดที่ส่ง', () => {
  assert.ok(sapPendingFields({ on: true, qty: '' }).error);
  assert.ok(sapPendingFields({ on: true, qty: '0' }).error);
  assert.ok(sapPendingFields({ on: true, qty: 'abc' }).error);
  assert.match(sapPendingFields({ on: true, qty: 300, max: 250 }).error, /มากกว่ายอดที่ส่ง/);
  const r = sapPendingFields({ on: true, qty: '1,200', note: ' SAP ยอดไม่พอ ', max: 2000, by: 'สโตร์', now: NOW });
  assert.equal(r.error, null);
  assert.deepEqual(r.fields, { sap_pending_qty: 1200, sap_pending_note: 'SAP ยอดไม่พอ', sap_pending_at: NOW.toISOString(), sap_pending_by_name: 'สโตร์' });
});
test('สรุปรายพาร์ท — ไม่นับใบที่เคลียร์แล้ว', () => {
  const s = summarizeSapPending([
    { mat_no: 'A', line_name: 'L1', sap_pending_qty: 100, sap_pending_at: '2026-11-03' },
    { mat_no: 'A', line_name: 'L2', sap_pending_qty: 50, sap_pending_at: '2026-11-01' },
    { mat_no: 'B', line_name: 'L1', sap_pending_qty: 500, sap_pending_at: '2026-11-04' },
    { mat_no: 'C', line_name: 'L1', sap_pending_qty: 999, sap_cleared_at: '2026-11-04' },
    { mat_no: 'D', line_name: 'L1', sap_pending_qty: null },
  ]);
  assert.equal(s.totalSlips, 3);
  assert.deepEqual(s.parts.map(p => [p.mat_no, p.qty, p.slips, p.lines.join('/'), p.oldest]), [['B', 500, 1, 'L1', '2026-11-04'], ['A', 150, 2, 'L1/L2', '2026-11-01']]);
});
