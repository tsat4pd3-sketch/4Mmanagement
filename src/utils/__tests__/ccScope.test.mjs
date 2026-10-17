/* ชั้นสิทธิ์ที่ 3 แกน Cost Center — "รับผิดชอบชั้นส่วนงาน ⇒ ได้ทั้งหมดลงไป" (2026-10-16 · คำสั่ง user)
   ผังในเทสถอดมาจากของจริงฝั่ง Main รวม **กับดักเลขรหัส**: ลูกของ 21404xx คือ 21405xx
   (หลักที่ 5 เปลี่ยน 4→5) ⇒ ใครไล่ลำดับชั้นด้วย prefix ของเลข จะได้ชุดผิด */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrgScope } from '../orgScope.js';
import { buildCcIndex, respScopesOf, canWriteScope, ccBlockText, writableByScope, unknownRespCcs } from '../ccScope.js';

/* ผังจริงย่อ: PD1(ส่วนงาน) → BIG PRESS(แผนก) → ทีม(ไม่มีรหัส) · PD2(ส่วนงาน) → Assy A-GM(แผนก) */
const NODES = [
  { id: 's1', kind: 'section',    name: 'PD1',         parent_id: null, cost_center: '2140461000', is_active: true },
  { id: 'd1', kind: 'department', name: 'BIG PRESS',   parent_id: 's1', cost_center: '2140561001', is_active: true },
  { id: 't1', kind: 'team',       name: 'ทีม A',        parent_id: 'd1', cost_center: null,         is_active: true },
  { id: 'd1b',kind: 'department', name: 'SMALL PRESS', parent_id: 's1', cost_center: null,         is_active: true },
  { id: 's2', kind: 'section',    name: 'PD2',         parent_id: null, cost_center: '2140470000', is_active: true },
  { id: 'd2', kind: 'department', name: 'Assy A-GM',   parent_id: 's2', cost_center: '2140571000', is_active: true },
  { id: 'x9', kind: 'department', name: 'กำพร้า',       parent_id: 'zz', cost_center: '2140599999', is_active: true },
];
const LINES = [
  { id: 'L1', name: 'PRESS 1', section: 'PD1', parent_line_name: null, cost_center: null, is_active: true },
  { id: 'L2', name: 'ASSY 1',  section: 'PD2', parent_line_name: null, cost_center: null, is_active: true },
];
const index = buildOrgScope({ nodes: NODES, lines: LINES, divisions: [], costCenters: [] });
const cc = buildCcIndex(NODES);

/* ═══ ① CC ต่อโหนด — ตกทอดจากแม่ ═══ */
test('ทีมไม่มีรหัส → ตกทอดจากแผนกแม่ (ทีม 24 โหนดในผังจริงไม่มีรหัสเลย)', () => {
  const r = cc.ccOfNode('t1');
  assert.equal(r.cc, '2140561001');
  assert.equal(r.inherited, true);
  assert.equal(r.reason, 'inherited');
});

test('แผนกไม่มีรหัส → ตกทอดจากส่วนงานแม่', () => {
  assert.equal(cc.ccOfNode('d1b').cc, '2140461000');
});

test('มีรหัสของตัวเอง → ไม่ตกทอด', () => {
  const r = cc.ccOfNode('d1');
  assert.equal(r.cc, '2140561001');
  assert.equal(r.inherited, false);
});

test('🔴 ไล่ขึ้นไม่เจอรหัสเลย / ไม่มีโหนด = cc null (fail-closed) ห้ามคืนค่าเดา', () => {
  const lone = buildCcIndex([{ id: 'a', kind: 'section', name: 'X', parent_id: null, cost_center: null, is_active: true }]);
  assert.equal(lone.ccOfNode('a').cc, null);
  assert.equal(lone.ccOfNode('a').reason, 'no_cc_in_chain');
  assert.equal(lone.ccOfNode('ไม่มีจริง').cc, null);
});

test('ทะเบียนบอกโหนดกำพร้า (แม่ไม่อยู่ในผัง) — ต้องโผล่ ห้ามหายเงียบ', () => {
  const row = cc.catalog().find(r => r.cc === '2140599999');
  assert.ok(row, 'รหัสของโหนดกำพร้าต้องยังอยู่ในทะเบียน');
  assert.equal(row.orphan, true);
  assert.equal(cc.catalog().filter(r => !r.orphan).length, 4);   // 2 ส่วนงาน + 2 แผนกที่มีรหัส
});

/* ═══ ② ขอบเขตที่แก้ได้ ═══ */
test('รหัสที่รับผิดชอบ → แปลงเป็น "หน่วยเจ้าของ" ไม่ใช่เก็บเป็นเลขลอยๆ', () => {
  const [s] = respScopesOf(index, { respCostCenters: ['2140461000'] });
  assert.deepEqual(s, { kind: 'section', value: 'PD1' });
});

test('ว่าง → ถอยไปใช้ profiles.section (ของเดิมไม่พังระหว่างเปลี่ยนผ่าน)', () => {
  assert.deepEqual(respScopesOf(index, { respCostCenters: [], section: 'PD2' }), [{ kind: 'section', value: 'PD2' }]);
  assert.deepEqual(respScopesOf(index, {}), []);
});

test('ใบผ่าน scope:all_units / admin → ทั้งโรงงาน', () => {
  assert.equal(respScopesOf(index, { allUnits: true }).length, 1);
  assert.ok(respScopesOf(index, { role: 'admin' })[0].kind === 'plant');
});

/* ═══ ③ ลำดับชั้น — โจทย์หลักของ user ═══ */
test('⭐ รับผิดชอบชั้นส่วนงาน ⇒ แก้ของแผนกลูกได้ (ได้ทั้งหมดลงไป)', () => {
  const ctx = { respCostCenters: ['2140461000'] };            // PD1
  assert.equal(canWriteScope(index, ctx, { kind: 'section', value: 'PD1' }).ok, true);
  assert.equal(canWriteScope(index, ctx, { kind: 'cost_center', value: '2140561001' }).ok, true);  // BIG PRESS
});

test('⭐ รับผิดชอบชั้นแผนก ⇒ แก้ของส่วนงานแม่ไม่ได้ (ขึ้นไม่ได้)', () => {
  const ctx = { respCostCenters: ['2140561001'] };            // BIG PRESS
  const r = canWriteScope(index, ctx, { kind: 'section', value: 'PD1' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'other_unit');
});

test('🔴 ข้ามส่วนงานไม่ได้ (PD1 ไปแก้ PD2)', () => {
  const r = canWriteScope(index, { respCostCenters: ['2140461000'] }, { kind: 'section', value: 'PD2' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'other_unit');
});

test('🔴🔴 ห้ามไล่ลำดับชั้นด้วย prefix ของเลข — PD1 ต้องไม่ครอบลูกของ PD2', () => {
  /* ของจริง: PD1 = 2140461000 · ลูกของ PD1 = 2140561001 · ลูกของ PD2 = 2140571000
     ถ้าใครเขียน LIKE '21405%' จะเหมาว่า PD1 ครอบ 2140571000 ด้วย = ผิด */
  const r = canWriteScope(index, { respCostCenters: ['2140461000'] }, { kind: 'cost_center', value: '2140571000' });
  assert.equal(r.ok, false, 'PD1 ต้องไม่ครอบ Assy A-GM ที่อยู่ใต้ PD2');
});

test('ไม่รู้ว่าแถวเป็นของหน่วยไหน = fail-closed (ของกลาง) · สั่ง allow ได้เมื่อจำเป็น', () => {
  const ctx = { respCostCenters: ['2140461000'] };
  assert.equal(canWriteScope(index, ctx, null).ok, false);
  assert.equal(canWriteScope(index, ctx, null).code, 'unknown_target');
  assert.equal(canWriteScope(index, ctx, null, { unknownTarget: 'allow' }).ok, true);
});

test('ไม่มีหน่วยสังกัดเลย = แก้ไม่ได้ และข้อความต้องบอกทางแก้', () => {
  const r = canWriteScope(index, {}, { kind: 'section', value: 'PD1' });
  assert.equal(r.code, 'no_home_unit');
  assert.match(ccBlockText(r), /admin/);
});

test('ข้อความบล็อกต้องไม่พูดว่า "ผิดพลาด" — ของหน่วยอื่นคือขอบเขตปกติ', () => {
  const t = ccBlockText({ code: 'other_unit' }, { what: 'KPI', unitText: 'PD2' });
  assert.match(t, /หน่วยงานอื่น/);
  assert.match(t, /ดูได้ แต่แก้ไม่ได้/);
});

test('รหัสที่กรอกไว้แต่ผังไม่รู้จัก ต้องรายงาน ห้ามกลืน', () => {
  assert.deepEqual(unknownRespCcs(cc, ['2140461000', '9999999999']), ['9999999999']);
});

/* ═══ ④ กรองแถว — ต้องนับที่ซ่อน ═══ */
test('กรองแถวแล้วต้องบอกว่าซ่อนไปกี่รายการ', () => {
  const rows = [{ sec: 'PD1' }, { sec: 'PD2' }, { sec: 'PD2' }];
  const out = writableByScope(index, { respCostCenters: ['2140461000'] }, rows, r => ({ kind: 'section', value: r.sec }));
  assert.equal(out.rows.length, 1);
  assert.equal(out.hiddenCount, 2);
});
