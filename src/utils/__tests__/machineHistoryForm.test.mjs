/* FM-MTN-005 ประวัติการซ่อมรายเครื่อง (20/10) — ช่องไหนใส่อะไร */
import test from 'node:test';
import assert from 'node:assert/strict';
import { machineHistoryRows, paginate, hhmm, splitDateTime } from '../machineHistoryForm.js';

const T = (d, h, m = 0) => new Date(Date.UTC(2026, 9, d, h - 7, m)).toISOString();   // เวลาไทย
const NOW = Date.UTC(2026, 9, 20, 0, 0);

test('แถวฟอร์ม — เรียงเก่าก่อน · ตัดใบตีกลับ · เวลาที่ใช้หักช่วงรอ + บอกในหมายเหตุ', () => {
  const orders = [
    { id: 'b', status: 'closed', report_at: T(3, 9), accept_at: T(3, 9, 10), repair_done_at: T(3, 13, 10), mttr_hold_from: T(3, 10, 10), mttr_hold_to: T(3, 12, 10),
      problem_group: 'ระบบลม', report_note: 'ลมรั่ว', root_cause: 'ซีลขาด', solution: 'เปลี่ยนซีล', mo_no: 'MTN-BM-1', repair_type: 'Breakdown Maintenance', assigned_techs: ['สมชาย', 'สมหญิง'] },
    { id: 'a', status: 'assigned', report_at: T(1, 8), accept_at: T(1, 8, 30), mo_no: 'MTN-BM-0' },
    { id: 'x', status: 'rejected', report_at: T(2, 8) },
  ];
  const rows = machineHistoryRows(orders, { partsBy: { b: [{ part_name: 'ซีล', qty: 2, unit: 'ชิ้น' }] }, now: NOW });
  assert.deepEqual(rows.map(r => r.id), ['a', 'b']);
  const b = rows[1];
  assert.equal(b.used, '2:00');                         // 4 ชม. − รออะไหล่ 2 ชม.
  assert.match(b.note, /หักรออะไหล่\/ภายนอก 2:00/);
  assert.equal(b.parts, 'ซีล ×2 ชิ้น');
  assert.equal(b.techs, 'สมชาย, สมหญิง');
  assert.equal(b.problem, 'ระบบลม — ลมรั่ว');
  assert.equal(b.rep.t, '09:00');
  assert.equal(rows[0].used, '');                       // ยังไม่ซ่อมเสร็จ = ว่าง ห้าม 0
  assert.match(rows[0].note, /ยังไม่ปิดใบ/);
});

test('แบ่งหน้า 15 แถว · ใบเปล่าได้ 1 หน้าว่าง', () => {
  assert.equal(paginate([]).length, 1);
  assert.equal(paginate(Array(16).fill({})).length, 2);
  assert.equal(paginate(Array(15).fill({})).length, 1);
});

test('รูปแบบเวลา', () => {
  assert.equal(hhmm(null), '');
  assert.equal(hhmm(125), '2:05');
  assert.deepEqual(splitDateTime(null), { d: '', t: '' });
});

test('ประเภทงานย่อ', async () => {
  const { repairTypeShort } = await import('../machineHistoryForm.js');
  assert.equal(repairTypeShort('Breakdown Maintenance'), 'BM');
  assert.equal(repairTypeShort('Reject MO'), 'RM');
  assert.equal(repairTypeShort('ซ่อมฉุกเฉิน'), 'ซ่อมฉุกเฉิน');
  assert.equal(repairTypeShort(null), '');
});
