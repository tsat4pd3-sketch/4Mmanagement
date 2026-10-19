/* ประวัติการซ่อมรายเครื่อง (19/10) — ตัวเลขที่ผิดแล้วเงียบ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeMachineHistory, problemLabelOf } from '../machineRepairHistory.js';
import { UNGROUPED_LABEL } from '../unclassified.js';

const T = (d, h) => new Date(Date.UTC(2026, 9, d, h, 0, 0)).toISOString();
const NOW = Date.UTC(2026, 9, 19, 0, 0, 0);

test('สรุปประวัติ — ใบตีกลับไม่นับ · วัดไม่ได้ไม่เป็น 0 · ส่งภายนอกหัก MTTR ช่าง', () => {
  const orders = [
    { id: 'a', machine_no: 'SW-10', status: 'closed', repair_type: 'Breakdown Maintenance', report_at: T(1, 1),
      accept_at: T(1, 2), repair_done_at: T(1, 5), problem_group: 'ระบบลม', labor_cost: 500 },
    { id: 'b', machine_no: 'SW10', status: 'closed', repair_type: 'Breakdown Maintenance', report_at: T(2, 1),
      accept_at: T(2, 2), repair_done_at: T(2, 12), vendor_sent_at: T(2, 3), vendor_back_at: T(2, 11), problem_group: 'ระบบลม' },
    { id: 'c', machine_no: 'SW10', status: 'assigned', repair_type: 'Preventive Maintenance', report_at: T(3, 1), problem_group: 'อื่นๆ' },
    { id: 'd', machine_no: 'SW10', status: 'rejected', repair_type: 'Reject MO', report_at: T(4, 1) },
  ];
  const s = summarizeMachineHistory(orders, { prsBy: { b: [{ order_id: 'b', pr_no: 'PR2610-0001', status: 'ordered' }] }, now: NOW });
  assert.equal(s.total, 3);
  assert.equal(s.rejected, 1);
  assert.equal(s.open, 1);
  assert.equal(s.bm, 2);
  assert.equal(s.vendor, 1);
  assert.equal(s.techMinN, 2);                     // ใบที่ยังไม่ซ่อมเสร็จไม่ถูกนับเป็น 0
  assert.equal(s.techMinAvg, (180 + 120) / 2);     // ใบ b: 10 ชม. − 8 ชม. อยู่กับ supplier = 2 ชม.
  assert.equal(s.costTotal, 500); assert.equal(s.costN, 1);   // ใบที่ไม่กรอกเงิน ไม่ใช่ 0 บาท
  assert.deepEqual(s.spellings.sort(), ['SW-10', 'SW10']);
  assert.equal(s.rows[0].o.id, 'd');               // ใหม่สุดก่อน
  assert.deepEqual(s.rows.find(r => r.o.id === 'b').prNos, ['PR2610-0001']);
  assert.equal(s.topProblems[0].k, 'ระบบลม');
  assert.equal(s.topProblems.at(-1).k, UNGROUPED_LABEL);   // "อื่นๆ" ห้ามขึ้นอันดับ 1
});

test('ป้ายปัญหา — กำกวม/ว่าง = ป้ายกลาง ไม่เดา', () => {
  assert.equal(problemLabelOf({ problem_group: 'ไฟฟ้า', problem_characteristic: 'เซนเซอร์' }), 'ไฟฟ้า · เซนเซอร์');
  assert.equal(problemLabelOf({ problem_group: '', problem_characteristic: 'เซนเซอร์' }), 'เซนเซอร์');
  assert.equal(problemLabelOf({}), UNGROUPED_LABEL);
});

test('ไม่มีใบเลย — ค่าเฉลี่ย/เงิน = null ไม่ใช่ 0', () => {
  const s = summarizeMachineHistory([], { now: NOW });
  assert.equal(s.total, 0); assert.equal(s.techMinAvg, null); assert.equal(s.costTotal, null); assert.equal(s.lastAt, null);
});
