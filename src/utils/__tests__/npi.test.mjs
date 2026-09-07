import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysBetween, addDays, deliverableLight, phaseRollup, partRollup, ppapProgress, projectRollup,
  buildPartRows, eciMissingLinks, ganttRange, barPos, stepLight, toolingRollup, proposeSteps,
  nextProjectCode, nextEciCode, groupByPhase,
} from '../npi.js';

const T = '2026-09-07';

test('daysBetween/addDays — UTC ล้วน ไม่เพี้ยนวัน', () => {
  assert.equal(daysBetween('2026-09-01', '2026-09-07'), 6);
  assert.equal(daysBetween('2026-09-07', '2026-09-01'), -6);
  assert.equal(daysBetween(null, T), null);
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('deliverableLight — เลยกำหนดแดง · ใกล้กำหนดเหลือง · อนุมัติเขียว · ไม่ต้องใช้เทา', () => {
  assert.equal(deliverableLight({ status: 'approved', due_date: '2026-01-01' }, T), 'green');
  assert.equal(deliverableLight({ status: 'not_required', due_date: '2026-01-01' }, T), 'grey');
  assert.equal(deliverableLight({ status: 'rejected' }, T), 'red');
  assert.equal(deliverableLight({ status: 'not_started', due_date: '2026-09-06' }, T), 'red');
  assert.equal(deliverableLight({ status: 'not_started', due_date: '2026-09-14' }, T), 'amber');   // 7 วัน
  assert.equal(deliverableLight({ status: 'not_started', due_date: '2026-09-15' }, T), 'grey');    // 8 วัน
  assert.equal(deliverableLight({ status: 'submitted', due_date: '2026-12-01' }, T), 'amber');
  assert.equal(deliverableLight({ status: 'in_progress' }, T), 'amber');
  assert.equal(deliverableLight({ status: 'not_started' }, T), 'grey');
  assert.equal(deliverableLight(null, T), 'grey');
});

const phases = [
  { phase_code: 'p1', label: 'P1', seq: 1, status: 'completed', plan_end: '2026-08-01' },
  { phase_code: 'p2', label: 'P2', seq: 2, status: 'in_progress', plan_end: '2026-10-01' },
  { phase_code: 'p3', label: 'P3', seq: 3, status: 'not_started', plan_end: '2026-09-01' },   // เลยแผนแล้ว
];
const delivs = [
  { phase_code: 'p1', code: 'a', status: 'approved', ppap_element: false },
  { phase_code: 'p2', code: 'b', status: 'approved', ppap_element: true },
  { phase_code: 'p2', code: 'c', status: 'in_progress', ppap_element: true, due_date: '2026-12-01' },
  { phase_code: 'p2', code: 'x', status: 'not_required', ppap_element: true },
  { phase_code: 'p3', code: 'd', status: 'not_started', ppap_element: true, due_date: '2026-12-01' },
];

test('phaseRollup — เฟสปิดแล้วเขียว · เฟสเลยวันแผนแดงแม้เอกสารยังไม่ถึงกำหนด · ไม่นับ not_required', () => {
  assert.deepEqual(phaseRollup(phases[0], delivs, T), { total: 1, done: 1, pct: 100, overdue: 0, light: 'green' });
  const p2 = phaseRollup(phases[1], delivs, T);
  assert.equal(p2.total, 2); assert.equal(p2.done, 1); assert.equal(p2.pct, 50); assert.equal(p2.light, 'amber');
  assert.equal(phaseRollup(phases[2], delivs, T).light, 'red');
  assert.equal(phaseRollup({ phase_code: 'z', status: 'not_started' }, [], T).light, 'grey');
});

test('partRollup — เฟสปัจจุบัน = เฟสแรกที่ยังไม่ปิด · ไฟรวม = แย่สุด · PPAP นับเฉพาะ element', () => {
  const r = partRollup({ status: 'active', ppap_status: 'in_progress' }, phases, delivs, T);
  assert.equal(r.current.phase_code, 'p2');
  assert.equal(r.total, 4); assert.equal(r.done, 2); assert.equal(r.pct, 50);
  assert.equal(r.light, 'red');
  assert.deepEqual(r.ppap, { total: 3, done: 1, pct: 33 });
  assert.equal(partRollup({ status: 'completed' }, phases, delivs, T).light, 'green');
  assert.equal(partRollup({ status: 'active', ppap_status: 'rejected' }, [phases[0]], [delivs[0]], T).light, 'red');
  // ไม่มีเฟส/เอกสารเลย ต้องไม่พัง
  const e = partRollup({ status: 'active' }, [], [], T);
  assert.equal(e.current, null); assert.equal(e.pct, 0); assert.equal(e.light, 'grey');
});

test('ppapProgress / projectRollup', () => {
  assert.deepEqual(ppapProgress([]), { total: 0, done: 0, pct: 0 });
  const pr = projectRollup([{ total: 4, done: 2, overdue: 1, light: 'red' }, { total: 2, done: 2, overdue: 0, light: 'green' }]);
  assert.equal(pr.parts, 2); assert.equal(pr.pct, 67); assert.equal(pr.overdue, 1); assert.equal(pr.light, 'red');
  assert.equal(projectRollup([{ total: 1, done: 1, overdue: 0, light: 'green' }]).light, 'green');
  assert.equal(projectRollup([]).light, 'grey');
});

test('buildPartRows — snapshot จากแม่แบบ · กระจายวันแผน kickoff→SOP · sync เติมเฉพาะที่ขาด', () => {
  const tp = [{ code: 'p1', label: 'P1', seq: 1 }, { code: 'p2', label: 'P2', seq: 2 }];
  const td = [
    { id: 't1', code: 'a', label: 'A', phase_code: 'p1', seq: 1, doc_kind: 'pfc', required: true, ppap_element: false },
    { id: 't2', code: 'b', label: 'B', phase_code: 'p2', seq: 1, doc_kind: 'ppap', required: false, ppap_element: true },
    { id: 't3', code: 'c', label: 'C', phase_code: 'p2', seq: 2, is_active: false },
  ];
  const r = buildPartRows({ partId: 'P', templatePhases: tp, templateDelivs: td, kickoffDate: '2026-01-01', sopDate: '2026-01-21' });
  assert.equal(r.phaseRows.length, 2);
  assert.deepEqual([r.phaseRows[0].plan_start, r.phaseRows[0].plan_end], ['2026-01-01', '2026-01-11']);
  assert.deepEqual([r.phaseRows[1].plan_start, r.phaseRows[1].plan_end], ['2026-01-11', '2026-01-21']);   // เฟสสุดท้ายจบวัน SOP
  assert.equal(r.delivRows.length, 2);                                   // inactive ถูกข้าม
  assert.equal(r.delivRows[0].due_date, '2026-01-11');                    // due = plan_end ของเฟส
  assert.equal(r.delivRows[1].status, 'not_required');                    // required=false → ไม่ต้องใช้ (ติ๊กกลับได้)
  assert.equal(r.delivRows[1].template_deliverable_id, 't2');
  // sync: มีอยู่แล้วบางส่วน → เติมเฉพาะที่ขาด
  const s = buildPartRows({ partId: 'P', templatePhases: tp, templateDelivs: td,
    existingPhases: [{ phase_code: 'p1' }], existingDelivs: [{ code: 'a' }] });
  assert.deepEqual(s.phaseRows.map(p => p.phase_code), ['p2']);
  assert.deepEqual(s.delivRows.map(d => d.code), ['b']);
  assert.equal(s.phaseRows[0].plan_start, null);                          // ไม่รู้ SOP = ว่าง ไม่เดา
});

test('eciMissingLinks — เฉพาะขาที่ติ๊กแต่ยังไม่ผูก', () => {
  assert.deepEqual(eciMissingLinks({ affects_drawing: true, affects_pe: true, pe_change_request_id: 'x' }), ['แบบ/Drawing rev ใหม่']);
  assert.deepEqual(eciMissingLinks({ affects_process: false }), []);
  assert.deepEqual(eciMissingLinks(null), []);
});

test('ganttRange / barPos — เผื่อขอบ 2 วัน · แท่งไม่ล้น 100%', () => {
  const rows = [{ plan_start: '2026-09-01', plan_end: '2026-09-10' }, { plan_start: null, plan_end: null }];
  const r = ganttRange(rows, T);
  assert.deepEqual([r.start, r.end, r.days], ['2026-08-30', '2026-09-12', 13]);
  const b = barPos('2026-09-01', '2026-09-10', r);
  assert.ok(b.left > 0 && b.left + b.width <= 100.0001);
  assert.equal(barPos(null, null, r), null);
  assert.equal(ganttRange([{}], null), null);
});

test('stepLight / toolingRollup / proposeSteps', () => {
  assert.equal(stepLight({ status: 'completed' }, T), 'green');
  assert.equal(stepLight({ status: 'in_progress', plan_end: '2026-09-01' }, T), 'red');
  assert.equal(stepLight({ status: 'not_started', plan_end: '2026-09-10' }, T), 'amber');
  assert.equal(stepLight({ status: 'not_started' }, T), 'grey');
  const steps = [{ status: 'completed', progress_pct: 100 }, { status: 'in_progress', progress_pct: 50, plan_end: '2026-12-01' }];
  const tr = toolingRollup({ status: 'in_progress' }, steps, T);
  assert.equal(tr.pct, 75); assert.equal(tr.light, 'amber'); assert.equal(tr.done, 1);
  assert.equal(toolingRollup({ status: 'completed' }, [], T).light, 'green');
  assert.equal(toolingRollup({ status: 'in_progress', plan_end: '2026-01-01' }, steps, T).light, 'red');
  const tpl = [{ tool_kind: 'die', seq: 20, name: 'B', default_days: 3 }, { tool_kind: 'die', seq: 10, name: 'A', default_days: 2 }, { tool_kind: 'jig', seq: 10, name: 'J' }];
  const ps = proposeSteps(tpl, 'die', '2026-09-01');
  assert.deepEqual(ps.map(s => [s.name, s.plan_start, s.plan_end]), [['A', '2026-09-01', '2026-09-02'], ['B', '2026-09-03', '2026-09-05']]);
  assert.equal(proposeSteps(tpl, 'die', null)[0].plan_start, null);
});

test('nextProjectCode / nextEciCode — นับต่อจากเลขสูงสุดของปี/เดือนเดียวกัน', () => {
  assert.equal(nextProjectCode(['NPI-2026-001', 'NPI-2026-007', 'NPI-2025-099', 'junk', null], T), 'NPI-2026-008');
  assert.equal(nextProjectCode([], T), 'NPI-2026-001');
  assert.equal(nextEciCode(['ECI-202609-002', 'WLS6033'], T), 'ECI-202609-003');
});

test('groupByPhase — เรียงตามเฟส + แถวที่ไม่อยู่ในแม่แบบไปกลุ่มท้าย (ไม่หายเงียบ)', () => {
  const g = groupByPhase([...delivs, { phase_code: 'zz', code: 'q', seq: 1 }], phases);
  assert.deepEqual(g.map(x => x.phase.phase_code), ['p1', 'p2', 'p3', '_orphan']);
  assert.equal(g[3].rows.length, 1);
});
