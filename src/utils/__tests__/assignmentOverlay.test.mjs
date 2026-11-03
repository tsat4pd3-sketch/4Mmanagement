import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCcIndex } from '../ccScope.js';
import { applyAssignments } from '../assignmentOverlay.js';

const NODES = [
  { id: 1, kind: 'section',    name: 'PD3',       parent_id: null, cost_center: '2140462000' },
  { id: 2, kind: 'department', name: 'HYDROFORM', parent_id: 1,    cost_center: '2140562001' },
  { id: 3, kind: 'line',       name: 'HDF1',      parent_id: 2,    cost_center: null },          // ตกทอดจากแผนก
  { id: 4, kind: 'section',    name: 'PD4',       parent_id: null, cost_center: '2140471000' },
  { id: 5, kind: 'department', name: 'JIG MTN',   parent_id: null, cost_center: '2140563100' }, // ขึ้นตรงฝ่าย
];
const ccIdx = buildCcIndex(NODES);
const TODAY = '2026-11-02';
const act = (over) => ({ id: 'a', kind: 'acting', org_node_id: 2, scope_depth: 'branch', starts_on: '2026-10-01', ends_on: null, ...over });

test('ไม่มีมอบหมาย = ค่าเดิมเป๊ะ (ไม่ failed)', () => {
  const r = applyAssignments({ sections: ['PD4'], respCostCenters: ['2140471000'] }, [], { nodes: NODES, ccIdx, today: TODAY });
  assert.deepEqual(r.sections, ['PD4']); assert.deepEqual(r.respCostCenters, ['2140471000']);
  assert.equal(r.failed, false); assert.equal(r.reason, 'none');
});

test('รักษาการแผนก HYDROFORM → เห็น PD3 เพิ่ม + แก้ CC ของแผนกได้ · ของเดิมยังอยู่ครบ', () => {
  const r = applyAssignments({ sections: ['PD4'], respCostCenters: ['2140471000'] }, [act()], { nodes: NODES, ccIdx, today: TODAY });
  assert.deepEqual(r.sections.sort(), ['PD3', 'PD4']);
  assert.deepEqual(r.respCostCenters.sort(), ['2140471000', '2140562001']);
  assert.equal(r.applied.length, 1); assert.equal(r.applied[0].section, 'PD3');
});

test('🔴 ฐานไม่จำกัด (sections ว่าง) ต้องคงว่าง — ห้ามกลายเป็นจำกัดเพราะมอบหมาย', () => {
  const r = applyAssignments({ sections: [], respCostCenters: [] }, [act()], { nodes: NODES, ccIdx, today: TODAY });
  assert.deepEqual(r.sections, []);
  assert.deepEqual(r.respCostCenters, ['2140562001']);
});

test('มอบหมาย scope_depth=all → เห็นทั้งโรงงาน', () => {
  const r = applyAssignments({ sections: ['PD4'], respCostCenters: [] }, [act({ scope_depth: 'all' })], { nodes: NODES, ccIdx, today: TODAY });
  assert.deepEqual(r.sections, []);
});

test('หน่วยไม่มีรหัสเอง → CC ตกทอดจากแม่ (กฎ ccOfNode)', () => {
  const r = applyAssignments({ sections: [], respCostCenters: [] }, [act({ org_node_id: 3 })], { nodes: NODES, ccIdx, today: TODAY });
  assert.deepEqual(r.respCostCenters, ['2140562001']);
});

test('แผนกขึ้นตรงฝ่าย (ไม่มี section) ใช้ตัวเองเป็นส่วนงาน', () => {
  const r = applyAssignments({ sections: ['PD4'], respCostCenters: [] }, [act({ org_node_id: 5 })], { nodes: NODES, ccIdx, today: TODAY });
  assert.ok(r.sections.includes('JIG MTN'));
});

test('🔴 หมดอายุแล้ว / ยังไม่เริ่ม = ไม่ทับ', () => {
  const r1 = applyAssignments({ sections: ['PD4'], respCostCenters: [] }, [act({ ends_on: '2026-10-31' })], { nodes: NODES, ccIdx, today: TODAY });
  const r2 = applyAssignments({ sections: ['PD4'], respCostCenters: [] }, [act({ starts_on: '2026-12-01' })], { nodes: NODES, ccIdx, today: TODAY });
  assert.deepEqual(r1.sections, ['PD4']); assert.deepEqual(r2.sections, ['PD4']);
  assert.equal(r1.reason, 'none');
});

test('🔴 ผังอ่านไม่ได้ = คืนค่าเดิม + failed (ห้ามเดา)', () => {
  const r = applyAssignments({ sections: ['PD4'], respCostCenters: ['x'] }, [act()], { nodes: [], ccIdx: null, today: TODAY });
  assert.deepEqual(r.sections, ['PD4']); assert.deepEqual(r.respCostCenters, ['x']);
  assert.equal(r.failed, true); assert.equal(r.reason, 'org_unreadable');
});

test('โหนดที่ถูกลบจากผัง = ข้ามแถวนั้น บอกใน applied ไม่เงียบ', () => {
  const r = applyAssignments({ sections: ['PD4'], respCostCenters: [] }, [act({ org_node_id: 999 })], { nodes: NODES, ccIdx, today: TODAY });
  assert.deepEqual(r.sections, ['PD4']);
  assert.equal(r.applied[0].skipped, 'node_missing');
});
