import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPmMonthly, pmMonthComplete, pmMonthlyVerdict, pmRevokeVerdict, pmSnapshot, pmSnapshotDrift, pmMonthlyAoa, UNKNOWN_SECTION } from '../pmMonthly.js';

const sec = new Map([['hdf1', 'PD3'], ['sw10', 'PD1']]);
const rows = [
  { id: 1, team: 'die_maintenance', line_name: 'HDF1', machine: 'D1', status: 'pass', approval_status: 'approved' },
  { id: 2, team: 'die_maintenance', line_name: 'SW10', machine: 'D2', status: 'fail', approval_status: 'pending' },
  { id: 3, team: 'jig_maintenance', line_name: 'HDF1', machine: 'J1', status: 'pass', approval_status: 'approved' },
  { id: 4, team: 'jig_maintenance', line_name: '', machine: 'J2', status: 'pass', approval_status: 'rejected' },
];

test('buildPmMonthly: นับต่อทีม/ส่วนงาน · ไม่รู้ส่วนงาน = ถังท้าย ห้ามหาย', () => {
  const s = buildPmMonthly(rows, sec);
  assert.equal(s.total.total, 4);
  const die = s.teams.find(t => t.team === 'die_maintenance');
  assert.deepEqual([die.total, die.pass, die.fail, die.confirmed, die.pending], [2, 1, 1, 1, 1]);
  assert.deepEqual(die.sections, ['PD1', 'PD3']);
  assert.equal(s.sections.at(-1).section, UNKNOWN_SECTION);
  const pd3 = s.sections.find(x => x.section === 'PD3');
  assert.equal(pd3.total, 2);
  assert.deepEqual(pd3.byTeam.map(t => t.team), ['die_maintenance', 'jig_maintenance']);
});

test('pmMonthComplete: จบเมื่อวันทำงาน ≥ วันที่ 1 เดือนถัดไป · ข้ามปี', () => {
  assert.equal(pmMonthComplete('2026-11', '2026-11-30').complete, false);
  assert.equal(pmMonthComplete('2026-11', '2026-12-01').complete, true);
  assert.equal(pmMonthComplete('2026-12', '2027-01-01').opensOn, '2027-01-01 08:00');
  assert.equal(pmMonthComplete('bad', '2026-12-01').complete, false);
});

test('pmMonthlyVerdict: ลำดับด่าน + ③ ต้องยืนยันครบ + ④ ต้องรอ ③', () => {
  const base = { permitted: true, signerRank: 60, scopeOk: true, monthComplete: true, total: 3 };
  assert.equal(pmMonthlyVerdict({ ...base, kind: 'team_approve' }).ok, true);
  assert.equal(pmMonthlyVerdict({ ...base, kind: 'team_approve', permitted: false }).code, 'no_perm');
  assert.equal(pmMonthlyVerdict({ ...base, kind: 'team_approve', sharedAccount: true }).code, 'shared_account');
  assert.equal(pmMonthlyVerdict({ ...base, kind: 'team_approve', signerRank: 50 }).code, 'rank_too_low');
  assert.equal(pmMonthlyVerdict({ ...base, kind: 'team_approve', scopeOk: false }).code, 'scope');
  assert.equal(pmMonthlyVerdict({ ...base, kind: 'team_approve', monthComplete: false }).code, 'month_running');
  assert.equal(pmMonthlyVerdict({ ...base, kind: 'team_approve', alreadySigned: true }).code, 'already_signed');
  assert.equal(pmMonthlyVerdict({ ...base, kind: 'team_approve', total: 0 }).code, 'empty');
  assert.equal(pmMonthlyVerdict({ ...base, kind: 'team_approve', pendingConfirm: 2 }).code, 'pending_confirm');
  assert.equal(pmMonthlyVerdict({ ...base, kind: 'section_ack', teamsWaiting: ['jig_maintenance'] }).code, 'wait_team_approve');
  const v = pmMonthlyVerdict({ ...base, kind: 'section_ack', signerRank: null });
  assert.equal(v.ok, true); assert.deepEqual(v.assumed, ['approver']);   // ไม่รู้ตำแหน่ง = ไม่บล็อก + บอกจอ
});

test('pmRevokeVerdict: ต้องมีเหตุผล · ผู้ลงนามเองเพิกถอนได้', () => {
  assert.equal(pmRevokeVerdict({ permitted: true, revokerRank: 30, isSigner: true, reason: 'ตัวเลขผิด' }).ok, true);
  assert.equal(pmRevokeVerdict({ permitted: true, revokerRank: 30, isSigner: false, reason: 'ตัวเลขผิด' }).code, 'rank_too_low');
  assert.equal(pmRevokeVerdict({ permitted: true, revokerRank: 60, reason: 'ผิด' }).code, 'reason');
});

test('snapshot + drift + aoa', () => {
  const s = buildPmMonthly(rows, sec);
  const t = s.teams[0];
  const snap = pmSnapshot(t, { month: '2026-11', kind: 'team_approve' });
  assert.equal(pmSnapshotDrift(snap, t), false);
  assert.equal(pmSnapshotDrift(snap, { ...t, pending: 0 }), true);
  const aoa = pmMonthlyAoa(s, { month: '2026-11' });
  assert.equal(aoa.length, 1 + 4);   // หัว + PD1/die · PD3/die · PD3/jig · ไม่ทราบ/jig
});
