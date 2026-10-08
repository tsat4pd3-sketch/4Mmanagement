// เทสจอ 3 ระดับ PM — src/utils/maintenanceLevels.js + resolvePlanDue (lib/pmSchedule.js)
// ⏱️ ตรึง todayStr/nowMs ทุกเคส (กฎ "เทสระเบิดเวลา" — npm test รันซ้ำด้วยนาฬิกา +400 วัน)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitWindows, workYmdOf, ratePer100h, predictiveOf, suggestCycleDays,
  preventiveOf, buildMaintenanceLevels, RULES,
} from '../maintenanceLevels.js';
import { resolvePlanDue, statusForDays } from '../../lib/pmSchedule.js';

const TODAY = '2026-09-23';
const NOW = Date.parse('2026-09-23T10:00:00+07:00');

test('workYmdOf: กะดึกหลังเที่ยงคืน (ก่อน 08:00 ไทย) เป็นของวันก่อน', () => {
  assert.equal(workYmdOf('2026-09-23T07:59:00+07:00'), '2026-09-22');
  assert.equal(workYmdOf('2026-09-23T08:00:00+07:00'), '2026-09-23');
  assert.equal(workYmdOf(null), null);
});

test('splitWindows: 30 วันล่าสุด / 60 วันก่อนหน้า · นอกช่วงทิ้ง', () => {
  const w = splitWindows({
    todayStr: TODAY,
    downtimes: [
      { started_at: '2026-09-23T09:00:00+07:00' },   // recent
      { started_at: '2026-08-25T09:00:00+07:00' },   // recent (วันแรกของช่วง)
      { started_at: '2026-08-24T09:00:00+07:00' },   // base
      { started_at: '2026-06-26T09:00:00+07:00' },   // base (วันแรก)
      { started_at: '2026-06-25T09:00:00+07:00' },   // นอกช่วง
    ],
    sessions: [{ work_date: '2026-09-01' }, { work_date: '2026-07-01' }, { work_date: '2026-09-24' }],
  });
  assert.equal(w.recentFrom, '2026-08-25');
  assert.equal(w.baseFrom, '2026-06-26');
  assert.equal(w.recent.downtimes.length, 2);
  assert.equal(w.base.downtimes.length, 2);
  assert.equal(w.recent.sessions.length, 1);   // 24/09 = อนาคต ไม่นับ
  assert.equal(w.base.sessions.length, 1);
});

test('ratePer100h: ไม่รู้ชั่วโมงเดิน = null ไม่ใช่ 0', () => {
  assert.equal(ratePer100h(3, 6000), 3);
  assert.equal(ratePer100h(0, 6000), 0);
  assert.equal(ratePer100h(3, 0), null);
  assert.equal(ratePer100h(3, null), null);
});

test('predictiveOf: แยก แย่ลง / เริ่มเสียใหม่ / ดีขึ้น / ไม่เสียเลย / ไม่รู้ชั่วโมงเดิน', () => {
  const rec = (stops, upMin, extra = {}) => ({ stops, upMin, opMin: upMin, mtbfMin: stops ? upMin / stops : null, mttrMin: 30, ...extra });
  assert.equal(predictiveOf(rec(6, 6000), rec(4, 12000), { nowMs: NOW }).trend, 'worse');   // 6 vs 2 ต่อ 100 ชม. = 3 เท่า
  assert.equal(predictiveOf(rec(3, 6000), rec(0, 12000), { nowMs: NOW }).trend, 'new');
  assert.equal(predictiveOf(rec(1, 6000), rec(8, 12000), { nowMs: NOW }).trend, 'better');
  assert.equal(predictiveOf(rec(0, 6000), rec(0, 12000), { nowMs: NOW }).trend, 'quiet');
  assert.equal(predictiveOf(null, rec(3, 12000), { nowMs: NOW }).trend, 'nodata');
  // 2 ครั้ง vs 0 = ยังน้อยเกินจะเรียกว่าแนวโน้ม (minStops 3)
  assert.equal(predictiveOf(rec(2, 6000), rec(0, 12000), { nowMs: NOW }).trend, 'stable');
});

test('predictiveOf: คาดเสียครั้งถัดไป = เสียล่าสุด + MTBF แปลงเป็นวันปฏิทิน', () => {
  // เดิน 30 วัน × 300 นาที/วัน = 9000 นาที · เสีย 3 ครั้ง ⇒ MTBF 3000 นาที = 10 วันปฏิทิน
  const lastAt = Date.parse('2026-09-20T10:00:00+07:00');
  const pd = predictiveOf({ stops: 3, upMin: 9000, opMin: 9000, mtbfMin: 3000, mttrMin: 40, lastAt }, null, { nowMs: NOW });
  assert.equal(Math.round(pd.mtbfDays), 10);
  assert.equal(pd.etaDays, 7);                    // 20/09 + 10 วัน = 30/09 → อีก 7 วัน
  // คาด 3 ครั้ง/30 วัน × MTTR 40 = 120 นาที
  assert.equal(pd.riskMin30, 120);
  // เสียครั้งเดียว = ไม่ทำนาย (ค่าเฉลี่ยจากครั้งเดียวไม่มีความหมาย)
  assert.equal(predictiveOf({ stops: 1, upMin: 9000, opMin: 9000, mtbfMin: 9000, lastAt }, null, { nowMs: NOW }).etaMs, null);
});

test('suggestCycleDays: ≤ครึ่ง MTBF · ไม่รู้ = null', () => {
  assert.equal(suggestCycleDays(100), 30);
  assert.equal(suggestCycleDays(29), 14);
  assert.equal(suggestCycleDays(5), 7);
  assert.equal(suggestCycleDays(null), null);
});

test('resolvePlanDue: next_due_date ชนะ · ไม่มี = ทำล่าสุด + รอบ · periodic ไม่มีรอบ', () => {
  assert.deepEqual(
    (({ dueYmd, status, hasCycle }) => ({ dueYmd, status, hasCycle }))(
      resolvePlanDue({ frequency: 'monthly', plan: { next_due_date: '2026-09-20' }, todayStr: TODAY })),
    { dueYmd: '2026-09-20', status: 'overdue', hasCycle: true });
  // ตรวจล่าสุด 20/09 22:00 ไทย (= 15:00 UTC) + 7 วัน = 27/09 → อีก 4 วัน = ok (หน้าต่าง due_soon 3 วัน)
  const r = resolvePlanDue({ frequency: 'weekly', lastInspectedAt: '2026-09-20T15:00:00Z', todayStr: TODAY });
  assert.equal(r.dueYmd, '2026-09-27');
  assert.equal(r.status, 'ok');
  assert.equal(resolvePlanDue({ frequency: 'weekly', todayStr: TODAY }).status, 'never');
  const p = resolvePlanDue({ frequency: 'periodic', plan: {}, todayStr: TODAY });
  assert.equal(p.status, 'periodic');
  assert.equal(p.hasCycle, false);
  // เลื่อนแผนที่ตกลงแล้ว
  const d = resolvePlanDue({ frequency: 'monthly', plan: { next_due_date: '2026-09-01', deferred_to: '2026-09-30', deferred_at: '2026-09-10' }, todayStr: TODAY });
  assert.equal(d.status, 'deferred');
  assert.equal(d.dueYmd, '2026-09-30');
  assert.equal(statusForDays(0, 'daily'), 'due_soon');
});

test('preventiveOf: หลายใบตรวจ → เอาสถานะที่แย่สุด · ไม่มีแผน = none', () => {
  assert.equal(preventiveOf([]).status, 'none');
  const pv = preventiveOf([
    { status: 'ok', dueYmd: '2026-10-10', daysTo: 17, hasCycle: true },
    { status: 'overdue', dueYmd: '2026-09-01', daysTo: -22, hasCycle: true },
  ]);
  assert.equal(pv.status, 'overdue');
  assert.equal(pv.dueYmd, '2026-09-01');
});

const ruleKeys = (ctx) => RULES.filter(r => r.when(ctx)).map(r => r.key);
const baseT = { minStops: 3, worseRatio: 1.5, betterRatio: 0.5, repeatShare: 0.5, waitShare: 0.5, soonDays: 7, quietMinRunH: 40 };

test('RULES: เสียบ่อยแต่ไม่มีรอบ PM → ตั้งแผน · อาการซ้ำ → หาต้นเหตุ', () => {
  const pv = preventiveOf([{ status: 'periodic', hasCycle: false, dueYmd: null }]);
  const pd = { stopsR: 5, stopsB: 1, trend: 'worse', topCause: 'เซ็นเซอร์', topCauseN: 4, mtbfDays: 6, etaMs: null };
  const keys = ruleKeys({ pv, pd, todayStr: TODAY, t: baseT });
  assert.ok(keys.includes('need_cycle'));
  assert.ok(keys.includes('root_cause'));
  assert.ok(!keys.includes('pm_overdue'));
});

test('RULES: คาดเสียก่อนถึงรอบ PM → ดึง PM ขึ้นมา · ไม่เสียเลยแต่เดินจริง → ยืดรอบ', () => {
  const pv = { hasPlan: true, hasCycle: true, status: 'ok', dueYmd: '2026-10-20', daysTo: 27 };
  const pd = { stopsR: 4, stopsB: 1, trend: 'worse', etaMs: Date.parse('2026-09-28T10:00:00+07:00'), etaDays: 5 };
  const a = RULES.find(r => r.key === 'pull_in');
  assert.ok(a.when({ pv, pd, todayStr: TODAY, t: baseT }));
  assert.equal(a.make({ pv, pd, todayStr: TODAY }).byYmd, '2026-09-28');
  // PM มาก่อนวันคาดเสีย = ไม่ต้องดึง
  assert.ok(!a.when({ pv: { ...pv, dueYmd: '2026-09-25' }, pd, todayStr: TODAY, t: baseT }));

  const quiet = { stopsR: 0, stopsB: 0, trend: 'quiet', upHoursR: 30, upHoursB: 60 };
  assert.ok(ruleKeys({ pv, pd: quiet, todayStr: TODAY, t: baseT }).includes('extend_cycle'));
  // เดินแค่ 10 ชม. = แค่ไม่ได้ใช้ ไม่ใช่ทนทาน
  assert.ok(!ruleKeys({ pv, pd: { ...quiet, upHoursR: 4, upHoursB: 6 }, todayStr: TODAY, t: baseT }).includes('extend_cycle'));
});

test('buildMaintenanceLevels: ผูก checklist → เครื่องในทะเบียน + downtime จริง แล้วออกคำแนะนำ', () => {
  const machines = [
    { id: 'm1', machine_no: 'SP-78', machine_name: 'Press 78', equipment_kind: 'machine', line_name: 'L1', is_active: true },
    { id: 'm2', machine_no: 'SP-79', machine_name: 'Press 79', equipment_kind: 'machine', line_name: 'L1', is_active: true },
  ];
  // เดิน 1 กะ/วัน 600 นาที ทุกวันตลอด 90 วัน
  const sessions = [];
  for (let i = 0; i < 90; i++) {
    const d = new Date(Date.UTC(2026, 8, 23) - i * 86400000).toISOString().slice(0, 10);
    sessions.push({ id: `s${i}`, line_name: 'L1', work_date: d, shift: 'day', shift_min: 600, start_time: '08:00' });
  }
  const brk = { category: 'unplanned', name_th: 'เครื่องเสีย' };
  const dt = (no, iso) => ({ machine_no: no, started_at: iso, ended_at: new Date(Date.parse(iso) + 30 * 60000).toISOString(), duration_min: 30, dr_downtime_types: brk });
  const downtimes = [
    dt('SP78', '2026-09-05T10:00:00+07:00'), dt('SP-78', '2026-09-12T10:00:00+07:00'),
    dt('SP-78', '2026-09-18T10:00:00+07:00'), dt('SP-78', '2026-09-21T10:00:00+07:00'),
    dt('SP-78', '2026-07-10T10:00:00+07:00'),
  ];
  const out = buildMaintenanceLevels({
    checklists: [{ id: 'c1', equipment_id: 'j1', frequency: 'periodic', name: 'PM SP-78' }],
    jigs: [{ id: 'j1', name: 'SP-78', machine_id: 'm1', machine_no: 'SP-78', line_name: 'L1', equipment_type: 'machine' }],
    plans: [{ checklist_id: 'c1', plan_type: 'time', is_active: true }],
    machines, downtimes, sessions, todayStr: TODAY, nowMs: NOW,
  });
  const sp78 = out.items.find(i => i.machineNo === 'SP-78');
  assert.ok(sp78, 'SP-78 ต้องขึ้นรายการ');
  assert.equal(sp78.pd.stopsR, 4);                 // "SP78" กับ "SP-78" = เครื่องเดียวกัน
  assert.equal(sp78.pd.stopsB, 1);
  assert.equal(sp78.pd.trend, 'worse');            // 4/300h vs 1/600h = 8 เท่า
  assert.equal(sp78.pv.hasCycle, false);
  assert.ok(sp78.actions.some(a => a.rule === 'need_cycle'));
  // SP-79 ไม่มีแผน + ไม่เคยเสีย = ไม่ขึ้นรายการ (ไม่มีอะไรจะบอก)
  assert.ok(!out.items.some(i => i.machineNo === 'SP-79'));
  assert.equal(out.summary.preventive.failingNoPlan, 1);
  assert.equal(out.summary.prescriptive.total, out.actions.length);
});

/* ── รอบ PM = จำนวนวัน (2026-09-23 · "ตั้งแผน PM ไม่ได้ว่าครั้งถัดไปจะ PM เมื่อไหร่") ── */
import { cycleDaysOf, cycleLabel, freqForCycle, dueStatus } from '../../lib/pmSchedule.js';

test('รอบ PM: interval_days ชนะ frequency · periodic ไม่มี interval = ไม่มีรอบ', () => {
  assert.equal(cycleDaysOf('periodic', 180), 180);
  assert.equal(cycleDaysOf('monthly', null), 30);
  assert.equal(cycleDaysOf('periodic', null), null);
  assert.equal(cycleLabel('periodic', 365), 'รายปี');
  assert.equal(cycleLabel('periodic', 45), 'ทุก 45 วัน');
  assert.equal(cycleLabel('periodic', null), 'ไม่มีรอบ');
  // รอบนอก 4 ค่ามาตรฐาน → 'periodic' (check constraint ของ checklists.frequency ไม่ต้องแก้)
  assert.equal(freqForCycle(30), 'monthly');
  assert.equal(freqForCycle(180), 'periodic');
  assert.equal(freqForCycle(null), 'periodic');
});

test('รอบ PM: periodic + interval 180 คิดวันครบได้ · มีรอบแต่ไม่เคยตรวจ = never ไม่ใช่ periodic', () => {
  const r = resolvePlanDue({ frequency: 'periodic', plan: { interval_days: 180, last_done_at: '2026-04-01T03:00:00Z' }, todayStr: TODAY });
  assert.equal(r.dueYmd, '2026-09-28');
  assert.equal(r.hasCycle, true);
  assert.equal(resolvePlanDue({ frequency: 'periodic', plan: { interval_days: 180 }, todayStr: TODAY }).status, 'never');
  // วันที่ช่างกำหนดเอง (next_due_date) ใช้ได้แม้ยังไม่เคยตรวจ
  assert.equal(resolvePlanDue({ frequency: 'periodic', plan: { interval_days: 180, next_due_date: '2026-10-15' }, todayStr: TODAY }).status, 'ok');
  assert.equal(dueStatus(null, 'periodic', 180), 'never');
  assert.equal(dueStatus(null, 'periodic', null), 'periodic');
});
