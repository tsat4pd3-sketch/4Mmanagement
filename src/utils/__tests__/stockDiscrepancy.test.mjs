import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortReceiptRows, sidesOf, proposeBlock, confirmBlock, resolveLedgerRows, monthlySummary, SUSPENSE_LOC } from '../stockDiscrepancy.js';

const sum = (rows, loc) => rows.filter(r => r.line_name === loc)
  .reduce((s, r) => s + (r.type === 'issue' || r.type === 'adjust' ? r.qty : -r.qty), 0);

test('รับไม่ครบ: ยอดไม่หาย — ไลน์ −ขาด · คลังพัก +ขาด (รวม = 0)', () => {
  const rows = shortReceiptRows({ line: 'LINE B', mat: '50030155', part: 'X', short: 50, workDate: '2026-11-05', by: 'ก', ref: 'ใบ ab12' });
  assert.equal(rows.length, 2);
  assert.equal(sum(rows, 'LINE B'), -50);
  assert.equal(sum(rows, SUSPENSE_LOC), 50);
  assert.equal(shortReceiptRows({ line: 'L', mat: 'M', short: 0 }).length, 0);
});

test('ยืนยันคู่: ต้องคนละฝ่าย + คนละคน', () => {
  const d = { status: 'proposed', proposed_side: 'store', proposed_by: 'สมชาย' };
  assert.match(confirmBlock(d, { side: 'store', sides: ['store'], by: 'สมหญิง' }), /อีกฝ่าย/);
  assert.match(confirmBlock(d, { side: 'line', sides: ['line', 'store'], by: 'สมชาย' }), /ผู้เสนอยืนยันเองไม่ได้/);
  assert.match(confirmBlock(d, { side: 'line', sides: ['store'], by: 'x' }), /ไม่มีสิทธิ์/);
  assert.equal(confirmBlock(d, { side: 'line', sides: ['line'], by: 'สมหญิง' }), null);
  assert.ok(confirmBlock({ status: 'open' }, { side: 'line', sides: ['line'] }));
});

test('เสนอผล: เฉพาะเคสรอเคลียร์ + ผลที่รู้จัก + ฝ่ายที่มีสิทธิ์', () => {
  assert.equal(proposeBlock({ status: 'open' }, { side: 'line', sides: ['line'], outcome: 'returned' }), null);
  assert.ok(proposeBlock({ status: 'proposed' }, { side: 'line', sides: ['line'], outcome: 'returned' }));
  assert.ok(proposeBlock({ status: 'open' }, { side: 'line', sides: ['line'], outcome: 'x' }));
  assert.ok(proposeBlock({ status: 'open' }, { side: 'store', sides: ['line'], outcome: 'returned' }));
  assert.deepEqual(sidesOf({ canStore: true, canLine: false }), ['store']);
});

test('เคลียร์: คืน STORE = คลังพัก −, STORE + · ตัดหาย = คลังพัก − อย่างเดียว', () => {
  const d = { short_qty: 50, line_name: 'LINE B', mat_no: '50030155' };
  const ret = resolveLedgerRows(d, { outcome: 'returned', workDate: '2026-11-05', sapDoc: '4900012345' });
  assert.equal(sum(ret, SUSPENSE_LOC), -50); assert.equal(sum(ret, 'STORE'), 50);
  assert.match(ret[0].note, /SAP 4900012345/);
  const off = resolveLedgerRows(d, { outcome: 'written_off', workDate: '2026-11-05' });
  assert.equal(off.length, 1); assert.equal(sum(off, SUSPENSE_LOC), -50);
});

test('สรุปรายเดือน', () => {
  const s = monthlySummary([
    { work_date: '2026-11-04', short_qty: 50, status: 'open' },
    { work_date: '2026-11-05', short_qty: 30, status: 'returned' },
    { work_date: '2026-10-30', short_qty: 10, status: 'written_off' },
    { work_date: '2026-11-05', short_qty: 5, status: 'proposed' },
  ]);
  assert.deepEqual(s.map(m => [m.month, m.cases, m.qty, m.openQty, m.returnedQty, m.writtenOffQty]),
    [['2026-11', 3, 85, 55, 30, 0], ['2026-10', 1, 10, 0, 0, 10]]);
});
