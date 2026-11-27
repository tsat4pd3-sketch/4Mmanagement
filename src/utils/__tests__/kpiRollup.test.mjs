/* ⬆ รวม KPI ของหน่วยลูกขึ้นแม่ (2026-10-12 · user: "ลูกมี แม่ไม่มี ต้องโชว์ที่แม่ด้วย") — pure · ไม่แตะเวลาปัจจุบัน */
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupChildDefs, rollupChildDefs, rollupGroupKey, fillParentWithChildren, childGroupKeyFor } from '../kpiRollup.js';
import { pickBoardRows } from '../kpiBoardRows.js';
import { buildOrgScope, scopeUnder, scopePathText } from '../orgScope.js';

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
  // 15/10: CC ที่เจ้าของ = หน่วยที่เลือก คือ "ตัวเอง" ไม่ใช่ลูก (เดิม true ⇒ KPI ของหน่วยถูกรายงานเป็น "ค่ารวมจากหน่วยลูก" ของตัวเอง)
  assert.equal(scopeUnder(ix, { kind: 'cost_center', value: '2140561001' }, { kind: 'department', value: 'BIG PRESS' }), false);
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

test('fillParentWithChildren: แม่ชนะรายเดือน · เดือนแม่ว่างเติมจากลูก · แม่กรอก 0 = กรอกแล้ว · ไม่บวกแม่+ลูก', () => {
  const roll = { entries: { 1: 2, 2: 2, 3: 5 } };
  const fx = fillParentWithChildren({ 1: 2, 2: '', 4: 0 }, roll);
  assert.deepEqual(fx.entries, { 1: 2, 2: 2, 3: 5, 4: 0 });   // ม.ค. แม่ 2 (ไม่ใช่ 4) · ก.พ./มี.ค. เติมจากลูก · เม.ย. แม่กรอก 0 คงไว้
  assert.deepEqual(fx.filled, [2, 3]);
  assert.deepEqual(fx.covered, [1]);
  assert.deepEqual(fillParentWithChildren({ 5: 9 }, null), { entries: { 5: 9 }, filled: [], covered: [] });
});

test('childGroupKeyFor: ทะเบียนเดียวกับนิยามแม่ก่อน · ช่องมาตรฐานเทียบ board_slot/ชื่อ · แผ่น def: ของแม่ไม่เทียบชื่อ', () => {
  const rm = cat('c-rm', 'Raw Material Control', 'average', { board_slot: 'rm' });
  const other = cat('c-x', '%RM (Raw Material)', 'average');
  const g = groupChildDefs([def(1, 'department', 'BIG', rm), def(2, 'department', 'SMALL', other)]);
  assert.equal(childGroupKeyFor(g, { key: 'rm', name: '%RM (Raw Material)' }, def(9, 'section', 'PD1', rm)), 'cat:c-rm');
  assert.equal(childGroupKeyFor(g, { key: 'rm', name: '%RM (Raw Material)' }, null), 'cat:c-rm');   // board_slot ชนะชื่อ
  assert.equal(childGroupKeyFor(g, { key: 'def:9', name: 'Kaizen', defId: 9 }, def(9, 'section', 'PD1', cat('c-kz', 'Kaizen', 'sum'))), null);
  assert.equal(childGroupKeyFor(new Map(), { key: 'rm', name: 'x' }, null), null);
});

test('scopePathText: หน่วย = เส้นทางผัง · CC = เส้นทางเจ้าของ › 💰 รหัส · โรงงาน = ป้ายที่ส่ง', () => {
  const ix = buildOrgScope({ nodes, lines });
  assert.equal(scopePathText(ix, { kind: 'plant', value: '' }, 'ทุกส่วนงาน'), 'ทุกส่วนงาน');
  assert.equal(scopePathText(ix, { kind: 'department', value: 'BIG PRESS' }), 'PD1 › BIG PRESS');
  assert.match(scopePathText(ix, { kind: 'cost_center', value: '2140561001' }), /^PD1 › BIG PRESS(?: › LINE A)? › 💰 2140561001/);
  assert.match(scopePathText(ix, { kind: 'cost_center', value: '999' }), /ผังยังไม่ผูกหน่วย › 💰 999/);
});

/* ⬆ 25/11 รวมข้ามหน่วยแบบสูตร (user: "DL-OH ระดับโรงงานต้องรวมทุกส่วนที่มีข้อมูล") — Σ ตัวตั้งของลูก ÷ ค่ากลาง ไม่ใช่เฉลี่ย % */
import { rollupModeOf } from '../kpiRollup.js';
test('rollupModeOf: ทะเบียนตั้งเองชนะ · สูตร = formula · sum = sum · อื่น = average', () => {
  const fx = { provider: 'formula', provider_config: { formula: 'dloh_pct' }, kpi_catalog: cat('c9', 'DL+OH', 'average') };
  assert.equal(rollupModeOf(fx), 'formula');
  assert.equal(rollupModeOf({ kpi_catalog: cat('c1', 'Scrap', 'sum') }), 'sum');
  assert.equal(rollupModeOf({ kpi_catalog: cat('c2', 'Rework', 'average') }), 'average');
  assert.equal(rollupModeOf({ kpi_catalog: cat('c3', 'DSI', 'as_of', { rollup_mode: 'sum' }) }), 'sum');
  assert.equal(rollupModeOf({ provider: 'formula', provider_config: { formula: 'dloh_pct' }, kpi_catalog: cat('c9', 'DL+OH', 'average', { rollup_mode: 'average' }) }), 'average');
});

test('rollupChildDefs formula: Σ dl+oh ของหน่วยที่มีข้อมูล ÷ sale_product (ค่ากลาง) · เดือนที่ไม่มีตัวแปรข้าม · ไม่มี formulaInfoOf = ถอยไปเฉลี่ย ≈', () => {
  const c = cat('c9', 'DL+OH (Direct Labor + Overhead)', 'average');
  const mk = (id, sv) => def(id, 'section', sv, c, { provider: 'formula', provider_config: { formula: 'dloh_pct' }, target_value: 1, target_compare: '<=', direction: 'down' });
  const ds = [mk(1, 'PD1'), mk(2, 'PD2'), mk(3, 'PD3')];
  const infos = {
    1: { inputs: { 1: { dl: 800000, oh: 200000, sale_product: 100e6 }, 2: { dl: 900000, oh: 100000, sale_product: 120e6 } } },
    2: { inputs: { 1: { dl: 400000, oh: 100000, sale_product: 100e6 } } },
    3: { inputs: {} },   // ยังไม่กรอก = ไม่เข้ารวม (ไม่ใช่ 0)
  };
  const ent = { 1: { 1: 1.0, 2: 0.8333 }, 2: { 1: 0.5 } };   // % ที่รางสูตรคิดไว้รายหน่วย — ถ้าเฉลี่ยจะได้ 0.75 (ผิด)
  const r = rollupChildDefs(ds, ent, { formulaInfoOf: (d) => infos[d.id] });
  assert.equal(r.combine, 'formula'); assert.equal(r.approx, false); assert.equal(r.formulaKey, 'dloh_pct');
  assert.ok(Math.abs(r.entries[1] - 1.5) < 1e-9);          // (800k+200k+400k+100k) ÷ 100 MB × 100 = 1.5 %
  assert.ok(Math.abs(r.entries[2] - (1e6 / 120e6 * 100)) < 1e-9);
  assert.deepEqual(r.coverage[1], { n: 2, of: 3 }); assert.deepEqual(r.coverage[2], { n: 1, of: 3 });
  assert.deepEqual(r.partial, [1, 2]);
  const avg = rollupChildDefs(ds, ent, {});
  assert.equal(avg.combine, 'average'); assert.equal(avg.approx, true); assert.ok(Math.abs(avg.entries[1] - 0.75) < 1e-9);
});
