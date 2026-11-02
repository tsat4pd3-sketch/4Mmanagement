/* 👁️ viewScope — ขอบเขต "ที่เห็นได้" ตัดสินผ่านผัง (2026-10-22) */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOrgScope } from '../orgScope.js';
import { buildViewScope, empScopeOrFilter } from '../viewScope.js';

const nodes = [
  { id: 's1', kind: 'section',    name: 'PD1', code: 'PD1', parent_id: null },
  { id: 'd1', kind: 'department', name: 'BIG PRESS',   code: null, parent_id: 's1' },
  { id: 'd2', kind: 'department', name: 'SMALL PRESS', code: null, parent_id: 's1' },
  { id: 'l1', kind: 'line', name: 'LINE A ( 800 Ton )', parent_id: 'd1', ref_line_id: 17 },
  { id: 'l2', kind: 'line', name: 'LINE C ( 200&250 Ton )', parent_id: 'd2', ref_line_id: 19 },
  { id: 'l3', kind: 'line', name: 'LINE D ( 110&300 Ton )', parent_id: 'd2', ref_line_id: 20 },
];
const lines = [
  { id: 17, name: 'LINE A ( 800 Ton )', section: 'PD1', is_active: true },
  { id: 19, name: 'LINE C ( 200&250 Ton )', section: 'PD1', is_active: true },
  { id: 20, name: 'LINE D ( 110&300 Ton )', section: 'PD1', is_active: true },
];
const idx = buildOrgScope({ nodes, lines });
const nameOfLine = (id) => lines.find(l => l.id === id)?.name || null;

test('ขอบเขตระดับ "แผนก" เห็นเฉพาะไลน์ใต้แผนกนั้น (เคสพี่เสวก 250+300 ไม่ติด 800)', () => {
  const vs = buildViewScope(['SMALL PRESS'], idx);
  assert.equal(vs.limited, true);
  assert.equal(vs.byOrg, true);
  assert.equal(vs.lineOk('LINE C ( 200&250 Ton )'), true);
  assert.equal(vs.lineOk('LINE D ( 110&300 Ton )'), true);
  assert.equal(vs.lineOk('LINE A ( 800 Ton )'), false);
  // พนักงานที่ผูกแผนกตรง หรืออยู่ไลน์ใต้แผนก = เห็น
  assert.equal(vs.empOk({ department: 'SMALL PRESS' }, nameOfLine), true);
  assert.equal(vs.empOk({ line_id: 19 }, nameOfLine), true);
  assert.equal(vs.empOk({ line_id: 17 }, nameOfLine), false);
});

test('ขอบเขตระดับส่วนงาน = พฤติกรรมเดิม (เห็นทุกไลน์ในส่วน)', () => {
  const vs = buildViewScope(['PD1'], idx);
  assert.equal(vs.lineOk({ name: 'LINE A ( 800 Ton )', section: 'PD1' }), true);
  assert.equal(vs.empOk({ section: 'PD1' }, nameOfLine), true);
});

test('🔴 ชื่อที่ผังไม่รู้จัก = คงพฤติกรรมเดิม (เทียบข้อความ) ห้ามบีบให้แคบเงียบ', () => {
  const vs = buildViewScope(['ส่วนงานเก่าที่ไม่มีในผัง'], idx);
  assert.deepEqual(vs.unknownNames, ['ส่วนงานเก่าที่ไม่มีในผัง']);
  assert.equal(vs.empOk({ section: 'ส่วนงานเก่าที่ไม่มีในผัง' }, nameOfLine), true);
  assert.equal(vs.byOrg, false);
});

test('ไม่จำกัด = เห็นทั้งหมด · ไม่มีดัชนีผัง = ถอยไปแกนข้อความ', () => {
  const none = buildViewScope([], idx);
  assert.equal(none.limited, false);
  assert.equal(none.empOk({ section: 'อะไรก็ได้' }), true);
  const noIdx = buildViewScope(['SMALL PRESS'], null);
  assert.equal(noIdx.byOrg, false);
  assert.equal(noIdx.empOk({ section: 'SMALL PRESS' }), true);
});

test('empScopeOrFilter — ครอบค่าด้วย " เพราะชื่อหน่วยมีเว้นวรรค', () => {
  const vs = buildViewScope(['PD1', 'SMALL PRESS'], idx);
  const f = empScopeOrFilter(vs);
  assert.match(f, /section\.in\.\("PD1"\)/);
  assert.match(f, /department\.in\.\("SMALL PRESS"\)/);
  assert.equal(empScopeOrFilter(buildViewScope([], idx)), null);
});
