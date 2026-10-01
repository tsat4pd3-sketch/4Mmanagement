import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECEIPT_LINE, destSummary, buildReceiptRows } from '../stockReceipt.js';

const slip = (qty, dest, extra = {}) => ({ qty, dest_line: dest, ...extra });

test('🔴 ของซื้อที่รับเข้า ต้องลงที่คลัง ไม่ใช่ไลน์ปลายทาง (ต้นเหตุยอดหน้าไลน์บวม 1.3 ล้าน)', () => {
  const rows = buildReceiptRows({
    matNo: '30044771', slips: [slip(318000, 'Assy GOR'), slip(38000, 'Line 60')],
    workDate: '2026-10-01',
  });
  assert.equal(rows.length, 1, 'ของก้อนเดียวเข้าคลังก้อนเดียว = แถวเดียว');
  assert.equal(rows[0].line_name, RECEIPT_LINE);
  assert.notEqual(rows[0].line_name, 'Assy GOR');
  assert.equal(rows[0].qty, 356000);
  assert.equal(rows[0].type, 'issue');
});

test('ไลน์ที่รอของต้องถูกบันทึกไว้ในหมายเหตุ (เรียงมาก→น้อย) — ข้อมูลหาย = สโตร์ไม่รู้จะจ่ายไปไหน', () => {
  const [r] = buildReceiptRows({
    matNo: 'M1', slips: [slip(10, 'Line 60'), slip(90, 'Line 61'), slip(50, 'Line 60')],
    supplier: 'TR', workDate: '2026-10-01',
  });
  assert.match(r.note, /Line 61 90/);
  assert.match(r.note, /Line 60 60/);
  assert.ok(r.note.indexOf('Line 61') < r.note.indexOf('Line 60'), 'มากสุดต้องมาก่อน');
  assert.match(r.note, /TR/);
  assert.match(r.note, /รวม 3 ใบ/);
});

test('🔴 ใบที่ไม่ระบุปลายทาง ต้องรับเข้าคลังได้ตามปกติ — "ไม่รู้ว่าใครใช้" ≠ "ของไม่ได้มา"', () => {
  const rows = buildReceiptRows({ matNo: 'M1', slips: [slip(500, null)], workDate: '2026-10-01' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty, 500);
  assert.match(rows[0].note, /ไม่ระบุปลายทาง 500/);
});

test('ไม่มีของ (0 ใบ / qty รวม 0) = ไม่สร้างแถว ห้ามโพสต์ ledger ว่างเปล่า', () => {
  assert.deepEqual(buildReceiptRows({ matNo: 'M1', slips: [], workDate: '2026-10-01' }), []);
  assert.deepEqual(buildReceiptRows({ matNo: 'M1', slips: [slip(0, 'L')], workDate: '2026-10-01' }), []);
});

test('วันงานยึดของใบจริงก่อน · ไม่มีค่อยใช้ fallback', () => {
  const [a] = buildReceiptRows({ matNo: 'M1', slips: [slip(5, 'L', { work_date: '2026-09-20' })], workDate: '2026-10-01' });
  assert.equal(a.work_date, '2026-09-20');
  const [b] = buildReceiptRows({ matNo: 'M1', slips: [slip(5, 'L')], workDate: '2026-10-01' });
  assert.equal(b.work_date, '2026-10-01');
});

test('รหัสคลัง SAP: ไม่รู้ = ไม่ใส่คีย์เลย (ห้ามเดา/ห้ามใส่ null ทับ default ของ trigger)', () => {
  const [none] = buildReceiptRows({ matNo: 'M1', slips: [slip(5, 'L')], workDate: '2026-10-01' });
  assert.ok(!('storage_location' in none));
  const [has] = buildReceiptRows({ matNo: 'M1', slips: [slip(5, 'L')], workDate: '2026-10-01', storageLocation: 'S401' });
  assert.equal(has.storage_location, 'S401');
});

test('ชื่อพาร์ท: ใช้ของกลุ่มก่อน ไม่มีค่อยหยิบจากใบ · ไม่มีเลย = null', () => {
  const [a] = buildReceiptRows({ matNo: 'M1', partName: 'NUT', slips: [slip(5, 'L', { part_name: 'X' })], workDate: 'd' });
  assert.equal(a.part_name, 'NUT');
  const [b] = buildReceiptRows({ matNo: 'M1', slips: [slip(5, 'L', { part_name: 'X' })], workDate: 'd' });
  assert.equal(b.part_name, 'X');
  const [c] = buildReceiptRows({ matNo: 'M1', slips: [slip(5, 'L')], workDate: 'd' });
  assert.equal(c.part_name, null);
});

test('destSummary รวมยอดต่อปลายทาง และไม่พังเมื่อ qty เพี้ยน', () => {
  assert.equal(destSummary([]), '');
  assert.equal(destSummary([slip('abc', 'L')]), 'L 0');
  assert.equal(destSummary([slip(1000, 'L')]), 'L 1,000');
});
