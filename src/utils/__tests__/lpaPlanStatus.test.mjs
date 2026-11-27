import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lpaPlanCellStatus, lpaPeriodRange } from '../lpaPlanStatus.js';

const today = '2026-11-24';
const ranAll = () => true;

test('รอบของแต่ละชั้น: SV บล็อกสัปดาห์ (22+ ถึงสิ้นเดือน) · MGR เดือน · GM ไตรมาส', () => {
  assert.deepEqual(lpaPeriodRange('supervisor', '2026-11-03'), ['2026-11-01', '2026-11-07']);
  assert.deepEqual(lpaPeriodRange('supervisor', '2026-11-25'), ['2026-11-22', '2026-11-30']);
  assert.deepEqual(lpaPeriodRange('manager', '2026-02-10'), ['2026-02-01', '2026-02-28']);
  assert.deepEqual(lpaPeriodRange('gm', '2026-11-10'), ['2026-10-01', '2026-12-31']);
  assert.equal(lpaPeriodRange('leader', 'bad'), null);
});

test('P4: SV วางแผนวันจันทร์ ตรวจจริงวันพุธ (สัปดาห์เดียวกัน) = ● ไม่ใช่ ⊗', () => {
  const r = lpaPlanCellStatus({ layer: 'supervisor', dateStr: '2026-11-02', planned: true, today, ranOn: ranAll,
    audits: [{ layer: 'supervisor', audit_date: '2026-11-04', auditor_name: 'SV' }] });
  assert.equal(r.sym, '●');
});

test('SV ตรวจคนละสัปดาห์ = ยังไม่นับ → ⊗ เมื่อรอบจบ', () => {
  const r = lpaPlanCellStatus({ layer: 'supervisor', dateStr: '2026-11-02', planned: true, today, ranOn: ranAll,
    audits: [{ layer: 'supervisor', audit_date: '2026-11-09' }] });
  assert.equal(r.sym, '⊗');
});

test('รอบยังไม่จบ = ○ (MGR วางแผนวันที่ 10 แต่เดือนยังไม่จบ)', () => {
  const r = lpaPlanCellStatus({ layer: 'manager', dateStr: '2026-11-10', planned: true, today, ranOn: ranAll, audits: [] });
  assert.equal(r.sym, '○');
});

test('P5: Leader วันที่ไลน์ไม่เดิน = – ไม่ใช่ ⊗ · ไม่รู้ว่าเดินไหม = ?', () => {
  assert.equal(lpaPlanCellStatus({ layer: 'leader', dateStr: '2026-11-20', planned: true, today, ranOn: () => false }).sym, '–');
  assert.equal(lpaPlanCellStatus({ layer: 'leader', dateStr: '2026-11-20', planned: true, today, ranOn: () => null }).sym, '?');
  assert.equal(lpaPlanCellStatus({ layer: 'leader', dateStr: '2026-11-20', planned: true, today }).sym, '?');
  assert.equal(lpaPlanCellStatus({ layer: 'leader', dateStr: '2026-11-20', planned: true, today, ranOn: ranAll }).sym, '⊗');
});

test('อ่านผลตรวจไม่ได้ = ? ห้าม ⊗ · ไม่ได้วางแผน + ไม่มีใบ = ช่องว่าง', () => {
  assert.equal(lpaPlanCellStatus({ layer: 'leader', dateStr: '2026-11-20', planned: true, today, readErr: true, ranOn: ranAll }).sym, '?');
  assert.equal(lpaPlanCellStatus({ layer: 'leader', dateStr: '2026-11-20', planned: false, today, ranOn: ranAll }), null);
});

test('ตรวจวันที่ไม่ได้วางแผน = ยังขึ้น ● ที่วันนั้น (ของจริงเกิดแล้ว)', () => {
  const r = lpaPlanCellStatus({ layer: 'leader', dateStr: '2026-11-21', planned: false, today, audits: [{ layer: 'leader', audit_date: '2026-11-21' }] });
  assert.equal(r.sym, '●');
});

test('วันหยุดในรอบไม่นับว่าไลน์ต้องเดิน', () => {
  const r = lpaPlanCellStatus({ layer: 'supervisor', dateStr: '2026-11-02', planned: true, today,
    isOff: (ds) => ds !== '2026-11-03', ranOn: (ds) => ds === '2026-11-03' ? false : true });
  assert.equal(r.sym, '–');
});

import { lpaAutoFillQuarter } from '../lpaPlanStatus.js';
const wd = (n, skip = []) => Array.from({ length: n }, (_, i) => i + 1).filter(d => !skip.includes(d));

test('P3: เติมแผนวันที่ 24/11 — ต.ค. ทั้งเดือนและ 1-23 พ.ย. คงของเดิม · ไม่สร้างแผนในอดีต', () => {
  const r = lpaAutoFillQuarter({ today: '2026-11-24', stations: ['A', 'B', 'C'], months: [
    { mk: '2026-10', working: wd(31), existing: {} },
    { mk: '2026-11', working: wd(30), existing: { 3: { day: 3, station: 'X', plan_leader: true, plan_supervisor: true } } },
    { mk: '2026-12', working: wd(31), existing: {} },
  ] });
  assert.deepEqual(r.byMonth['2026-10'], {});
  const nov = r.byMonth['2026-11'];
  assert.equal(nov[3].station, 'X');                        // ของเดิมในอดีตไม่ถูกแตะ
  assert.ok(Object.keys(nov).map(Number).filter(d => d !== 3).every(d => d >= 24));
  assert.ok(nov[24].plan_leader);
  // บล็อก 22+ ยังไม่มี SV ⇒ วางที่วันแรกที่เหลือ · บล็อก 1-7 มีแล้วในอดีต ⇒ ไม่วางซ้ำ
  assert.equal(Object.values(nov).filter(x => x.plan_supervisor).length, 2);
  assert.ok(nov[24].plan_supervisor);
  // MGR วันที่แนะนำ (สัปดาห์ 2) ผ่านไปแล้ว ⇒ ย้ายไปวันทำงานถัดไปที่เหลือ ไม่ทิ้งเดือนนี้
  assert.equal(Object.values(nov).filter(x => x.plan_manager).length, 1);
  // GM รายไตรมาส = ครั้งเดียว
  const gm = Object.values(r.byMonth).flatMap(m => Object.values(m)).filter(x => x.plan_gm);
  assert.equal(gm.length, 1);
  // สถานีครบในวันที่เหลือของ พ.ย.
  const st = new Set(Object.values(nov).filter(x => x.day >= 24).flatMap(x => x.station.split(', ')));
  assert.deepEqual([...st].sort(), ['A', 'B', 'C']);
});

test('GM วางไว้แล้วในอดีต = ไม่วางซ้ำในไตรมาสเดียวกัน', () => {
  const r = lpaAutoFillQuarter({ today: '2026-11-24', stations: ['A'], months: [
    { mk: '2026-10', working: wd(31), existing: { 15: { day: 15, plan_gm: true } } },
    { mk: '2026-11', working: wd(30), existing: {} },
    { mk: '2026-12', working: wd(31), existing: {} },
  ] });
  assert.equal(Object.values(r.byMonth).flatMap(m => Object.values(m)).filter(x => x.plan_gm).length, 1);
});

test('ไตรมาสอนาคตทั้งก้อน = เติมเหมือนเดิม (ทุกวันทำงาน)', () => {
  const r = lpaAutoFillQuarter({ today: '2026-11-24', stations: ['A'], months: [
    { mk: '2027-01', working: wd(31, [1]), existing: {} }, { mk: '2027-02', working: wd(28), existing: {} }, { mk: '2027-03', working: wd(31), existing: {} },
  ] });
  assert.equal(Object.keys(r.byMonth['2027-01']).length, 30);
  assert.equal(r.keptDays, 0);
});

test('A7: ใบที่ยังไม่เซ็น = ◐ ไม่ใช่ ● · และไม่ใช่ ⊗', () => {
  const r = lpaPlanCellStatus({ layer: 'leader', dateStr: '2026-11-20', planned: true, today, ranOn: ranAll,
    audits: [{ layer: 'leader', audit_date: '2026-11-20', signed: false }] });
  assert.equal(r.sym, '◐');
  const r2 = lpaPlanCellStatus({ layer: 'leader', dateStr: '2026-11-20', planned: true, today, ranOn: ranAll,
    audits: [{ layer: 'leader', audit_date: '2026-11-20', signed: true }] });
  assert.equal(r2.sym, '●');
});
