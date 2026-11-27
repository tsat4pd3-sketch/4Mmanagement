import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthOf, passOf, marksOf, summarize, ranking, auditorStats, planStatus, derive } from '../dash.js';

test('เดือนของใบตรวจ = เวลาไทย (31 ม.ค. 20:00 UTC = 1 ก.พ. ไทย)', () => {
  assert.equal(monthOf('2026-01-31T20:00:00Z'), 2);
  assert.equal(monthOf('2026-01-31T10:00:00Z'), 1);
  assert.equal(monthOf('ไม่ใช่วันที่'), 0);
});

test('เกณฑ์ผ่าน: รายที่ > รายปี > ค่ากลาง > 80', () => {
  const p = passOf([{ setting_key: 'pass_self:2026', setting_value: '85' }, { setting_key: 'pass_self:2026:office', setting_value: '70' }], 2026);
  assert.equal(p.factory.self, 85);
  assert.equal(p.office.self, 70);
  assert.equal(p.committee, 80);
  assert.deepEqual(marksOf(p, 'self', ''), [{ place: 'factory', value: 85 }, { place: 'office', value: 70 }]);
  assert.deepEqual(marksOf(p, 'committee', ''), [{ value: 80 }]);
});

const areas = [
  { act_area: 'a1', area_code: 'A01', area_type: 'factory', act_area_name: 'HDF' },
  { act_area: 'a2', area_code: 'B01', area_type: 'office', act_area_name: 'HR' },
];
const audits = [
  { act_audit: 'x1', act_area: 'a1', audit_type: 'SELF', status: 'COMPLETED', audited_at: '2026-03-05T03:00:00Z', percent_score: 80, auditors: [] },
  { act_audit: 'x2', act_area: 'a1', audit_type: 'COMMITTEE', status: 'COMPLETED', audited_at: '2026-03-10T03:00:00Z', percent_score: 90, auditors: ['1000001'] },
  { act_audit: 'x3', act_area: 'a2', audit_type: 'SELF', status: 'DRAFT', audited_at: '2026-03-10T03:00:00Z', percent_score: 10, auditors: [] },
];
const groups = [
  { act_audit: 'x1', s_group: '1S', percent: 70 },
  { act_audit: 'x2', s_group: '1S', percent: 90 },
];

test('ภาพรวม: ใบ DRAFT ไม่นับ · เดือนไม่มีใบ = null ไม่ใช่ 0', () => {
  const s = summarize({ areas, audits, groups });
  assert.equal(s.count, 2);
  assert.equal(s.groups[0].percent, 80);
  assert.equal(s.groups[1].percent, null);
  assert.deepEqual(s.self[2], { month: 3, percent: 80, audits: 1 });
  assert.deepEqual(s.self[0], { month: 1, percent: null, audits: 0 });
  assert.equal(summarize({ areas, audits, groups, type: 'COMMITTEE' }).groups[0].percent, 90);
  assert.equal(summarize({ areas, audits, groups, areaType: 'office' }).count, 0);
});

test('อันดับ: เฉพาะพื้นที่ที่มีใบ · สะสมถึงเดือนที่เลือก', () => {
  const r = ranking({ areas, audits, groups, upTo: 3 });
  assert.equal(r.factory.length, 1);
  assert.equal(r.factory[0].groups[0], 80);
  assert.equal(r.office.length, 0);
  assert.equal(ranking({ areas, audits, groups, upTo: 2 }).factory.length, 0);
});

test('ผู้ตรวจ: แผนของทีม เทียบใบ Committee ที่มีชื่อ', () => {
  const team = [
    { employee_code: '1000001', employee_name: 'ก', role: 'auditor', team: 'A', status: 'Active' },
    { employee_code: '1000002', employee_name: 'ข', role: 'auditor', team: 'B', status: 'Active' },
  ];
  const plans = [{ team: 'A' }, { team: 'A' }, { team: 'B' }];
  const s = auditorStats({ team, plans, audits, passTarget: 50 });
  assert.equal(s.rows[0].percent, 50);
  assert.equal(s.rows[1].percent, 0);
  assert.equal(s.passed, 1);
  assert.equal(s.planned, 3);
});

test('แผนงาน: สถานะเทียบวันนี้ (ตรึงวัน)', () => {
  const row = { start_date: '2026-01-01', end_date: '2026-01-10', progress: 0 };
  assert.equal(planStatus(row, '2025-12-31').code, 'waiting');
  assert.equal(planStatus(row, '2026-01-05').code, 'behind');
  assert.equal(planStatus(row, '2026-01-12').code, 'overdue');
  assert.equal(planStatus({ ...row, progress: 100, done_on: '2026-01-08' }, '2026-02-01').code, 'early');
  assert.equal(planStatus({ progress: 0 }, '2026-01-01').code, 'none');
  const d = derive({ act_task: 'h' }, [{ ...row, progress: 100, done_on: '2026-01-10' }, { start_date: '2026-01-11', end_date: '2026-01-20', progress: 0 }]);
  assert.equal(d.start_date, '2026-01-01');
  assert.equal(d.end_date, '2026-01-20');
  assert.equal(d.progress, 50);
  assert.equal(d.done_on, null);
});
