import test from 'node:test';
import assert from 'node:assert/strict';
import { otHoursOfLog, otCostOf, otCostYearRows, otMultiplierOf, OT_HOURS } from '../otCost.js';

test('ชั่วโมง OT ต่อคน-วัน = กติกาเดียวกับใบ OT /checkin (เช้า 2 · เช้าขยาย 5 · ดึก 2 · วันหยุดตามใบจอง/8)', () => {
  assert.equal(otHoursOfLog({ has_ot: false }), 0);
  assert.equal(otHoursOfLog({ has_ot: true, shift: 'day' }), 2);
  assert.equal(otHoursOfLog({ has_ot: true, has_extended_ot: true, shift: 'day' }), 5);
  assert.equal(otHoursOfLog({ has_ot: true, shift: 'night' }), 2);
  assert.equal(otHoursOfLog({ has_ot: true, has_extended_ot: true, shift: 'night' }), 2);
  assert.equal(otHoursOfLog({ has_ot: true, shift: 'day' }, { holiday: true, bookingHours: 10 }), 10);
  assert.equal(otHoursOfLog({ has_ot: true, shift: 'day' }, { holiday: true }), OT_HOURS.holidayDefault);
});

test('ตัวคูณมาจากปฏิทินเท่านั้น — ไม่มาร์ค = วันทำงาน 1.5 · ot15 1.5 · ot2 2', () => {
  assert.equal(otMultiplierOf(null), 1.5);
  assert.equal(otMultiplierOf('working'), 1.5);
  assert.equal(otMultiplierOf('ot15'), 1.5);
  assert.equal(otMultiplierOf('ot2'), 2);
  assert.equal(otMultiplierOf('shutdown75'), 1.5);   // ไม่ใช่วันหยุดแบบ OT ⇒ อัตราวันทำงาน
});

test('otCostOf: 12 คน × 2 ชม. × 50 × 1.5 = 1,800 · วันหยุด ot2 ใช้ชม.จากใบจอง · ไม่มีใบจอง = 8 ชม. + นับเป็นเดา', () => {
  const logs = [
    ...Array.from({ length: 12 }, (_, i) => ({ work_date: '2026-11-03', employee_id: `e${i}`, shift: 'day', has_ot: true })),
    { work_date: '2026-11-03', employee_id: 'x', shift: 'day', has_ot: false },          // ไม่ OT = ไม่นับ
    { work_date: '2026-11-08', employee_id: 'h1', shift: 'day', has_ot: true },           // วันหยุด ot2 มีใบจอง 10 ชม.
    { work_date: '2026-11-08', employee_id: 'h2', shift: 'day', has_ot: true },           // วันหยุด ot2 ไม่มีใบจอง → 8 ชม.
  ];
  const cal = { '2026-11-08': 'ot2' };
  const r = otCostOf({ logs, rate: 50, dayTypeOf: d => cal[d] || null, bookingHoursOf: (e, d) => (e === 'h1' && d === '2026-11-08' ? 10 : null) });
  assert.equal(r.unknownRate, false);
  assert.equal(r.rows, 14);
  assert.equal(r.byDate['2026-11-03'].baht, 1800);
  assert.equal(r.byDate['2026-11-03'].mult, 1.5);
  assert.equal(r.byDate['2026-11-08'].baht, (10 + 8) * 50 * 2);
  assert.equal(r.holidayRows, 2);
  assert.equal(r.holidayGuess, 1);
  assert.equal(r.baht, 1800 + 1800);
  assert.equal(r.hours, 24 + 18);
});

test('ไม่รู้ค่าแรง = baht null (ห้าม 0) แต่ชั่วโมงยังนับ', () => {
  const r = otCostOf({ logs: [{ work_date: '2026-11-03', employee_id: 'a', shift: 'day', has_ot: true }], rate: null });
  assert.equal(r.baht, null); assert.equal(r.unknownRate, true); assert.equal(r.hours, 2);
  assert.equal(otCostOf({ logs: [], rate: 50 }).baht, 0);
});

test('โหมดปี: แถว RPC นับคน-วันแยกชนิด → บาทต่อเดือน · แถวรุ่นเก่า (ไม่มีฟิลด์ใหม่) = legacy', () => {
  const rows = [
    { m: '2026-01', ot: 5, ot_day: 3, ot_ext: 1, ot_night: 1, ot_hol15: 0, ot_hol2: 0 },   // (3×2 + 1×5 + 1×2) × 50 × 1.5 = 975
    { m: '2026-01', ot: 2, ot_day: 0, ot_ext: 0, ot_night: 0, ot_hol15: 1, ot_hol2: 1 },   // 8×50×1.5 + 8×50×2 = 600 + 800
    { m: '2026-02', ot: 4 },                                                               // RPC เก่า
  ];
  const y = otCostYearRows(rows, 50);
  assert.deepEqual(y.rows, [{ m: '2026-01', dt: 0, ng: 0, ot: 975 + 1400 }]);
  assert.equal(y.approx, true); assert.equal(y.legacy, true); assert.equal(y.unknownRate, false);
  assert.equal(otCostYearRows(rows, 0).unknownRate, true);
});
