import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePpe, ppeLayerKeys, ppeStatusOf, legacyPatchOf } from '../ppeRequirements.js';

const ITEMS = [
  { id: 1, code: 'safety_helmet',  name_th: 'หมวก',    legacy_col: 'has_helmet', sort_order: 10 },
  { id: 2, code: 'safety_shoes',   name_th: 'รองเท้า',  legacy_col: 'has_boots',  sort_order: 20 },
  { id: 3, code: 'safety_gloves',  name_th: 'ถุงมือ',   legacy_col: 'has_gloves', sort_order: 30 },
  { id: 4, code: 'safety_glasses', name_th: 'แว่นตา',   legacy_col: null,         sort_order: 40 },
  { id: 5, code: 'apron',          name_th: 'ผ้ากันเปื้อน', legacy_col: null,     sort_order: 70 },
  { id: 6, code: 'retired',        name_th: 'เลิกใช้',  legacy_col: null, sort_order: 90, is_active: false },
];
// แม่ 10 → ลูก 11 → หลาน 12
const LINES = [
  { id: 10, name: 'LINE A',   section: 'PD1', parent_line_name: null },
  { id: 11, name: 'LINE A-1', section: 'PD1', parent_line_name: 'LINE A' },
  { id: 12, name: 'LINE A-2', section: 'PD1', parent_line_name: 'LINE A-1' },
];
const PLANT = [1, 2, 3].map(id => ({ scope_kind: 'plant', scope_key: '*', item_id: id, required: true }));

test('ค่าพื้นฐานทั้งโรงงานตกทอดถึงทุกไลน์', () => {
  const r = resolvePpe({ items: ITEMS, reqs: PLANT, section: 'PD1', lineId: 12, lines: LINES });
  assert.deepEqual(r.required.map(i => i.code), ['safety_helmet', 'safety_shoes', 'safety_gloves']);
  assert.equal(r.unknown, false);
  assert.equal(r.sourceOf.get('1').kind, 'plant');
});

test('ไลน์เพิ่มของตัวเองได้ (ผ้ากันเปื้อน) และตกทอดลงไลน์ลูก', () => {
  const reqs = [...PLANT, { scope_kind: 'line', scope_key: '10', item_id: 5, required: true }];
  const kid = resolvePpe({ items: ITEMS, reqs, section: 'PD1', lineId: 12, lines: LINES });
  assert.ok(kid.required.some(i => i.code === 'apron'), 'ไลน์หลานต้องได้ผ้ากันเปื้อนจากไลน์แม่');
  assert.equal(kid.sourceOf.get('5').kind, 'line');
  const other = resolvePpe({ items: ITEMS, reqs, section: 'PD1', lineId: null, lines: LINES });
  assert.ok(!other.required.some(i => i.code === 'apron'), 'ไลน์อื่นต้องไม่ได้');
});

test('🔴 ชั้นล่างชนะชั้นบน — ไลน์ลูกยกเว้นของที่ไลน์แม่บังคับได้', () => {
  const reqs = [...PLANT,
    { scope_kind: 'line', scope_key: '10', item_id: 5, required: true },
    { scope_kind: 'line', scope_key: '12', item_id: 5, required: false }];
  const kid = resolvePpe({ items: ITEMS, reqs, section: 'PD1', lineId: 12, lines: LINES });
  assert.ok(!kid.required.some(i => i.code === 'apron'), 'ไลน์หลานยกเว้นแล้วต้องไม่บังคับ');
  assert.ok(kid.excluded.some(i => i.code === 'apron'), 'ต้องโผล่ใน excluded ให้จอตั้งค่าเห็นว่าถูกยกเว้น');
  const parent = resolvePpe({ items: ITEMS, reqs, section: 'PD1', lineId: 10, lines: LINES });
  assert.ok(parent.required.some(i => i.code === 'apron'), 'ไลน์แม่ต้องไม่ถูกกระทบ');
});

test('จุดงานชนะไลน์ · ส่วนงานชนะทั้งโรงงาน', () => {
  const reqs = [...PLANT,
    { scope_kind: 'section', scope_key: 'PD1', item_id: 4, required: true },
    { scope_kind: 'line',    scope_key: '12',  item_id: 4, required: false },
    { scope_kind: 'station', scope_key: 'ST-9', item_id: 4, required: true }];
  const noSt = resolvePpe({ items: ITEMS, reqs, section: 'PD1', lineId: 12, lines: LINES });
  assert.ok(!noSt.required.some(i => i.code === 'safety_glasses'), 'ไลน์ยกเว้นแว่นตาที่ส่วนงานตั้งไว้');
  const withSt = resolvePpe({ items: ITEMS, reqs, section: 'PD1', lineId: 12, lines: LINES, stationId: 'ST-9' });
  assert.ok(withSt.required.some(i => i.code === 'safety_glasses'), 'จุดงานเปิดกลับได้');
  assert.equal(withSt.sourceOf.get('4').kind, 'station');
});

test('🔴 อ่านทะเบียนไม่ได้ = unknown ห้ามคืน "ไม่ต้องใส่อะไรเลย"', () => {
  for (const bad of [{ items: null, reqs: [] }, { items: ITEMS, reqs: null }, {}]) {
    const r = resolvePpe({ ...bad, lineId: 12, lines: LINES });
    assert.equal(r.unknown, true);
    assert.deepEqual(r.required, []);
  }
});

test('รายการที่ปิดใช้งานไม่ขึ้น แม้มีแถวบังคับค้างอยู่', () => {
  const reqs = [...PLANT, { scope_kind: 'plant', scope_key: '*', item_id: 6, required: true }];
  const r = resolvePpe({ items: ITEMS, reqs, lineId: 10, lines: LINES });
  assert.ok(!r.required.some(i => i.code === 'retired'));
});

test('ลำดับชั้นของไลน์: ไม่รู้จักไลน์ = ใช้แค่ชั้นบน ไม่โยน', () => {
  assert.deepEqual(ppeLayerKeys({ section: 'PD1', lineId: 999, lines: LINES }), [['plant', '*'], ['section', 'PD1']]);
  assert.deepEqual(ppeLayerKeys({}), [['plant', '*']]);
});

test('🔴 ppeStatusOf: ยังไม่ตรวจ = none ไม่ใช่ "ไม่ผ่าน"', () => {
  const req = [ITEMS[0], ITEMS[1]];
  assert.equal(ppeStatusOf(req, null).state, 'none');
  assert.equal(ppeStatusOf(req, []).state, 'none');
  assert.equal(ppeStatusOf(req, [{ item_id: 1, ok: true }]).state, 'partial');
  assert.equal(ppeStatusOf(req, [{ item_id: 1, ok: true }, { item_id: 2, ok: true }]).state, 'ok');
  const miss = ppeStatusOf(req, [{ item_id: 1, ok: true }, { item_id: 2, ok: false }]);
  assert.equal(miss.state, 'missing');
  assert.deepEqual(miss.missingItems.map(i => i.code), ['safety_shoes']);
  assert.equal(ppeStatusOf([], null).state, 'ok', 'ไม่บังคับอะไรเลย = ไม่ต้องค้าง');
});

test('legacyPatchOf ซิงก์เฉพาะรายการที่ผูกคอลัมน์เดิม', () => {
  assert.deepEqual(legacyPatchOf(ITEMS, { 1: true, 2: false, 5: true }),
    { has_helmet: true, has_boots: false, has_gloves: false });
  assert.deepEqual(legacyPatchOf([ITEMS[4]], { 5: true }), {}, 'ผ้ากันเปื้อนไม่มีคอลัมน์เดิม');
});
