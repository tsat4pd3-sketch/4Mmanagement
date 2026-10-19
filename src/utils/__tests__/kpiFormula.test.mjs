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

/* ── 19/10 ไฟล์บัญชีจริง + ช่วงเปลี่ยนผ่าน ─────────────────────────────────────────────────────────────── */
import { formulaMonthMode } from '../kpiFormula.js';

test('sale_per_head = Σ Total Sales ม.ค.→เดือนนี้ ÷ กำลังคน ÷ 1e6 (ใบ 5.Manpower: เม.ย. 706.43 ÷ 392 = 1.802) · ขาดเดือนก่อนหน้า = คำนวณไม่ได้', () => {
  const mb = (x) => x * 1_000_000;
  const r = [row('plant', '', 'sale_total', 1, mb(165.71)), row('plant', '', 'sale_total', 2, mb(181.02)), row('plant', '', 'sale_total', 3, mb(227.12)), row('plant', '', 'sale_total', 4, mb(132.58)),
    row('plant', '', 'manpower', 1, 384), row('plant', '', 'manpower', 4, 392),
    row('plant', '', 'sale_total', 6, mb(100)), row('plant', '', 'manpower', 6, 390)];   // พ.ค. ไม่มียอดขาย ⇒ มิ.ย. สะสมไม่ได้
  const base = buildBaseIndex(r);
  const def = { id: 'sph', name: 'Annual Sale Per Head', provider: 'formula', provider_config: { formula: 'sale_per_head' }, scope_kind: 'plant', scope_value: null, unit: 'MB/Head', decimals: 3 };
  const fm = formulaMonths({ def, scope: PLANT, base });
  assert.ok(Math.abs(fm.months[1] - 165.71 / 384) < 1e-6);
  assert.ok(Math.abs(fm.months[4] - 706.43 / 392) < 1e-6, 'ตัวตั้งสะสม 4 เดือน = 706.43 MB');
  assert.equal(fm.inputs[4].sale_total, mb(706.43));
  assert.equal(fm.months[2], null, 'ไม่มีกำลังคน ก.พ.');
  assert.equal(fm.months[6], null, 'พ.ค. ไม่มียอดขาย ⇒ ยอดสะสม มิ.ย. ไม่ครบ ห้ามรวมเฉพาะที่มี');
  assert.deepEqual(fm.missing[6].map(x => x.key), ['sale_total']);
});

test('ตัวแปรประมาณจากทะเบียน (auto) ไม่ทับค่าที่กรอกไว้ — เติมได้แค่ช่องว่าง · formulaMonthMode บอกว่าช่องไหนยังกรอกมือได้', () => {
  const r = [row('plant', '', 'sale_total', 1, 160_000_000), row('plant', '', 'sale_total', 2, 160_000_000)];
  const auto = (sk, v, m) => (v === 'manpower' && sk === 'section:PD1' ? 32 : null);   // ทะเบียน PD1 มี 32 คน (ของจริง ~300)
  const base = buildBaseIndex(r, { auto });
  const def = { id: 'sph1', name: 'Annual Sale Per Head', provider: 'formula', provider_config: { formula: 'sale_per_head' }, scope_kind: 'section', scope_value: 'PD1', unit: 'MB/Head', decimals: 3 };
  const entries = { sph1: { 1: 0.52 } };   // ม.ค. ทีมกรอกค่าจริงไว้ · ก.พ. ว่าง
  const { entries: e2, info } = applyFormulaEntries([def], entries, base, org);
  assert.equal(e2.sph1[1], 0.52, 'ม.ค. ค่ากรอกมือชนะสูตรที่ใช้กำลังคนประมาณ');
  assert.ok(Math.abs(e2.sph1[2] - 320 / 32) < 1e-6, 'ก.พ. ว่าง ⇒ เติมด้วยค่าประมาณ (320 MB สะสม ÷ 32)');
  assert.deepEqual(info.sph1.usedManual, [1]); assert.deepEqual(info.sph1.computed, [2]); assert.deepEqual(info.sph1.approx, [2]);
  assert.equal(formulaMonthMode(info.sph1, 1), 'manual', 'ช่อง ม.ค. ยังกรอกมือได้');
  assert.equal(formulaMonthMode(info.sph1, 2), 'computed');
  assert.equal(formulaMonthMode(info.sph1, 3), 'manual', 'ไม่มีอะไรเลย = กรอกมือได้');
  assert.equal(formulaMonthMode(null, 1), 'manual');
  assert.match(formulaNoteText(info.sph1, 1, { def }), /✍️ ใช้ค่ากรอกมือ — สูตรคำนวณได้ .* แต่ใช้กำลังคนประมาณจากทะเบียน/);
  assert.match(formulaNoteText(info.sph1, 2, { def }), /≈ทะเบียนพนักงาน/);
  // ตัวเลขฐานกรอกมือครบ ⇒ สูตรชนะตามกฎเดิม
  const base2 = buildBaseIndex([...r, row('section', 'PD1', 'manpower', 1, 300)], { auto });
  const o2 = applyFormulaEntries([def], entries, base2, org);
  assert.ok(Math.abs(o2.entries.sph1[1] - 160 / 300) < 1e-6); assert.equal(formulaMonthMode(o2.info.sph1, 1), 'computed');
});
