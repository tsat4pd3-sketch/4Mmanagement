/* ⬆ รวม KPI ของหน่วยลูกขึ้นแม่ (2026-10-12 · user: "ลูกมี แม่ไม่มี ต้องโชว์ที่แม่ด้วย") — pure · ไม่แตะเวลาปัจจุบัน */
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupChildDefs, rollupChildDefs, rollupGroupKey } from '../kpiRollup.js';
import { pickBoardRows } from '../kpiBoardRows.js';
import { buildOrgScope, scopeUnder, scopeOfDef } from '../orgScope.js';

const cat = (id, name, summary_mode, extra = {}) => ({ id, name, summary_mode, unit: '%', value_scope: 'own', board_slot: null, ...extra });
const def = (id, scope_kind, scope_value, catalog, extra = {}) => ({ id, scope_kind, scope_value, source: 'manual', seq: id, name: catalog.name, catalog_id: catalog.id, kpi_catalog: catalog, is_active: true, ...extra });

test('groupChildDefs: จับกลุ่มตามทะเบียน · ตัด auto และค่าโรงงานร่วม · ไม่มีทะเบียนเทียบชื่อ', () => {
  const scrap = cat('c1', 'Scrap Cost', 'sum');
  const defs = [
    def(1, 'department', 'BIG', scrap), def(2, 'department', 'SMALL', scrap),
    def(3, 'department', 'BIG', cat('c2', 'OEE', 'average'), { source: 'auto:oee' }),
    def(4, 'department', 'BIG', cat('c3', '%RM', 'average', { value_scope: 'plant' })),
    { id: 5, scope_kind: 'line', scope_value: 'LA', source: 'manual', name: 'Rework (%)' },
    { id: 6, scope_kind: 'line', scope_value: 'LB', source: 'manual', name: 'rework %' },
  ];
  const g = groupChildDefs(defs);
  assert.deepEqual([...g.keys()], ['cat:c1', 'name:rework%']);   // normKpiRowName ตัดช่องว่าง/วงเล็บ แต่คง %
  assert.equal(g.get('cat:c1').length, 2);
  assert.equal(g.get('name:rework%').length, 2);
  assert.equal(rollupGroupKey(defs[0]), 'cat:c1');
});

test('rollupChildDefs sum: ผลรวมของลูกที่กรอก · เดือนที่กรอกไม่ครบติด partial · เป้า = ผลรวมเป้า', () => {
  const scrap = cat('c1', 'Scrap Cost', 'sum', { unit: 'พันบาท' });
  const ds = [def(1, 'department', 'BIG', scrap, { target_value: 30, direction: 'down' }), def(2, 'department', 'SMALL', scrap, { target_value: 20, direction: 'down' })];
  const r = rollupChildDefs(ds, { 1: { 1: 10, 2: 12 }, 2: { 1: 5 } }, { labelOf: (k, v) => `${k}:${v}` });
  assert.equal(r.combine, 'sum'); assert.equal(r.approx, false); assert.equal(r.n, 2);
  assert.equal(r.entries[1], 15); assert.equal(r.entries[2], 12); assert.equal(r.entries[3], undefined);
  assert.deepEqual(r.partial, [2]);
  assert.equal(r.def.target_value, 50); assert.equal(r.def.target_compare, '<=');
  assert.equal(r.def.unit, 'พันบาท'); assert.equal(r.targetNote, '');
  assert.deepEqual(r.children.map(c => c.label), ['department:BIG', 'department:SMALL']);
});

test('rollupChildDefs average: เฉลี่ยไม่ถ่วงน้ำหนัก (≈) · เป้าใช้ต่อเมื่อเท่ากันทุกใบ · ไม่เท่ากัน = null + บอกเหตุผล', () => {
  const q = cat('c9', 'Internal Quality', 'average');
  const same = rollupChildDefs([def(1, 'line', 'LA', q, { target_value: 95, direction: 'up' }), def(2, 'line', 'LB', q, { target_value: 95, direction: 'up' })], { 1: { 1: 90 }, 2: { 1: 100 } });
  assert.equal(same.approx, true); assert.equal(same.entries[1], 95); assert.equal(same.def.target_value, 95);
  const diff = rollupChildDefs([def(1, 'line', 'LA', q, { target_value: 95, direction: 'up' }), def(2, 'line', 'LB', q, { target_value: 90, direction: 'up' })], {});
  assert.equal(diff.def.target_value, null); assert.match(diff.targetNote, /ไม่เท่ากัน/);
  const none = rollupChildDefs([def(1, 'line', 'LA', q), def(2, 'line', 'LB', q, { target_value: 90 })], {});
  assert.equal(none.def.target_value, null); assert.match(none.targetNote, /บางใบยังไม่ตั้งเป้า/);
  assert.equal(rollupChildDefs([], {}), null);
});

const nodes = [
  { id: 'pd1', kind: 'section', code: 'PD1', name: 'PD1', parent_id: null, division: 'production', sort_order: 1, is_active: true },
  { id: 'big', kind: 'department', name: 'BIG PRESS', parent_id: 'pd1', sort_order: 2, is_active: true, cost_center: '2140561001' },
  { id: 'la', kind: 'line', name: 'LINE A', parent_id: 'big', ref_line_id: 17, sort_order: 3, is_active: true },
  { id: 'pd2', kind: 'section', code: 'PD2', name: 'PD2', parent_id: null, division: 'production', sort_order: 9, is_active: true },
];
const lines = [{ id: 17, name: 'LINE A', section: 'PD1', parent_line_name: null, is_active: true, cost_center: '2140561001' }];

test('scopeUnder: ลูก/หลานอยู่ใต้แม่ · ตัวเอง/พี่น้อง/บรรพบุรุษ/โรงงานไม่อยู่ใต้ · CC ดูจากเจ้าของ · เลือกทั้งโรงงาน = ทุกหน่วยอยู่ใต้', () => {
  const ix = buildOrgScope({ nodes, lines });
  const PD1 = { kind: 'section', value: 'PD1' };
  assert.equal(scopeUnder(ix, { kind: 'department', value: 'BIG PRESS' }, PD1), true);
  assert.equal(scopeUnder(ix, { kind: 'line_group', value: 'LINE A' }, PD1), true);   // org line node = ตัวเลือก kind line_group (ไลน์ผลิต)
  assert.equal(scopeUnder(ix, PD1, PD1), false);
  assert.equal(scopeUnder(ix, { kind: 'section', value: 'PD2' }, PD1), false);
  assert.equal(scopeUnder(ix, PD1, { kind: 'department', value: 'BIG PRESS' }), false);
  assert.equal(scopeUnder(ix, { kind: 'plant', value: '' }, PD1), false);
  assert.equal(scopeUnder(ix, { kind: 'cost_center', value: '2140561001' }, PD1), true);
  assert.equal(scopeUnder(ix, { kind: 'cost_center', value: '2140561001' }, { kind: 'department', value: 'BIG PRESS' }), true);
  assert.equal(scopeUnder(ix, { kind: 'department', value: 'BIG PRESS' }, { kind: 'plant', value: '' }), true);
});

test('pickBoardRows + childGroups: ช่องมาตรฐานที่ลูกถือแต่แม่ไม่ถือ = แผ่นช่องนั้น (rollup) · กลุ่มนอกช่อง = roll:<key> · แม่มีเองแล้ว = ไม่ซ้ำ', () => {
  const T = [{ key: 'rm', name: '%RM (Raw Material)', auto: null }, { key: 'oee', name: 'OEE', auto: 'oee' }, { key: 'train', name: 'Training', auto: null }];
  const PD1 = { kind: 'section', value: 'PD1' };
  const rmCat = cat('c-rm', '%RM (Raw Material)', 'average', { board_slot: 'rm' });
  const scrapCat = cat('c-scrap', 'Scrap Cost', 'sum');
  const kaizenCat = cat('c-kz', 'Kaizen', 'sum');
  const own = [def(100, 'section', 'PD1', kaizenCat)];   // แม่ตั้ง Kaizen เองแล้ว
  const below = [def(1, 'department', 'BIG PRESS', rmCat), def(2, 'department', 'BIG PRESS', scrapCat), def(3, 'department', 'SMALL PRESS', scrapCat), def(4, 'department', 'BIG PRESS', kaizenCat)];
  const groups = groupChildDefs(below);
  const { rows, fallbackTemplate } = pickBoardRows({
    templates: T, kdefs: own, scope: PD1, hasLines: false, childGroups: groups,
    findManual: (r) => (r.key === 'kz' ? null : null), findAuto: () => null, ownScopes: [PD1],
  });
  assert.equal(fallbackTemplate, false);
  const keys = rows.map(r => r.key);
  assert.deepEqual(keys, ['rm', 'def:100', 'roll:cat:c-scrap']);   // oee ไม่มีไลน์ · train ไม่มีใครถือ · Kaizen แม่มีเอง ไม่ทำแผ่นรวมซ้ำ
  assert.equal(rows[0].rollup, 'cat:c-rm');
  assert.equal(rows[2].childN, 2);
  // ขอบเขตไม่มีนิยามเลยแต่ลูกมี = ไม่ใช่ template เต็ม
  const r2 = pickBoardRows({ templates: T, kdefs: [], scope: PD1, hasLines: false, childGroups: groups, findManual: () => null, findAuto: () => null });
  assert.equal(r2.fallbackTemplate, false);
  assert.deepEqual(r2.rows.map(r => r.key), ['rm', 'roll:cat:c-scrap', 'roll:cat:c-kz']);
  // ไม่ส่ง childGroups = พฤติกรรมเดิมเป๊ะ
  const r3 = pickBoardRows({ templates: T, kdefs: [], scope: PD1, hasLines: false, findManual: () => null, findAuto: () => null });
  assert.equal(r3.fallbackTemplate, true);
  assert.deepEqual(r3.rows.map(r => r.key), ['rm', 'oee', 'train']);
});
