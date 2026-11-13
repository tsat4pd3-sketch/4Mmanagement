/**
 * kpiAuto — KPI ช่างตามสูตรทางการ KPI Guideline 2026 หน้า 10 (2026-09-24)
 * ตัวเลขเทสถอดจากผล RPC จริง 24/09: jig 172 เครื่อง · ก.ย. events 421 · breakdown 5,025 นาที
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mtnAutoSeries, mtnGapSeries, mtnSegSeries, autoKpiOfName, toRowUnit, HOURS_PER_MONTH, autoUnitMismatch, autoDetailText } from '../kpiAuto.js';

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

test('หน่วยขัดสูตรทางการ — MBD/MO Closed ต้องเป็น % · MTBF/MTTR เป็นเวลา (ชม./นาที) · ไม่ตั้งหน่วย = ไม่เตือน', () => {
  assert.deepEqual(autoUnitMismatch('Machine Break Down', 'Hrs.'), { expect: '%', got: 'Hrs.' });   // เคสจริง 13/10
  assert.equal(autoUnitMismatch('Machine Break Down', '%'), null);
  assert.equal(autoUnitMismatch('MO Closed on target', 'ครั้ง')?.expect, '%');
  assert.equal(autoUnitMismatch('Mean Time To repair (MTTR)', 'Hr'), null);
  assert.equal(autoUnitMismatch('MTBF', 'นาที'), null);
  assert.equal(autoUnitMismatch('MTBF', '%')?.expect, 'ชม.');
  assert.equal(autoUnitMismatch('Machine Break Down', ''), null);
  assert.equal(autoUnitMismatch('OEE', 'Hrs.'), null);   // ไม่ใช่ KPI อัตโนมัติ
});

test('ข้อความที่มาของเลขรายเดือน — % ต้องมีชั่วโมง/ครั้ง/เครื่องกำกับ', () => {
  const m = { breakdown_hr: 175.38, events: 337, machines: 216, closed: 8, on_target: 2, no_target: 0 };
  assert.equal(autoDetailText(m, 'mbd'), 'หยุด 175.4 ชม. · 337 ครั้ง · 216 เครื่อง');
  assert.equal(autoDetailText(m, 'mttr'), 'หยุด 175.4 ชม. ÷ 337 ครั้ง');
  assert.equal(autoDetailText(m, 'mo_on_target'), 'ตรงเป้า 2/8 ใบ BM');
  assert.equal(autoDetailText(null, 'mbd'), '');
});

test('MO Closed on target นับเฉพาะ BM — จอบอกว่าไม่นับงานประเภทอื่นกี่ใบ (14/10)', () => {
  const roll = { mo: [{ m: '2026-09', team: 'maintenance', closed: 13, on_target: 4, no_target: 0, closed_all: 17 }], dt: [], machines: [], months: [] };
  const s = mtnAutoSeries(roll, 2026, { key: 'maintenance' }).months[8];
  assert.equal(s.closed_all, 17);
  assert.ok(Math.abs(s.mo_on_target - (4 / 13) * 100) < 1e-9);
  assert.match(autoDetailText(s, 'mo_on_target'), /ไม่นับงานประเภทอื่น 4 ใบ/);
  // RPC รุ่นเก่า (ไม่มี closed_all) = ไม่รู้ ห้ามเดา
  const old = mtnAutoSeries({ mo: [{ m: '2026-09', team: 'x', closed: 2, on_target: 1, no_target: 0 }] }, 2026, { key: 'x' }).months[8];
  assert.equal(old.closed_all, null);
});

/* ══ 🔎 MTBF ตัวที่ 2 + ชั่วโมงที่ชี้เจ้าของไม่ได้ (11/11 · คำสั่ง user
      "single source truth ต้องไม่มีค่าไหนหายไป แต่ต้องเคาะว่าจะไปอยู่ตรงไหน") ══ */

test('⏱️ 2 มุมมอง — MTBF ทางการ ÷ เครื่อง · ชม.เดินต่อการเสีย 1 ครั้ง ÷ ครั้งที่เสีย', () => {
  const { months } = mtnAutoSeries(roll, 2026, JIG);
  const sep = months.find(m => m.k === '2026-09');
  const avail = HOURS_PER_MONTH * 172;            // 125,560 ชม.
  const bdHr = 5025 / 60;                          // 83.75 ชม.
  assert.ok(Math.abs(sep.mtbf - (avail - bdHr) / 172) < 1e-9, 'ของทางการต้องไม่เปลี่ยน');
  assert.ok(Math.abs(sep.hr_per_fail - (avail - bdHr) / 421) < 1e-9);
  /* 🔴 ประเด็นทั้งหมดของตัวที่ 2: ของทางการเกาะ 730 จนแยกเดือนดี/แย่ไม่ออก */
  assert.ok(sep.mtbf > 729 && sep.mtbf < 730, `ทางการเกาะ 730 (ได้ ${sep.mtbf})`);
  assert.ok(sep.hr_per_fail < 400, `÷ครั้งที่เสีย ต้องเล็กกว่ามาก (ได้ ${sep.hr_per_fail})`);
  /* เดือนที่เสีย 2 เท่า ตัวทางการแทบไม่ขยับ แต่ตัวที่ 2 ต้องลดลงชัด */
  const aug = months.find(m => m.k === '2026-08');
  assert.ok(Math.abs(aug.mtbf - sep.mtbf) < 1, 'ทางการต่างกันไม่ถึง 1 ชม. ระหว่าง 2 เดือน');
  assert.ok(Math.abs(aug.hr_per_fail - sep.hr_per_fail) > 10, 'ตัวที่ 2 ต้องแยกเดือนออกจากกันได้');
});

test('🔴 เสีย 0 ครั้ง = ชม.เดินต่อการเสีย คำนวณไม่ได้ (null) ห้ามเป็น 0 หรือ Infinity', () => {
  const r = { ...roll, dt: [{ m: '2026-09', kind: 'jig', events: 0, breakdown_min: 0 }] };
  const sep = mtnAutoSeries(r, 2026, JIG).months.find(m => m.k === '2026-09');
  assert.equal(sep.hr_per_fail, null);
  assert.ok(Number.isFinite(sep.mtbf), 'ตัวทางการยังคำนวณได้ (= 730 เต็ม)');
  /* เดือนที่ไม่มีข้อมูล downtime เลย = null ทั้งคู่ */
  const jan = mtnAutoSeries(roll, 2026, JIG).months.find(m => m.k === '2026-01');
  assert.equal(jan.mtbf, null); assert.equal(jan.hr_per_fail, null);
});

test('🕳️ ชั่วโมงที่ชี้เจ้าของไม่ได้ — แยก 2 เหตุ (คนละทางแก้)', () => {
  const r = { ...roll,
    dt_gap: [
      { m: '2026-09', reason: 'no_machine_no', events: 281, mins: 6330 },
      { m: '2026-09', reason: 'not_in_master', events: 105, mins: 1456 },
      { m: '2026-10', reason: 'no_machine_no', events: 192, mins: 6716 },
    ],
    dt_gap_top: [{ machine_no: 'JIG-005', events: 65, mins: 540 }],
  };
  const g = mtnGapSeries(r, 2026);
  assert.equal(g.known, true);
  const sep = g.months.find(m => m.k === '2026-09');
  assert.equal(sep.noNo.events, 281);
  assert.ok(Math.abs(sep.noNo.hr - 105.5) < 0.01);
  assert.ok(Math.abs(sep.notMaster.hr - 1456 / 60) < 0.01);
  assert.ok(Math.abs(sep.hr - (6330 + 1456) / 60) < 0.01, 'ยอดเดือน = 2 เหตุรวมกัน');
  const oct = g.months.find(m => m.k === '2026-10');
  assert.equal(oct.notMaster.events, 0, 'เหตุที่ไม่มีในเดือนนั้น = 0 ไม่ใช่หาย');
  assert.equal(g.top[0].machineNo, 'JIG-005');
  assert.ok(Math.abs(g.top[0].hr - 9) < 0.01);
  assert.ok(Math.abs(g.totalHr - (6330 + 1456 + 6716) / 60) < 0.01);
});

test('🔴 RPC รุ่นเก่าไม่มี dt_gap = "ยังไม่รู้" (known:false) ห้ามคืน 0 ว่าไม่มีตกหล่น', () => {
  const g = mtnGapSeries(roll, 2026);
  assert.equal(g.known, false);
  assert.deepEqual(g.months, []);
  assert.equal(g.totalHr, 0, 'ยอดเป็น 0 ได้ แต่ known:false คือตัวบอกจอว่าห้ามเชื่อ');
  for (const bad of [null, undefined, {}, 'x']) {
    assert.equal(mtnGapSeries(bad, 2026).known, false);
  }
});

test('🔴 ชั่วโมงชี้เจ้าของไม่ได้ ห้ามปนเข้าค่าของทีมใดทีมหนึ่ง', () => {
  const r = { ...roll, dt_gap: [{ m: '2026-09', reason: 'no_machine_no', events: 281, mins: 6330 }] };
  const withGap = mtnAutoSeries(r, 2026, JIG).months.find(m => m.k === '2026-09');
  const noGap = mtnAutoSeries(roll, 2026, JIG).months.find(m => m.k === '2026-09');
  assert.equal(withGap.breakdown_hr, noGap.breakdown_hr, 'ค่าของทีมต้องไม่ขยับเพราะ dt_gap');
  assert.equal(withGap.mbd, noGap.mbd);
  assert.equal(withGap.mtbf, noGap.mtbf);
});

/* ══ 📊 แตกชั่วโมงไลน์หยุดเป็นช่วง (11/11 · user: "ให้เห็นว่าเลขตัวเดียวกัน ไม่มีตรงไหนหายไป") ══ */

const SEG_ROLL = {
  machines: [{ kind: 'machine', n: 259 }],
  months: ['2026-10'],
  mo: [],
  dt: [{ m: '2026-10', kind: 'machine', events: 1818, mo_events: 325, breakdown_min: 48606,
         mc_breakdown_min: 47610, seg_precall_min: 2436, seg_mtta_min: 4968,
         seg_ttr_min: 1362, seg_restart_min: 996, seg_unsplit_min: 38844 }],
};
const MACHINE = { key: 'maintenance', equip_type: 'machine' };

test('📊 ①+②+③+④+ยังแบ่งไม่ได้ ต้องเท่ากับไลน์หยุดเป๊ะ (ตัวพิสูจน์ว่าไม่มีอะไรหาย)', () => {
  const g = mtnSegSeries(SEG_ROLL, 2026, MACHINE);
  assert.equal(g.known, true);
  const sum = g.parts.reduce((s, p) => s + p.hr, 0) + g.unknownHr;
  assert.ok(Math.abs(sum - g.totalHr) < 1e-9, `บวกกลับ ${sum} ต้องเท่ากับ ${g.totalHr}`);
  assert.ok(Math.abs(g.totalHr - 810.1) < 0.1);
  assert.deepEqual(g.parts.map(p => p.key), ['precall', 'mtta', 'ttr', 'restart']);
  assert.ok(Math.abs(g.unknownHr - 647.4) < 0.2, 'ส่วนที่ยังแบ่งไม่ได้ต้องอยู่ครบ ห้ามหาย');
});

test('🔴 M/C Breakdown (ตามที่ user วาด) = ไลน์หยุด − คืนไลน์', () => {
  const g = mtnSegSeries(SEG_ROLL, 2026, MACHINE);
  const restart = g.parts.find(p => p.key === 'restart').hr;
  assert.ok(Math.abs(g.mcBreakdownHr - (g.totalHr - restart)) < 0.01);
  assert.ok(g.mcBreakdownHr < g.totalHr, 'ต้องน้อยกว่าไลน์หยุดเสมอ');
});

test('🔴 RPC รุ่นเก่าไม่มี seg_* = known:false ห้ามคืน 0 ว่าแบ่งไม่มีอะไรเลย', () => {
  const g = mtnSegSeries(roll, 2026, JIG);      // roll เดิมไม่มีฟิลด์ seg_*
  assert.equal(g.known, false);
  assert.deepEqual(g.parts, []);
  for (const bad of [null, undefined, {}, 'x']) assert.equal(mtnSegSeries(bad, 2026, JIG).known, false);
});

test('แยกตามชนิดอุปกรณ์ของทีม — ทีมอื่นต้องไม่ปนเข้ามา', () => {
  const two = { ...SEG_ROLL, dt: [...SEG_ROLL.dt,
    { m: '2026-10', kind: 'jig', events: 280, mo_events: 41, breakdown_min: 4254,
      mc_breakdown_min: 4224, seg_precall_min: 486, seg_mtta_min: 648, seg_ttr_min: 162,
      seg_restart_min: 30, seg_unsplit_min: 2922 }] };
  const m = mtnSegSeries(two, 2026, MACHINE);
  assert.ok(Math.abs(m.totalHr - 810.1) < 0.1, 'ของ jig ต้องไม่ถูกบวกเข้ามา');
  const j = mtnSegSeries(two, 2026, { key: 'jig_maintenance', equip_type: 'jig' });
  assert.ok(Math.abs(j.totalHr - 70.9) < 0.1);
});
