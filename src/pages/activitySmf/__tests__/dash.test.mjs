import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectSummary, progressTone } from '../dash.js';

const projects = [
  { code: 'oee', name: 'Smart OEE', status: 'Active', target_type: 'plan' },
  { code: 'workflow', name: 'Work Flow', status: 'Active', target_type: 'count', target_count: 4 },
  { code: 'old', name: 'ปิดแล้ว', status: 'Inactive', target_type: 'plan' },
];
const tasks = [
  { act_task: 'h1', parent_id: null, sort_no: 1, unit: 'oee', start_date: '2026-01-01', end_date: '2026-01-10', progress: 100, done_on: '2026-01-10' },
  { act_task: 'h2', parent_id: null, sort_no: 2, unit: 'oee', start_date: '2026-01-11', end_date: '2026-01-30', progress: 0 },
  { act_task: 'w1', parent_id: null, sort_no: 3, unit: 'workflow', progress: 100 },
  { act_task: 'w2', parent_id: null, sort_no: 4, unit: 'workflow', progress: 50 },
];
const team = [
  { employee_code: '1', unit: 'oee', status: 'Active' }, { employee_code: '1', unit: 'oee', status: 'Active' },
  { employee_code: '2', unit: 'oee', status: 'Inactive' }, { employee_code: '3', unit: 'workflow', status: 'Active' },
];

test('ภาพรวมโครงการ: แผน = ถ่วงจำนวนวัน · จำนวน = เสร็จ ÷ เป้า · ปิดแล้วไม่โชว์', () => {
  const s = projectSummary({ projects, tasks, team, today: '2026-02-15' });
  assert.equal(s.length, 2);
  const oee = s.find(x => x.code === 'oee');
  assert.equal(oee.progress, 33);          // (10×100 + 20×0) / 30
  assert.equal(oee.overdue, 1);            // h2 เลยกำหนด
  assert.equal(oee.members, 1);            // คนซ้ำนับครั้งเดียว · Inactive ไม่นับ
  const wf = s.find(x => x.code === 'workflow');
  assert.equal(wf.progress, 25);           // 1 ÷ 4
  assert.equal(wf.done, 1);
});

test('ไม่มีแผน = null (ห้ามโชว์ 0) · สีแถบ', () => {
  const s = projectSummary({ projects: [projects[0]], tasks: [], team: [], today: '2026-01-01' });
  assert.equal(s[0].progress, null);
  assert.equal(progressTone(null), 'muted');
  assert.equal(progressTone(49), 'red');
  assert.equal(progressTone(50), 'amber');
  assert.equal(progressTone(100), 'green');
});
