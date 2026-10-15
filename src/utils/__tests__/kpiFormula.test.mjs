/* 🧮 KPI การเงินจากตัวเลขฐาน (15/10) — ยอดขายกลางของโรงงาน ÷ ยอดเงินของหน่วย · ขาด = null ไม่ใช่ 0 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBaseIndex, formulaMonths, applyFormulaEntries, formulaNoteText, formulaSummaryText, baseScopeForVar, baseScopeColumns, formulaOfDef, BASE_VARS_BY_LEVEL } from '../kpiFormula.js';
import { buildOrgScope, PLANT } from '../orgScope.js';
import { KPI_BASE_VARS } from '../kpiSetup.js';

const nodes = [
  { id: 'pd1', kind: 'section', code: 'PD1', name: 'PD1', parent_id: null, division: 'production', sort_order: 1, is_active: true, cost_center: '2140461000' },
  { id: 'pd2', kind: 'section', code: 'PD2', name: 'PD2', parent_id: null, division: 'production', sort_order: 2, is_active: true },
];
const org = buildOrgScope({ nodes, lines: [] });
const row = (sk, sv, var_key, month, value) => ({ id: `${sk}-${sv}-${var_key}-${month}`, year: 2026, month, scope_kind: sk, scope_value: sv, var_key, value });
const rows = [
  row('plant', '', 'sale_product', 1, 150_000_000), row('plant', '', 'sale_product', 2, 120_000_000), row('plant', null, 'sale_total', 1, 160_000_000),
  row('section', 'PD1', 'dl', 1, 1_200_000), row('section', 'PD1', 'oh', 1, 800_000),
  row('section', 'PD1', 'dl', 2, 1_000_000),                         // ก.พ. ขาด oh
  row('section', 'PD1', 'dl', 3, 900_000), row('section', 'PD1', 'oh', 3, 100_000),   // มี.ค. ขาดยอดขาย (plant)
  row('plant', '', 'dl', 1, 5_000_000), row('plant', '', 'oh', 1, 3_000_000),
];
const dlohDef = (scope_kind, scope_value) => ({ id: `d-${scope_value || 'plant'}`, name: 'DL+OH', provider: 'formula', provider_config: { formula: 'dloh_pct' }, scope_kind, scope_value, unit: '%', decimals: 4 });

test('ตัวแปรระดับโรงงานทุกตัวมี level plant · ตัวแปรหน่วยไม่มี · plant var อ่านจาก plant เสมอแม้นิยามอยู่หน่วย', () => {
  assert.ok(KPI_BASE_VARS.every(v => v.level === 'plant' || v.level === 'unit'));
  assert.deepEqual(BASE_VARS_BY_LEVEL.plant.map(v => v.key), ['sale_total', 'sale_product', 'sale_trading', 'cogs', 'days_in_month']);
  assert.equal(baseScopeForVar('sale_product', { kind: 'section', value: 'PD1' }), 'plant');
  assert.equal(baseScopeForVar('dl', { kind: 'section', value: 'PD1' }), 'section:PD1');
  assert.equal(baseScopeForVar('dl', PLANT), 'plant');
  assert.deepEqual(baseScopeColumns(PLANT), { scope_kind: 'plant', scope_value: '' });
});

test('formulaMonths: DL+OH ของ PD1 = (dl+oh) ÷ ยอดขายโรงงาน × 100 · ขาดตัวแปรไหนเดือนนั้น null + บอกว่าขาดอะไรที่ไหน', () => {
  const base = buildBaseIndex(rows);
  const r = formulaMonths({ def: dlohDef('section', 'PD1'), scope: { kind: 'section', value: 'PD1' }, base });
  assert.ok(Math.abs(r.months[1] - (2_000_000 / 150_000_000 * 100)) < 1e-9);
  assert.equal(r.months[2], null); assert.deepEqual(r.missing[2].map(x => `${x.key}@${x.scope}`), ['oh@section:PD1']);
  assert.equal(r.months[3], null); assert.deepEqual(r.missing[3].map(x => `${x.key}@${x.scope}`), ['sale_product@plant']);
  assert.equal(r.months[4], null);
  // นิยามระดับโรงงานใช้ dl/oh ของโรงงานเอง (ไม่ใช่ของ PD1)
  const p = formulaMonths({ def: dlohDef('plant', null), scope: PLANT, base });
  assert.ok(Math.abs(p.months[1] - (8_000_000 / 150_000_000 * 100)) < 1e-9);
  // นิยามที่รหัส CC ของ PD1 = อ่านตัวเลขของ PD1 (canonical)
  const c = applyFormulaEntries([dlohDef('cost_center', '2140461000')], {}, base, org);
  assert.ok(Math.abs(c.entries['d-2140461000'][1] - (2_000_000 / 150_000_000 * 100)) < 1e-9);
});

test('applyFormulaEntries: สูตรชนะค่ากรอกมือ · คำนวณไม่ได้แต่กรอกมือไว้ = ใช้ค่ากรอกมือ + ติดป้าย · นิยามไม่ใช่สูตรไม่แตะ', () => {
  const base = buildBaseIndex(rows);
  const manualDef = { id: 'm1', name: 'Safety', provider: 'manual', scope_kind: 'section', scope_value: 'PD1' };
  const entries = { 'd-PD1': { 1: 9.99, 2: 0.95 }, m1: { 1: 0 } };
  const { entries: e2, info } = applyFormulaEntries([dlohDef('section', 'PD1'), manualDef], entries, base, org);
  assert.ok(Math.abs(e2['d-PD1'][1] - 1.3333333) < 1e-4, 'สูตรชนะ 9.99');
  assert.equal(e2['d-PD1'][2], 0.95, 'ก.พ. คำนวณไม่ได้ → ใช้ค่ากรอกมือ');
  assert.equal(e2['d-PD1'][3], undefined);
  assert.deepEqual(info['d-PD1'].usedManual, [2]); assert.deepEqual(info['d-PD1'].computed, [1]);
  assert.deepEqual(e2.m1, { 1: 0 }); assert.equal(info.m1, undefined);
  assert.deepEqual(entries['d-PD1'], { 1: 9.99, 2: 0.95 }, 'ไม่แก้ object เดิม');
  assert.match(formulaNoteText(info['d-PD1'], 1, { def: dlohDef('section', 'PD1') }), /ค่าแรงทางตรง 1,200,000 \(section:PD1\)/);
  assert.match(formulaNoteText(info['d-PD1'], 2), /✍️ ใช้ค่ากรอกมือ — สูตรยังขาด ค่าโสหุ้ย/);
  assert.match(formulaNoteText(info['d-PD1'], 3), /ขาดตัวเลขฐาน: ยอดขายจากสินค้า \(Sales from product\) \(ทั้งโรงงาน\)/);
  assert.match(formulaSummaryText(info['d-PD1']), /คำนวณได้ 1 เดือน · ✍️ ใช้ค่ากรอกมือ 1 เดือน · ขาดตัวเลขฐาน 10 เดือน/);
});

test('formulaOfDef: provider ไม่ใช่ formula / สูตรไม่รู้จัก / config เป็น string JSON', () => {
  assert.equal(formulaOfDef({ provider: 'manual', provider_config: { formula: 'dloh_pct' } }), null);
  assert.equal(formulaOfDef({ provider: 'formula', provider_config: { formula: 'nope' } }), null);
  assert.equal(formulaOfDef({ provider: 'formula', provider_config: '{"formula":"rm_pct"}' }), 'rm_pct');
  assert.equal(formulaOfDef(null), null);
  assert.equal(applyFormulaEntries([dlohDef('section', 'PD1')], { x: { 1: 1 } }, null, org).entries.x[1], 1);
});
