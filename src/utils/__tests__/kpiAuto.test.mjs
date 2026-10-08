/**
 * kpiAuto — KPI ช่างตามสูตรทางการ KPI Guideline 2026 หน้า 10 (2026-09-24)
 * ตัวเลขเทสถอดจากผล RPC จริง 24/09: jig 172 เครื่อง · ก.ย. events 421 · breakdown 5,025 นาที
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mtnAutoSeries, autoKpiOfName, toRowUnit, HOURS_PER_MONTH } from '../kpiAuto.js';

const roll = {
  machines: [{ kind: 'die', n: 266 }, { kind: 'jig', n: 172 }, { kind: 'machine', n: 216 }, { kind: 'facility', n: 38 }],
  months: ['2026-06', '2026-07', '2026-08', '2026-09'],
  mo: [
    { m: '2026-09', team: 'jig_maintenance', closed: 4, on_target: 0, no_target: 1 },
    { m: '2026-09', team: 'maintenance', closed: 17, on_target: 1, no_target: 1 },
    { m: '2026-07', team: 'maintenance', closed: 1, on_target: 1, no_target: 0 },
  ],
  dt: [
    { m: '2026-09', kind: 'jig', events: 421, breakdown_min: 5025 },
    { m: '2026-09', kind: 'machine', events: 50, breakdown_min: 600 },
    { m: '2026-08', kind: 'jig', events: 255, breakdown_min: 2704 },
  ],
};
const JIG = { key: 'jig_maintenance', equip_type: 'jig' };

test('สูตรตรงเอกสารหน้า 10 — JIG MTN ก.ย. 2026', () => {
  const { months, machines } = mtnAutoSeries(roll, 2026, JIG);
  assert.equal(machines, 172);
  const s = months.find(x => x.k === '2026-09');
  assert.equal(s.mo_on_target, 0);                               // 0 ตรงเป้า จาก 4 ใบ
  assert.equal(s.no_target, 1);                                  // ใบไม่ตั้งกำหนดต้องถูกบอก
  const bdHr = 5025 / 60;
  assert.ok(Math.abs(s.mtbf - ((HOURS_PER_MONTH * 172 - bdHr) / 172)) < 1e-9);   // [(730×n) − เสียรวม] / n
  assert.ok(Math.abs(s.mttr - (bdHr / 421)) < 1e-9);                             // ชม.เสียรวม / ครั้ง
  assert.ok(Math.abs(s.mbd - ((bdHr / (HOURS_PER_MONTH * 172)) * 100)) < 1e-9);  // ฐาน 730×n (ข้อสมมติที่เขียนไว้)
  assert.ok(s.mtbf > 729 && s.mtbf < 730, 'MTBF ใกล้ 730 เมื่อเสียรวมน้อยเทียบกับจำนวนเครื่อง');
});

test('เดือนไม่มีข้อมูล downtime เลย = null ทุกตัว (ไม่ใช่ 0 · ไม่ใช่ 730)', () => {
  const { months } = mtnAutoSeries(roll, 2026, JIG);
  const jan = months.find(x => x.k === '2026-01');
  assert.equal(jan.mtbf, null); assert.equal(jan.mbd, null); assert.equal(jan.mttr, null); assert.equal(jan.mo_on_target, null);
  assert.equal(jan.hasData, false);
});

test('เดือนที่โรงงานมี downtime แต่ชนิดนี้ไม่เสียเลย = MBD 0% · MTBF เต็ม 730 · MTTR null (ไม่มีครั้งให้หาร)', () => {
  const { months } = mtnAutoSeries(roll, 2026, JIG);
  const jul = months.find(x => x.k === '2026-07');   // มีในเดือน months แต่ไม่มีแถว dt ของ jig
  assert.equal(jul.mbd, 0);
  assert.equal(jul.mtbf, HOURS_PER_MONTH);
  assert.equal(jul.mttr, null);
});

test('ทีมกรองด้วย mtn_dept · ชนิดอุปกรณ์กรองด้วย equipment_kind — ไม่ปนกัน', () => {
  const mtn = mtnAutoSeries(roll, 2026, { key: 'maintenance', equip_type: 'machine' });
  const s = mtn.months.find(x => x.k === '2026-09');
  assert.equal(mtn.machines, 216);
  assert.ok(Math.abs(s.mo_on_target - (1 / 17) * 100) < 1e-9);
  assert.equal(s.events, 50);
});

test('ไม่ระบุทีม/ชนิด = ทั้งโรงงาน', () => {
  const all = mtnAutoSeries(roll, 2026, null);
  assert.equal(all.machines, 692);
  assert.equal(all.months.find(x => x.k === '2026-09').closed, 21);
});

test('จับคู่ชื่อแถวนิยามกับ KPI อัตโนมัติ (สะกดตามทะเบียนกลุ่ม + ที่ seed ไว้)', () => {
  assert.equal(autoKpiOfName('MO Closed on target').key, 'mo_on_target');
  assert.equal(autoKpiOfName('Machine Break Down').key, 'mbd');
  assert.equal(autoKpiOfName('Mean Time Between Failure (MTBF)').key, 'mtbf');
  assert.equal(autoKpiOfName('Mean Time To Repair (MTTR)').key, 'mttr');
  assert.equal(autoKpiOfName('Direct Labour & Overhead Expenses'), null);
  assert.equal(autoKpiOfName('Cost Reduction (JIG MTN)'), null);
});

test('หน่วยของแถว: MTBF/MTTR เป็น "นาที" ⇒ คูณ 60 · % ไม่แปลง', () => {
  assert.equal(toRowUnit(2, 'mtbf', 'นาที'), 120);
  assert.equal(toRowUnit(2, 'mttr', 'min'), 120);
  assert.equal(toRowUnit(2, 'mtbf', 'ชม.'), 2);
  assert.equal(toRowUnit(2, 'mbd', 'นาที'), 2);
  assert.equal(toRowUnit(null, 'mtbf', 'นาที'), null);
});
