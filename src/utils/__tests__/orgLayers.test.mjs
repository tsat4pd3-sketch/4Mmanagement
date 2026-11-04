import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitParentId, isUnitRoot, isOrphanDept, unitRoots, unitNodes, unitChain, UPPER_KINDS } from '../orgLayers.js';

const TODAY = [
  { id: 1, kind: 'section', name: 'PD1', parent_id: null },
  { id: 2, kind: 'department', name: 'BIG PRESS', parent_id: 1 },
  { id: 3, kind: 'department', name: 'JIG MTN', parent_id: null },     // แผนกขึ้นตรง (ของจริง)
  { id: 4, kind: 'line', name: 'LINE A', parent_id: 2 },
];
const FUTURE = [
  { id: 100, kind: 'company_group', name: 'TSG', parent_id: null },
  { id: 101, kind: 'spg', name: 'AMF', parent_id: 100 },
  { id: 102, kind: 'company', name: 'TSAT', parent_id: 101 },
  { id: 103, kind: 'plant', name: 'TSAT-P4', parent_id: 102, cost_center: '2140000000' },
  { id: 1, kind: 'section', name: 'PD1', parent_id: 103 },
  { id: 2, kind: 'department', name: 'BIG PRESS', parent_id: 1 },
  { id: 3, kind: 'department', name: 'JIG MTN', parent_id: 103 },
  { id: 4, kind: 'line', name: 'LINE A', parent_id: 2 },
];

test('วันนี้ (ไม่มีชั้นบน): รากหน่วย = ส่วนงาน + แผนกขึ้นตรง เหมือน parent_id ว่าง', () => {
  assert.deepEqual(unitRoots(TODAY).map(n => n.id), [1, 3]);
  assert.equal(isOrphanDept(TODAY[2], TODAY), true);
  assert.equal(isOrphanDept(TODAY[1], TODAY), false);
  assert.equal(unitParentId(TODAY[1], TODAY), 1);
});

test('🔴 เติมชั้นบนแล้ว คำตอบเรื่องหน่วยต้องเท่าเดิมทุกข้อ', () => {
  assert.deepEqual(unitRoots(FUTURE).map(n => n.id), [1, 3], 'plant เหนือส่วนงานต้องไม่ทำให้ส่วนงานหายจากราก');
  assert.equal(isUnitRoot(FUTURE.find(n => n.id === 1), FUTURE), true);
  assert.equal(isOrphanDept(FUTURE.find(n => n.id === 3), FUTURE), true, 'แผนกใต้ plant ตรงๆ = ขึ้นตรง');
  assert.equal(unitParentId(FUTURE.find(n => n.id === 1), FUTURE), null, 'แม่เป็น plant = ไม่มีแม่ในความหมายของหน่วย');
  assert.deepEqual(unitNodes(FUTURE).map(n => n.id), [1, 2, 3, 4]);
  for (const k of UPPER_KINDS) assert.ok(!unitNodes(FUTURE).some(n => n.kind === k));
});

test('🔴 สายตกทอดหยุดที่ชั้นบน — CC ของ plant ห้ามไหลลงหน่วย', () => {
  const chain = unitChain(4, FUTURE).map(n => n.id);
  assert.deepEqual(chain, [4, 2, 1]);
  assert.ok(!chain.includes(103));
});

test('แม่ที่ไม่อยู่ในลิสต์ที่ส่งมา = ถือว่าเป็นหน่วย (จอที่โหลดแค่ department ยังได้คำตอบเดิม)', () => {
  const deptsOnly = FUTURE.filter(n => n.kind === 'department');
  assert.equal(isOrphanDept(deptsOnly.find(n => n.id === 2), deptsOnly), false, 'parent 1 ไม่อยู่ในลิสต์ → ไม่เดาว่าขึ้นตรง');
  assert.equal(isOrphanDept(deptsOnly.find(n => n.id === 3), deptsOnly), false, 'parent 103 ไม่อยู่ในลิสต์ → ยังตอบไม่ได้ (ต้องโหลดชั้นบน)');
});
