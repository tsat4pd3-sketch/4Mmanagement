// เทส utils/pmMonthly.js — ใบ PM ขั้น ③④ รายเดือน (19/11) · เคสอิงผังจริง (ไม่มีชื่อคน)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizePmMonth, teamMonthReady, sectionNodeIdOf, coversNode,
  pmMonthlySignVerdict, pmMonthlySignText, pmSignSnapshot, pmSnapshotDrift, activeSignoffs, signKey,
  scopeKeyOf, parseSignRow, KIND_OF_STEP,
} from '../pmMonthly.js';

const TODAY = '2026-11-19';
// ผังย่อตามของจริง: PD3 · PD4 > JIG MTN · Tooling MTN > Die MTN · PD2 · plant ชั้นบน
const NODES = [
  { id: 'plant', kind: 'plant', name: 'TSAT', parent_id: null },
  { id: 'pd2', kind: 'section', name: 'PD2', code: 'PD2', parent_id: 'plant' },
  { id: 'pd3', kind: 'section', name: 'PD3', code: 'PD3', parent_id: 'plant' },
  { id: 'pd4', kind: 'section', name: 'PD4', code: 'PD4', parent_id: 'plant' },
  { id: 'jig', kind: 'department', name: 'JIG MTN', parent_id: 'pd4' },
  { id: 'tool', kind: 'section', name: 'Tooling MTN', parent_id: 'plant' },
  { id: 'die', kind: 'department', name: 'Die MTN', parent_id: 'tool' },
];
// ผู้จัดการสังกัด PD3 ที่ดูควบ PD4 (head 2 แถว) · รักษาการ ผจก. PD2 (acting)
const MGR_PD3_PD4 = [{ org_node_id: 'pd3', kind: 'head' }, { org_node_id: 'pd4', kind: 'head' }];
const ACTING_PD2 = [{ org_node_id: 'pd2', kind: 'acting' }];

const rows = [
  { id: 1, jig_id: 'a', status: 'pass', approval_status: 'approved', inspector_id: 'u1', team: 'jig_maintenance' },
  { id: 2, jig_id: 'b', status: 'fail', approval_status: 'approved', inspector_id: 'u1', team: 'jig_maintenance' },
  { id: 3, jig_id: 'c', status: 'pass', approval_status: 'pending', inspector_id: 'u2', team: 'die_maintenance' },
  { id: 4, jig_id: 'd', status: 'pass', approval_status: 'rejected', inspector_id: 'u2', team: 'die_maintenance' },
  { id: 5, jig_id: 'z', status: 'pass', approval_status: 'approved', inspector_id: 'u1', team: 'jig_maintenance' },
];
const lineOfJig = new Map([['a', 'L1'], ['b', 'L2'], ['c', 'L1'], ['d', 'L1'], ['z', 'NOPE']]);
const SEC = { L1: 'PD3', L2: 'PD2' };
const sum = summarizePmMonth(rows, { lineOfJig, sectionOfLine: (l) => SEC[l] || null });

test('summarize: นับรายทีม + แยกส่วนงาน + เครื่องที่หาส่วนงานไม่เจอ', () => {
  const j = sum.get('jig_maintenance');
  assert.equal(j.total, 3); assert.equal(j.confirmed, 3); assert.equal(j.ng, 1);
  assert.equal(j.noSection, 1);                      // ไลน์ NOPE ไม่มีในทะเบียน = นับแยก ห้ามเดา
  assert.deepEqual([...j.sections.keys()].sort(), ['PD2', 'PD3']);
  const d = sum.get('die_maintenance');
  assert.equal(d.waiting, 1); assert.equal(d.rejected, 1); assert.equal(d.confirmed, 0);
});

test('③ บล็อกจนผ่านขั้น ② ครบ — ตีกลับก็ยังไม่ครบ (user 19/11)', () => {
  assert.equal(teamMonthReady(sum.get('jig_maintenance')), true);
  assert.equal(teamMonthReady(sum.get('die_maintenance')), false);
  assert.equal(teamMonthReady(null), false);
  const v = pmMonthlySignVerdict({ step: 3, permitted: true, team: sum.get('die_maintenance'), targetNodeId: 'die', cover: { ok: true } });
  assert.equal(v.code, 'not_ready'); assert.equal(v.waiting, 1); assert.equal(v.rejected, 1);
  assert.match(pmMonthlySignText(v), /ขั้น ② .*1 ใบ.*ตีกลับ 1/);
});

test('ครอบโหนด: ดูควบ PD4 (head) ⇒ ครอบ JIG MTN ที่อยู่ใต้ PD4 · ไม่ครอบ Die MTN', () => {
  const c = coversNode(MGR_PD3_PD4, 'jig', NODES, TODAY);
  assert.equal(c.ok, true); assert.equal(c.via.nodeId, 'pd4'); assert.equal(c.via.kind, 'head');
  assert.equal(coversNode(MGR_PD3_PD4, 'die', NODES, TODAY).ok, false);
  // รักษาการ PD2 = acting ครอบ PD2 เหมือน head
  assert.equal(coversNode(ACTING_PD2, 'pd2', NODES, TODAY).via.kind, 'acting');
  // ไม่ไต่ข้ามชั้นบน: มอบหมายที่ plant ไม่ทำให้ครอบทุกหน่วย (unitChain หยุดก่อนชั้นบน)
  assert.equal(coversNode([{ org_node_id: 'plant', kind: 'head' }], 'jig', NODES, TODAY).ok, false);
});

test('ครอบโหนด: มอบหมายหมดอายุ = ไม่ครอบ · ยังไม่เริ่ม = ไม่ครอบ', () => {
  assert.equal(coversNode([{ org_node_id: 'pd4', kind: 'acting', ends_on: '2026-10-01' }], 'jig', NODES, TODAY).ok, false);
  assert.equal(coversNode([{ org_node_id: 'pd4', kind: 'acting', starts_on: '2026-12-01' }], 'jig', NODES, TODAY).ok, false);
});

test('ส่วนงาน → โหนดผัง: ต้องเจอ 1 โหนดพอดี (0 / ซ้ำ = null ห้ามเดา)', () => {
  assert.equal(sectionNodeIdOf('pd3', NODES), 'pd3');
  assert.equal(sectionNodeIdOf('ไม่มี', NODES), null);
  assert.equal(sectionNodeIdOf('PD3', [...NODES, { id: 'x', kind: 'section', name: 'PD3' }]), null);
  assert.equal(sectionNodeIdOf('', NODES), null);
});

test('verdict: ลำดับด่าน — สิทธิ์ · บัญชีกลาง · ซ้ำ · ตรวจเองอนุมัติเอง · ④ ต้องหลัง ③ · ผังอ่านไม่ได้', () => {
  const team = sum.get('jig_maintenance');
  const base = { step: 3, permitted: true, team, targetNodeId: 'jig', cover: { ok: true, via: {} } };
  assert.equal(pmMonthlySignVerdict({ ...base, permitted: false }).code, 'no_perm');
  assert.equal(pmMonthlySignVerdict({ ...base, sharedAccount: true }).code, 'shared');
  assert.equal(pmMonthlySignVerdict({ ...base, alreadySigned: true }).code, 'already');
  assert.equal(pmMonthlySignVerdict({ ...base, myUid: 'u1' }).code, 'self');
  assert.equal(pmMonthlySignVerdict({ ...base, orgReadable: false }).code, 'org_unreadable');
  assert.equal(pmMonthlySignVerdict({ ...base, targetNodeId: null }).code, 'team_unmapped');
  assert.equal(pmMonthlySignVerdict({ ...base, cover: { ok: false } }).code, 'not_covered');
  assert.equal(pmMonthlySignVerdict(base).ok, true);
  const s4 = { ...base, step: 4, targetNodeId: 'pd3' };
  assert.equal(pmMonthlySignVerdict(s4).code, 'need_step3');
  assert.equal(pmMonthlySignVerdict({ ...s4, step3Signed: true }).ok, true);
  assert.equal(pmMonthlySignVerdict({ ...s4, step3Signed: true, targetNodeId: null }).code, 'section_unmapped');
  // ไม่มีใบ = no_data ก่อนเรื่องอื่น
  assert.equal(pmMonthlySignVerdict({ ...base, team: null }).code, 'no_data');
  // ข้อความบอกทางแก้เสมอ
  assert.match(pmMonthlySignText(pmMonthlySignVerdict({ ...base, cover: { ok: false } })), /\/org-setup/);
});

test('snapshot + drift · activeSignoffs เอาเฉพาะ signed', () => {
  const team = sum.get('jig_maintenance');
  const snap = pmSignSnapshot(team);
  assert.deepEqual(snap, { total: 3, confirmed: 3, ng: 1, machines: 3, sections: 2 });
  assert.equal(pmSnapshotDrift(snap, pmSignSnapshot(team)), false);
  assert.equal(pmSnapshotDrift(snap, { ...snap, total: 4 }), true);
  assert.deepEqual(pmSignSnapshot(team, 'PD2'), { total: 1, ng: 1, machines: 1 });
  const m = activeSignoffs([
    { kind: 'team_approve', scope_key: 't', status: 'revoked', id: 1 },
    { kind: 'team_approve', scope_key: 't', status: 'signed', id: 2 },
    { kind: 'section_ack', scope_key: 't|PD3', status: 'signed', id: 3 },
    { kind: 'section_ack', scope_key: 'PD3', status: 'signed', id: 4 },   // แบบเก่า (ไม่มีทีม) = ไม่เดา
  ]);
  assert.equal(m.get(signKey('t', 3)).id, 2);
  assert.equal(m.get(signKey('t', 4, 'PD3')).id, 3);
  assert.equal(m.skipped, 1);
});

test('แปลงขั้น ↔ kind/scope_key ของตารางเดิม (13/11) ไป-กลับตรงกัน', () => {
  assert.equal(KIND_OF_STEP[3], 'team_approve'); assert.equal(KIND_OF_STEP[4], 'section_ack');
  assert.equal(scopeKeyOf('jig', 3), 'jig'); assert.equal(scopeKeyOf('jig', 4, 'PD4'), 'jig|PD4');
  assert.deepEqual(parseSignRow({ kind: 'section_ack', scope_key: scopeKeyOf('jig', 4, 'PD4') }), { step: 4, team: 'jig', section: 'PD4' });
  assert.deepEqual(parseSignRow({ kind: 'team_approve', scope_key: 'jig' }), { step: 3, team: 'jig', section: null });
  assert.equal(parseSignRow({ kind: 'x', scope_key: 'jig' }), null);
});
