import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sectionOfOrgNode, canEditOrgNode, canAddOrgNodeUnder, orgSaveBlockReason, filterParentOptions,
} from '../orgNodeEdit.js';

/* ผังจำลอง: 2 ส่วนงาน · แผนก/กลุ่ม/ทีมใต้แต่ละฝั่ง */
const NODES = [
  { id: 's1', kind: 'section', name: 'PD' },
  { id: 's2', kind: 'section', name: 'PLN & STO' },
  { id: 'd1', kind: 'department', name: 'PD3', parent_id: 's1' },
  { id: 'd2', kind: 'department', name: 'STORE', parent_id: 's2' },
  { id: 'd0', kind: 'department', name: 'ขึ้นตรงฝ่าย', parent_id: null },
  { id: 'l1', kind: 'line', name: 'Assy2', parent_id: 'd1' },
  { id: 'l2', kind: 'line', name: 'Store Semi', parent_id: 'd2' },
  { id: 't1', kind: 'team', name: 'A', parent_id: 'l1' },
  { id: 'lx', kind: 'line', name: 'กลุ่มกำพร้า', parent_id: 'dZZ' },   // แม่หาไม่เจอ
];
const own = { nodes: NODES, isAdmin: false, canOwn: true, mySecId: 's1' };
const admin = { nodes: NODES, isAdmin: true, canOwn: false, mySecId: null };

test('sectionOfOrgNode — ไต่ขึ้นถึงส่วนงาน · ไล่ไม่ถึง = null (ไม่เดา)', () => {
  assert.equal(sectionOfOrgNode(NODES.find(n => n.id === 't1'), NODES), 's1');
  assert.equal(sectionOfOrgNode(NODES.find(n => n.id === 'l2'), NODES), 's2');
  assert.equal(sectionOfOrgNode(NODES.find(n => n.id === 's1'), NODES), 's1');
  assert.equal(sectionOfOrgNode(NODES.find(n => n.id === 'd0'), NODES), null);
  assert.equal(sectionOfOrgNode(NODES.find(n => n.id === 'lx'), NODES), null, 'แม่หาไม่เจอ = null');
  assert.equal(sectionOfOrgNode(null, NODES), null);
});

test('canEditOrgNode — ของตัวเองได้ · ข้ามส่วนงานไม่ได้ · section = admin เท่านั้น', () => {
  assert.equal(canEditOrgNode(NODES.find(n => n.id === 'l1'), own), true);
  assert.equal(canEditOrgNode(NODES.find(n => n.id === 't1'), own), true);
  assert.equal(canEditOrgNode(NODES.find(n => n.id === 'l2'), own), false);
  assert.equal(canEditOrgNode(NODES.find(n => n.id === 's1'), own), false, 'โครงบริษัท = admin');
  assert.equal(canEditOrgNode(NODES.find(n => n.id === 'd0'), own), false, 'ขึ้นตรงฝ่าย = admin');
  assert.equal(canEditOrgNode(NODES.find(n => n.id === 'lx'), own), false, 'ไล่สายไม่ครบ = บล็อก');
  assert.equal(canEditOrgNode(NODES.find(n => n.id === 's1'), admin), true);
  assert.equal(canEditOrgNode(NODES.find(n => n.id === 'l1'), { ...own, canOwn: false }), false);
});

test('canAddOrgNodeUnder — ปลายทางต้องอยู่ใต้ส่วนงานเรา · ชั้นแม่ผิด/ไม่มีแม่ = บล็อก', () => {
  assert.equal(canAddOrgNodeUnder('line', 'd1', own), true);
  assert.equal(canAddOrgNodeUnder('line', 'd2', own), false, 'แผนกของส่วนงานอื่น');
  assert.equal(canAddOrgNodeUnder('team', 'l1', own), true);
  assert.equal(canAddOrgNodeUnder('team', 'd1', own), false, 'ทีมต้องอยู่ใต้กลุ่ม ไม่ใช่แผนก');
  assert.equal(canAddOrgNodeUnder('department', 's1', own), true);
  assert.equal(canAddOrgNodeUnder('department', null, own), false, 'ขึ้นตรงฝ่าย = admin');
  assert.equal(canAddOrgNodeUnder('section', 's1', own), false);
  assert.equal(canAddOrgNodeUnder('line', 'dZZ', own), false, 'แม่หาไม่เจอ = บล็อก');
  assert.equal(canAddOrgNodeUnder('line', 'd2', admin), true);
});

test('🔴 ย้ายโหนด = ต้องเช็คปลายทางด้วย (ต้นทางผ่านไม่พอ)', () => {
  const l1 = NODES.find(n => n.id === 'l1');
  // แก้ชื่อเฉยๆ (แม่เดิม) = ผ่าน
  assert.equal(orgSaveBlockReason({ kind: 'line', parentId: 'd1', editing: l1 }, own), null);
  // ย้ายไปแขวนใต้แผนกของส่วนงานอื่น = บล็อก ทั้งที่ต้นทางเป็นของเรา
  const msg = orgSaveBlockReason({ kind: 'line', parentId: 'd2', editing: l1 }, own);
  assert.ok(msg && /ปลายทาง/.test(msg), `ต้องบล็อกและบอกว่าปลายทางไม่ใช่ของเรา (ได้: ${msg})`);
  // admin ย้ายได้
  assert.equal(orgSaveBlockReason({ kind: 'line', parentId: 'd2', editing: l1 }, admin), null);
  // ของส่วนงานอื่น = บล็อกที่ต้นทางก่อน
  const m2 = orgSaveBlockReason({ kind: 'line', parentId: 'd2', editing: NODES.find(n => n.id === 'l2') }, own);
  assert.ok(m2 && /ไม่มีสิทธิ์แก้/.test(m2));
  // เพิ่มใหม่ = เช็คปลายทาง
  assert.equal(orgSaveBlockReason({ kind: 'team', parentId: 'l1', editing: null }, own), null);
  assert.ok(orgSaveBlockReason({ kind: 'team', parentId: 'l2', editing: null }, own));
});

test('ย้ายโดยไม่เปลี่ยนแม่ — id ต่างชนิด (number/string) ต้องไม่ถือว่าย้าย', () => {
  const nodes = [{ id: 1, kind: 'section', name: 'S' }, { id: 2, kind: 'department', name: 'D', parent_id: 1 },
    { id: 3, kind: 'line', name: 'L', parent_id: 2 }];
  const ctx = { nodes, isAdmin: false, canOwn: true, mySecId: 1 };
  assert.equal(orgSaveBlockReason({ kind: 'line', parentId: '2', editing: nodes[2] }, ctx), null);
});

test('filterParentOptions — กรองด้วยกฎเดียวกับด่าน + บอกจำนวนที่ซ่อน', () => {
  const opts = [{ id: 'd1', label: 'PD3' }, { id: 'd2', label: 'STORE' }, { id: 'd0', label: 'ขึ้นตรงฝ่าย' }];
  const r = filterParentOptions('line', opts, own);
  assert.deepEqual(r.rows.map(o => o.id), ['d1']);
  assert.equal(r.hidden, 2);
  assert.equal(filterParentOptions('line', opts, admin).hidden, 0);
  assert.deepEqual(filterParentOptions(undefined, [], own), { rows: [], hidden: 0 });
});
