/*
  เทสโหมดปีของจอ SQDCM (`src/utils/obeyaYear.js`) — 2026-09-22
  ล็อกไว้: ① เดือนว่าง = null ไม่ใช่ 0 (เดือนอนาคตห้ามเป็นแท่งแดง) ② แท่งสรุป/YTD ถ่วงน้ำหนัก ไม่ใช่ mean ของ 12 แท่ง
          ③ ช่วงเวลารับ today เสมอ (เทสระเบิดเวลา) ④ ต้นทุนคิดไม่ครบ = null พร้อมเหตุผล
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  yearRange, monthRange, prevMonthRange, monthKeys, monthLabel, SUMMARY_KEY,
  axisOeeYear, axisQualityYear, axisSafetyYear, axisManYear, axisDeliveryYear, axisCostYear, paretoYear, monthBarStatus,
} from '../obeyaYear.js';

test('ช่วงเวลา: ปีปัจจุบันตัดที่ today · ปีย้อนหลังทั้งปี · เดือน drill-down ตัดที่ today', () => {
  assert.deepEqual(yearRange(2026, '2026-09-22'), { from: '2026-01-01', to: '2026-09-22' });
  assert.deepEqual(yearRange(2025, '2026-09-22'), { from: '2025-01-01', to: '2025-12-31' });
  assert.deepEqual(monthRange('2026-09', '2026-09-22'), { from: '2026-09-01', to: '2026-09-22' });
  assert.deepEqual(monthRange('2026-02', '2026-09-22'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(prevMonthRange('2026-03', '2026-03-31'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(prevMonthRange('2026-01', '2026-01-15'), { from: '2025-12-01', to: '2025-12-15' });
  assert.equal(monthKeys(2026).length, 12);
  assert.equal(monthKeys(2026)[0], '2026-01');
  assert.equal(monthLabel('2026-04'), 'เม.ย.');
  assert.equal(monthLabel(SUMMARY_KEY), 'สรุป');
});

const SESS = [
  // ม.ค.: 2 กะ OEE 80 (wload 1000) · ก.พ.: 1 กะ OEE 60 (wload 3000) — mean ของแท่ง = 70 แต่ถ่วงน้ำหนัก = 65
  { m: '2026-01', line: 'L1', n: 2, wload: 1000, oee_w: 80000, a_wload: 1000, a_w: 90000, wrun: 900, p_w: 81000, wprod: 100, q_w: 9900, qty: 100, ng: 0 },
  { m: '2026-02', line: 'L1', n: 1, wload: 3000, oee_w: 180000, a_wload: 3000, a_w: 240000, wrun: 2400, p_w: 180000, wprod: 300, q_w: 29100, qty: 290, ng: 10 },
];

test('OEE ปี: 12 แท่ง + แท่งสรุป · เดือนว่าง = null · สรุป/YTD ถ่วงน้ำหนัก ไม่ใช่ mean', () => {
  const k = axisOeeYear({ rows: SESS, year: 2026 });
  assert.equal(k.series.length, 13);
  assert.equal(k.series[0].v, 80);
  assert.equal(k.series[1].v, 60);
  assert.equal(k.series[2].v, null);          // มี.ค. ยังไม่มีข้อมูล — ห้ามเป็น 0
  assert.equal(k.series[2].empty, true);
  const sum = k.series[12];
  assert.equal(sum.k, SUMMARY_KEY);
  assert.equal(sum.v, 65);                     // (80000+180000)/(1000+3000)
  assert.equal(k.value, 65);                   // YTD = ค่าเดียวกัน
  assert.equal(k.a, 82.5); assert.equal(k.p, 79.1); assert.equal(k.q, 97.5);
  assert.equal(k.shifts, 3); assert.equal(k.months, 2);
  assert.equal(monthBarStatus(k.series[2], k.target, 'up'), 'none');
});

test('OEE ปี: ไม่มีข้อมูลเลย = value null + state none (ไม่ใช่ 0)', () => {
  const k = axisOeeYear({ rows: [], year: 2026 });
  assert.equal(k.value, null); assert.equal(k.state, 'none');
  assert.equal(k.series.filter(p => p.v != null).length, 0);
});

test('Q ปี: ถ่วงด้วยจำนวนผลิต · แถว defect น้อย = thin พร้อมเหตุผล · ของเสียไม่รวมงานทดลอง', () => {
  const k = axisQualityYear({ rows: SESS, defects: [{ m: '2026-01', line: 'L1', mat: 'A', rows: 5, ng: 20, trial_ng: 5 }], year: 2026 });
  assert.equal(k.value, 97.5);                 // (9900+29100)/(100+300)
  assert.equal(k.state, 'thin');
  assert.match(k.note, /บันทึกไม่ครบ/);
  assert.equal(k.ngQty, 15);
});

test('S/M ปี: จากผลรวมเช็คชื่อ · S นับเฉพาะคนที่มา · M = มา ÷ ทั้งหมด', () => {
  const rows = [
    { m: '2026-01', line: 'L1', n: 10, present: 8, ppe_ok: 4, ot: 1 },
    { m: '2026-01', line: 'L2', n: 10, present: 2, ppe_ok: 1, ot: 0 },
  ];
  const s = axisSafetyYear({ rows, year: 2026 });
  assert.equal(s.series[0].v, 50);             // 5/10 ของคนที่มา
  assert.equal(s.state, 'thin');               // ยังไม่มีทะเบียนอุบัติเหตุ — ต้องเตือนเสมอ
  const m = axisManYear({ rows, year: 2026 });
  assert.equal(m.series[0].v, 50);             // 10/20
  assert.equal(m.present, 10); assert.equal(m.absent, 10); assert.equal(m.ot, 1);
  assert.equal(axisManYear({ rows: [], year: 2026 }).value, null);
});

test('D ปี: แผน = Σqty ทุกสถานะ · ทำได้นับตามสถานะ (กติกาเดียวกับโหมดเดือน)', () => {
  const rows = [
    { m: '2026-05', line: 'L1', status: 'confirmed', n: 2, qty: 100, qty_ok_fb: 90, qty_actual: 0 },
    { m: '2026-05', line: 'L1', status: 'carry_over', n: 1, qty: 50, qty_ok_fb: 50, qty_actual: 20 },
    { m: '2026-05', line: 'L1', status: 'open', n: 1, qty: 50, qty_ok_fb: 50, qty_actual: 0 },
  ];
  const d = axisDeliveryYear({ rows, year: 2026 });
  assert.equal(d.plan, 200); assert.equal(d.produced, 110); assert.equal(d.value, 55);
  assert.equal(d.series[4].v, 55);
  assert.equal(axisDeliveryYear({ rows: [], year: 2026 }).value, null);
});

test('C ปี: แท่งสรุป = ผลรวม · คิดไม่ครบ = null + บอกว่าขาดอะไร (ห้ามโชว์ 0)', () => {
  const c = axisCostYear({ rows: [{ m: '2026-01', dt: 1000, ng: 500 }, { m: '2026-02', dt: 200, ng: 0 }], year: 2026 });
  assert.equal(c.value, 1700);
  assert.equal(c.series[12].v, 1700); assert.equal(c.series[12].kind, 'sum');
  assert.equal(c.series[0].dt, 1000);
  const miss = axisCostYear({ rows: [], year: 2026, missingRate: 3 });
  assert.equal(miss.value, null); assert.equal(miss.state, 'thin'); assert.match(miss.note, /3 ไลน์/);
});

test('Pareto ปี: ตัดหยุดตามแผนออก · เรียงมาก→น้อย · top N', () => {
  const p = paretoYear([
    { m: '2026-01', type: 'พัก', category: 'planned', min: 999 },
    { m: '2026-01', type: 'Robot', category: 'unplanned', min: 30 },
    { m: '2026-02', type: 'Robot', category: 'unplanned', min: 40 },
    { m: '2026-02', type: 'รอวัตถุดิบ', category: 'unplanned', min: 50 },
  ], 1);
  assert.equal(p.total, 120);
  assert.deepEqual(p.rows, [{ name: 'Robot', min: 70 }]);
});
