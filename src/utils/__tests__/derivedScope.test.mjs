/* 🧭 เทสของกฎ "อยู่ตรงไหนของผัง → แล้วค่อยดูเลเวล" (30/10)
   ผังจำลองตามของจริง: section QA มีแผนกสำนักงานชื่อ QA อยู่ข้างใน (หัวหน้าส่วนนั่งตรงนั้น) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  derivedScope, subtreeIds, ancestorChain, functionOf, isHeadLevel, LEVEL_GOVERNS, recommendScopeDepth,
} from '../derivedScope.js';

const NODES = [
  { id: 1, kind: 'section',    name: 'QA',          parent_id: null },            // ⚠️ ไม่มี division (ของจริง 02/11)
  { id: 2, kind: 'department', name: 'QA',          parent_id: 1 },   // สำนักงาน QA
  { id: 3, kind: 'department', name: 'Inspection',  parent_id: 1 },
  { id: 4, kind: 'department', name: 'PQA-Press',   parent_id: 1 },
  { id: 5, kind: 'section',    name: 'PD3',         parent_id: null, division: 'production' },
  { id: 9, kind: 'section',    name: 'Maintenance', parent_id: null, division: 'maintenance' },
  { id: 10, kind: 'department', name: 'MTN',        parent_id: 9 },
  { id: 6, kind: 'department', name: 'HYDROFORM',   parent_id: 5 },
  { id: 7, kind: 'line',       name: 'HDF1',        parent_id: 6 },
  { id: 8, kind: 'team',       name: 'ทีม A',       parent_id: 7 },
];
const BY_ID = Object.fromEntries(NODES.map(n => [String(n.id), n]));

test('หัวหน้าส่วนที่นั่งในแผนกสำนักงาน ต้องไต่ขึ้นไปคุมทั้งส่วนงาน', () => {
  const r = derivedScope({ org_node_id: 2, position: 'section_head' }, BY_ID);
  assert.equal(r.scopeNodeId, 1);
  assert.equal(r.scopeKind, 'section');
  assert.equal(r.climbed, 1, 'ไต่ขึ้น 1 ชั้น');
  assert.equal(r.isHead, true);
  assert.equal(r.reason, 'ok');
});

test('ผจก.ที่นั่งในแผนกสำนักงาน ก็ไต่ขึ้นถึงส่วนงานเหมือนกัน', () => {
  assert.equal(derivedScope({ org_node_id: 2, position: 'manager' }, BY_ID).scopeNodeId, 1);
});

test('หัวหน้าแผนก คุมแค่แผนกตัวเอง ไม่ไต่ขึ้นส่วนงาน', () => {
  const r = derivedScope({ org_node_id: 4, position: 'dept_head' }, BY_ID);
  assert.equal(r.scopeNodeId, 4);
  assert.equal(r.climbed, 0);
});

test('หัวหน้าไลน์ที่ผูกกับทีม ไต่ขึ้นถึงไลน์', () => {
  const r = derivedScope({ org_node_id: 8, position: 'line_leader' }, BY_ID);
  assert.equal(r.scopeNodeId, 7);
  assert.equal(r.scopeKind, 'line');
});

test('🔴 สมาชิก (qc/engineer/operator) คุมแค่โหนดตัวเอง ห้ามไต่ขึ้น', () => {
  for (const pos of ['qc', 'engineer', 'operator', 'technician', 'officer', 'clerk']) {
    const r = derivedScope({ org_node_id: 3, position: pos }, BY_ID);
    assert.equal(r.scopeNodeId, 3, pos);
    assert.equal(r.isHead, false, pos);
    assert.equal(r.reason, 'member', pos);
  }
});

test('🔴 ไม่มีโหนด / โหนดหาย = ตัดสินไม่ได้ ห้ามเดาเป็นทั้งโรงงาน', () => {
  assert.equal(derivedScope({ position: 'manager' }, BY_ID).scopeNodeId, null);
  assert.equal(derivedScope({ org_node_id: null, position: 'manager' }, BY_ID).reason, 'no_node');
  const miss = derivedScope({ org_node_id: 999, position: 'manager' }, BY_ID);
  assert.equal(miss.scopeNodeId, null);
  assert.equal(miss.reason, 'node_missing');
});

test('🔴 เลเวลสูงกว่าชั้นที่ผังมี = คืนโหนดตัวเอง + ธง ห้ามขยายให้เอง', () => {
  const nodes = { 10: { id: 10, kind: 'department', name: 'X', parent_id: null } };
  const r = derivedScope({ org_node_id: 10, position: 'manager' }, nodes);
  assert.equal(r.reason, 'level_above_tree');
  assert.equal(r.scopeNodeId, 10, 'ห้ามคืน null และห้ามคืน "ทั้งโรงงาน"');
  assert.equal(r.isHead, true);
});

test('ผังวนลูปต้องไม่ค้าง', () => {
  const loop = { 1: { id: 1, kind: 'department', parent_id: 2 }, 2: { id: 2, kind: 'department', parent_id: 1 } };
  const r = derivedScope({ org_node_id: 1, position: 'section_head' }, loop);
  assert.equal(r.reason, 'level_above_tree');
  assert.deepEqual([...subtreeIds(1, Object.values(loop))].sort(), ['1', '2']);
});

test('subtreeIds = ทั้งกิ่งใต้โหนด (รวมตัวเอง)', () => {
  assert.deepEqual([...subtreeIds(1, NODES)].sort(), ['1', '2', '3', '4']);
  assert.deepEqual([...subtreeIds(5, NODES)].sort(), ['5', '6', '7', '8']);
  assert.deepEqual([...subtreeIds(7, NODES)].sort(), ['7', '8']);
  assert.equal(subtreeIds(null, NODES).size, 0);
});

test('functionOf = ชื่อส่วนงานที่อยู่เหนือสุดของสาย', () => {
  assert.equal(functionOf(8, BY_ID), 'PD3', 'ทีม → ไลน์ → แผนก → ส่วนงาน');
  assert.equal(functionOf(3, BY_ID), 'QA');
  assert.equal(functionOf(999, BY_ID), null, 'ไม่รู้ = null ห้ามเดา');
});

test('ancestorChain เรียงจากตัวเองขึ้นราก', () => {
  assert.deepEqual(ancestorChain(8, BY_ID).map(n => n.name), ['ทีม A', 'HDF1', 'HYDROFORM', 'PD3']);
});

test('isHeadLevel ตรงกับทะเบียน LEVEL_GOVERNS', () => {
  assert.ok(isHeadLevel('section_head') && isHeadLevel('dept_head') && isHeadLevel('manager'));
  assert.ok(!isHeadLevel('qc') && !isHeadLevel('operator') && !isHeadLevel(''));
  assert.deepEqual(Object.keys(LEVEL_GOVERNS).sort(),
    ['dept_head', 'line_leader', 'manager', 'section_head']);
});


test('🔭 แนะนำ scope_depth: สายผลิต หัว=branch · สมาชิก=ตามเลเวล', () => {
  assert.equal(recommendScopeDepth({ org_node_id: 6, position: 'dept_head' }, BY_ID).depth, 'branch');
  assert.equal(recommendScopeDepth({ org_node_id: 7, position: 'line_leader' }, BY_ID).depth, 'branch');
  assert.equal(recommendScopeDepth({ org_node_id: 8, position: 'operator' }, BY_ID, { level: 'operator' }).depth, 'self');
  assert.equal(recommendScopeDepth({ org_node_id: 8, position: 'technician' }, BY_ID, { level: 'technician' }).depth, 'unit');
});

test('🔭 ฟังก์ชันตัดขวาง (ช่าง) = all ทั้งหัวและสมาชิก', () => {
  const r1 = recommendScopeDepth({ org_node_id: 10, position: 'technician' }, BY_ID);
  const r2 = recommendScopeDepth({ org_node_id: 9, position: 'manager' }, BY_ID);
  assert.equal(r1.depth, 'all'); assert.equal(r1.reason, 'cross_cutting');
  assert.equal(r2.depth, 'all');
});

test('🔴 ผังไม่ระบุฝ่าย (QA วันนี้) = null + division_unknown ห้ามเดาเป็น all', () => {
  const r = recommendScopeDepth({ org_node_id: 3, position: 'qc' }, BY_ID);
  assert.equal(r.depth, null);
  assert.equal(r.reason, 'division_unknown');
});

test('🔴 ไม่มีโหนด / เลเวลสูงกว่าผัง = null ไม่เดา', () => {
  assert.equal(recommendScopeDepth({ position: 'manager' }, BY_ID).depth, null);
  const nodes = { 10: { id: 10, kind: 'department', name: 'X', parent_id: null, division: 'production' } };
  const r = recommendScopeDepth({ org_node_id: 10, position: 'manager' }, nodes);
  assert.equal(r.depth, null); assert.equal(r.reason, 'level_above_tree');
});


test('🔄 รักษาการ/มอบหมายที่ยังมีผล ทับค่าแนะนำให้กว้างขึ้นได้ · ฐาน HR ยังเป็น operator', () => {
  const emp = { org_node_id: 8, position: 'operator' };              // HR = operator (ฐาน)
  const base = recommendScopeDepth(emp, BY_ID, { level: 'operator' });
  assert.equal(base.depth, 'self');
  const acting = [{ kind: 'acting', scope_depth: 'branch', starts_on: '2026-01-01', ends_on: null, org_node_id: 7 }];
  const r = recommendScopeDepth(emp, BY_ID, { level: 'operator', assignments: acting, today: '2026-11-02' });
  assert.equal(r.depth, 'branch');
  assert.equal(r.reason, 'acting');
  assert.equal(r.baseDepth, 'self', 'ต้องจำฐาน HR ไว้ให้จอเขียนได้ว่า "ฐาน operator + รักษาการ"');
});

test('🔴 มอบหมายที่หมดอายุแล้ว ไม่ทับ · มอบหมายแคบกว่าฐาน ไม่ทำให้แคบลง', () => {
  const emp = { org_node_id: 6, position: 'dept_head' };            // ฐาน = branch
  const expired = [{ kind: 'acting', scope_depth: 'all', starts_on: '2025-01-01', ends_on: '2025-12-31' }];
  assert.equal(recommendScopeDepth(emp, BY_ID, { assignments: expired, today: '2026-11-02' }).depth, 'branch');
  const narrower = [{ kind: 'head', scope_depth: 'unit', starts_on: '2026-01-01', ends_on: null }];
  const r = recommendScopeDepth(emp, BY_ID, { assignments: narrower, today: '2026-11-02' });
  assert.equal(r.depth, 'branch'); assert.equal(r.reason, 'production_head');
});
