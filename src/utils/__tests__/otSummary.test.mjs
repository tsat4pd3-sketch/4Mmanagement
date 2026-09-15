import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKindOf, daysOfMonth, prevMonthKey, summarizeOtMonth, reasonText,
  otCoverage, projectTotal, monthDayStats, dowOf,
} from '../otSummary.js';

/* ปฏิทินทดสอบ = ส.ค. 2026 ของจริง (ค่าจาก company_calendar ฝั่ง Main)
   1 ส.ค. = เสาร์ · วันที่ตรึงไว้ทั้งหมด ห้ามอิงเวลาปัจจุบัน (กฎกันเทสระเบิดเวลา) */
const CAL = new Map(Object.entries({
  '2026-08-01': 'shutdown75',  // เสาร์ — ม.75
  '2026-08-02': 'ot15',
  '2026-08-08': 'ot2',
  '2026-08-15': 'working',     // เสาร์ที่ถูกเรียกมาทำงานปกติ
  '2026-08-16': 'ot15',
}));

test('dowOf: อ่านวันในสัปดาห์แบบ local ไม่เพี้ยนจาก UTC', () => {
  assert.equal(dowOf('2026-08-01'), 6); // เสาร์
  assert.equal(dowOf('2026-08-03'), 1); // จันทร์
  assert.equal(dowOf(''), null);
});

test('dayKindOf: มาร์คในปฏิทินชนะเสมอ · ไม่มาร์ค จ-ศ = ทำงาน · ไม่มาร์ค ส-อา = หยุด', () => {
  assert.deepEqual(dayKindOf('2026-08-03', CAL), { type: 'working', holiday: false, marked: false });
  assert.deepEqual(dayKindOf('2026-08-02', CAL), { type: 'ot15', holiday: true, marked: true });
  // เสาร์ที่ถูกมาร์คเป็นวันทำงาน = วันทำงาน (ห้ามตัดสินจากวันในสัปดาห์)
  assert.deepEqual(dayKindOf('2026-08-15', CAL), { type: 'working', holiday: false, marked: true });
  // เสาร์ที่ไม่มีแถวในปฏิทินเลย = หยุด (กติกาเดียวกับ countWorkingDaysInMonth)
  assert.deepEqual(dayKindOf('2026-08-22', CAL), { type: 'weekend', holiday: true, marked: false });
  // ม.75 = โรงงานหยุด แต่แยกชนิดไว้ (จ่าย 75% / ถูกเรียกมา = ค่าแรงปกติ ไม่ใช่ OT วันหยุด)
  assert.equal(dayKindOf('2026-08-01', CAL).type, 'shutdown75');
});

test('daysOfMonth / prevMonthKey', () => {
  assert.equal(daysOfMonth('2026-08').length, 31);
  assert.equal(daysOfMonth('2026-02').length, 28);
  assert.equal(daysOfMonth('2028-02').length, 29);
  assert.equal(daysOfMonth('')[0], undefined);
  assert.equal(prevMonthKey('2026-09'), '2026-08');
  assert.equal(prevMonthKey('2026-01'), '2025-12');
});

const TASKS = new Map([['t1', 'ผลิตงาน Line-60'], ['t2', 'PM FIXTURE'], ['t3', 'support line']]);

test('summarizeOtMonth: นับวัน ไม่ใช่นับแถว · แยกวันทำงาน/วันหยุด/ม.75', () => {
  const logs = [
    { work_date: '2026-08-03', employee_id: 'A', has_ot: true },
    { work_date: '2026-08-04', employee_id: 'A', has_ot: true },
    { work_date: '2026-08-04', employee_id: 'A', has_ot: true },  // แถวซ้ำวันเดิม = ยังนับ 1 วัน
    { work_date: '2026-08-05', employee_id: 'A', has_ot: false }, // ไม่ได้ทำ OT
    { work_date: '2026-08-02', employee_id: 'A', has_ot: true },  // วันหยุด ot15
    { work_date: '2026-08-01', employee_id: 'A', has_ot: true },  // ม.75
    { work_date: '2026-07-31', employee_id: 'A', has_ot: true },  // นอกเดือน = ไม่นับ
    { work_date: '2026-08-03', employee_id: 'B', has_ot: true },
  ];
  const rows = summarizeOtMonth({ monthKey: '2026-08', logs, bookings: [], taskNameById: TASKS, dayTypeMap: CAL });
  const a = rows.find(r => r.employeeId === 'A');
  assert.equal(a.total, 4);
  assert.equal(a.working, 2);
  assert.equal(a.holiday, 1);
  assert.equal(a.shutdown, 1);
  assert.equal(a.bookingOnly, 0);
  assert.equal(rows[0].employeeId, 'A'); // เรียงมากไปน้อย
  assert.equal(rows.find(r => r.employeeId === 'B').total, 1);
});

test('summarizeOtMonth: ใบจองที่ไม่มีเช็คชื่อ นับได้ (วันหยุดมักไม่มีคนเช็คชื่อ) และปิดได้', () => {
  const logs = [{ work_date: '2026-08-03', employee_id: 'A', has_ot: true }];
  const bookings = [
    { work_date: '2026-08-03', employee_id: 'A', task_type_id: 't1' },
    { work_date: '2026-08-08', employee_id: 'A', task_type_id: 't2' }, // วันหยุด ot2 ไม่มี log
  ];
  const on = summarizeOtMonth({ monthKey: '2026-08', logs, bookings, taskNameById: TASKS, dayTypeMap: CAL })[0];
  assert.equal(on.total, 2);
  assert.equal(on.holiday, 1);
  assert.equal(on.bookingOnly, 1);

  const off = summarizeOtMonth({ monthKey: '2026-08', logs, bookings, taskNameById: TASKS, dayTypeMap: CAL, countBookingOnly: false })[0];
  assert.equal(off.total, 1);
  assert.equal(off.bookingOnly, 0);
  // ปิดการนับใบจองลอย แต่ "เหตุผล" ของวันที่มีเช็คชื่อต้องยังอยู่
  assert.deepEqual(off.reasons, [{ name: 'ผลิตงาน Line-60', n: 1 }]);
});

test('summarizeOtMonth: เหตุผลรวมตามงานที่จอง เรียงมากไปน้อย · includeEmployee กรองขอบเขต', () => {
  const bookings = [
    { work_date: '2026-08-03', employee_id: 'A', task_type_id: 't1' },
    { work_date: '2026-08-04', employee_id: 'A', task_type_id: 't1' },
    { work_date: '2026-08-05', employee_id: 'A', task_type_id: 't2' },
    { work_date: '2026-08-06', employee_id: 'A', task_type_id: null }, // ไม่ระบุงาน = ไม่เดาให้
    { work_date: '2026-08-03', employee_id: 'Z', task_type_id: 't3' },
  ];
  const rows = summarizeOtMonth({
    monthKey: '2026-08', logs: [], bookings, taskNameById: TASKS, dayTypeMap: CAL,
    includeEmployee: (id) => id !== 'Z',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total, 4);
  assert.deepEqual(rows[0].reasons, [
    { name: 'ผลิตงาน Line-60', n: 2 },
    { name: 'PM FIXTURE', n: 1 },
  ]);
  assert.equal(rows[0].reasonText, 'ผลิตงาน Line-60 (2 วัน) · PM FIXTURE (1 วัน)');
});

test('reasonText: เกิน 3 อันดับ รวมเป็น "อื่นๆ" · ไม่มีข้อมูล = ว่าง (ห้ามเดาเหตุผล)', () => {
  assert.equal(reasonText([]), '');
  assert.equal(
    reasonText([{ name: 'a', n: 4 }, { name: 'b', n: 3 }, { name: 'c', n: 2 }, { name: 'd', n: 1 }, { name: 'e', n: 1 }]),
    'a (4 วัน) · b (3 วัน) · c (2 วัน) · อื่นๆ 2 วัน',
  );
});

test('otCoverage: บอกวันที่ไม่มีเช็คชื่อเลย และแยกว่าเป็นวันหยุดกี่วัน', () => {
  const logs = [
    { work_date: '2026-08-03', employee_id: 'A' },
    { work_date: '2026-08-04', employee_id: 'A' },
  ];
  const bookings = [{ work_date: '2026-08-08', employee_id: 'A' }];
  const cov = otCoverage({ monthKey: '2026-08', logs, bookings, dayTypeMap: CAL, today: '2026-08-08' });
  assert.equal(cov.days, 8);
  assert.equal(cov.loggedDays, 2);
  assert.equal(cov.missingDays.length, 6);
  // 1(ม.75) 2(ot15) 8(ot2) = 3 วันหยุดที่ไม่มีข้อมูล
  assert.equal(cov.missingHolidayDays, 3);
  assert.equal(cov.missingWorkingDays, 3);
  assert.equal(cov.missingDays.find(d => d.date === '2026-08-08').hasBooking, true);
});

test('projectTotal: ปัดขึ้น · เดือนจบแล้วคืนค่าจริงไม่ปรุงแต่ง', () => {
  assert.equal(projectTotal(10, 15, 30), 20);
  assert.equal(projectTotal(7, 15, 30), 14);
  assert.equal(projectTotal(5, 11, 30), 14);   // 13.6 → ปัดขึ้น
  assert.equal(projectTotal(21, 31, 31), 21);
  assert.equal(projectTotal(3, 0, 30), 3);
});

test('monthDayStats: นับวันทำงาน/วันหยุดตามปฏิทิน (ตรวจกับ ส.ค. 2026 จริง)', () => {
  const s = monthDayStats('2026-08', CAL);
  assert.equal(s.days, 31);
  // ส.ค.2026: เสาร์-อาทิตย์ 10 วัน แต่ 15 (เสาร์) มาร์ค working → หยุด 9 + 12(ot2, พุธ) = ... นับจริง:
  // หยุด = 1,2,8,9,16,22,23,29,30 (9 วัน) → 15 ถูกมาร์ค working จึงเป็นวันทำงาน
  assert.equal(s.holiday, 9);
  assert.equal(s.working, 22);
  assert.equal(s.working + s.holiday, 31);
  const upto = monthDayStats('2026-08', CAL, '2026-08-10');
  assert.equal(upto.days, 10);
});
