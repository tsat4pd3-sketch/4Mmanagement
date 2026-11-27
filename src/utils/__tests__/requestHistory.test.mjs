import test from 'node:test';
import assert from 'node:assert/strict';
import { reqOutcome, leadMinOf, qtyDiffOf, summarizeRequests, workRangeToTs } from '../requestHistory.js';

test('reqOutcome — รับครบ/ไม่ครบ/ไม่มียอด/รอรับ/ยังไม่ส่ง/ยกเลิก/ไม่รู้จัก', () => {
  assert.equal(reqOutcome({ status: 'received', request_qty: 10, received_qty: 12 }), 'full');   // ส่งเกินตามกล่อง = ครบ
  assert.equal(reqOutcome({ status: 'received', request_qty: '10', received_qty: '10' }), 'full');
  assert.equal(reqOutcome({ status: 'received', request_qty: 10, received_qty: 7 }), 'short');
  assert.equal(reqOutcome({ status: 'received', request_qty: 10, received_qty: null }), 'recv_noqty'); // ห้ามเดาว่าครบ
  assert.equal(reqOutcome({ status: 'delivered' }), 'awaiting');
  assert.equal(reqOutcome({ status: 'pending' }), 'open');
  assert.equal(reqOutcome({ status: 'preparing' }), 'open');
  assert.equal(reqOutcome({ status: 'cancelled' }), 'cancelled');
  assert.equal(reqOutcome({ status: 'on_hold' }), 'other');                                       // ไม่รู้จัก = ไม่ทิ้ง
});

test('leadMinOf / qtyDiffOf — ไม่รู้ = null ห้ามคืน 0', () => {
  assert.equal(leadMinOf({ requested_at: '2026-11-27T01:00:00Z', received_at: '2026-11-27T01:45:00Z' }), 45);
  assert.equal(leadMinOf({ requested_at: '2026-11-27T01:00:00Z' }), null);
  assert.equal(leadMinOf({ requested_at: 'x', received_at: '2026-11-27T01:45:00Z' }), null);
  assert.equal(qtyDiffOf({ status: 'received', request_qty: 10, received_qty: 7 }), -3);
  assert.equal(qtyDiffOf({ status: 'delivered', request_qty: 10, received_qty: 7 }), null);
});

test('summarizeRequests — ค้าง = ยังไม่ส่ง + รอรับ · เฉลี่ยเวลาเฉพาะใบที่รู้เวลา', () => {
  const s = summarizeRequests([
    { status: 'received', request_qty: 10, received_qty: 10, requested_at: '2026-11-27T01:00:00Z', received_at: '2026-11-27T01:30:00Z' },
    { status: 'received', request_qty: 10, received_qty: 5,  requested_at: '2026-11-27T01:00:00Z', received_at: '2026-11-27T02:30:00Z' },
    { status: 'delivered' }, { status: 'pending' }, { status: 'cancelled' },
  ]);
  assert.equal(s.total, 5);
  assert.equal(s.active, 4);
  assert.equal(s.byOutcome.full, 1);
  assert.equal(s.byOutcome.short, 1);
  assert.equal(s.pending, 2);
  assert.equal(s.avgLeadMin, 60);
  assert.equal(s.leadN, 2);
  assert.equal(summarizeRequests([]).avgLeadMin, null);
});

test('workRangeToTs — วันทำงานเริ่ม 08:00 ไทย · ข้ามเดือนได้ · แกะไม่ออก = null', () => {
  assert.deepEqual(workRangeToTs('2026-11-01', '2026-11-30'),
    { gte: '2026-11-01T08:00:00+07:00', lt: '2026-12-01T08:00:00+07:00' });
  assert.equal(workRangeToTs('', '2026-11-30'), null);
});
