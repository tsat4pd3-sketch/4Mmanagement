import test from 'node:test';
import assert from 'node:assert/strict';
import { scopeMatRows } from '../matScope.js';

/* ผังจริงที่ใช้ทดสอบ (ตรงกับ PD3 ในฐาน 15/09):
     HYDROFORM ── LASER-345 · LASER-789 · HDF1
   LASER-345 ไม่มีพาร์ทของตัวเอง · LASER-789 มี 2 · HYDROFORM มี 5                      */
const LINES = [
  { id: 1, name: 'HYDROFORM',  parent_line_name: null },
  { id: 2, name: 'LASER-345',  parent_line_name: 'HYDROFORM' },
  { id: 3, name: 'LASER-789',  parent_line_name: 'HYDROFORM' },
  { id: 4, name: 'HDF1',       parent_line_name: 'HYDROFORM' },
  { id: 5, name: 'HDF1-CELL',  parent_line_name: 'HDF1' },
];
const row = (mat, line) => ({ mat_no: mat, dr_products: { line_name: line } });
const ROWS = [
  row('90031601', 'HYDROFORM'), row('90031602', 'HYDROFORM'),
  row('20065635', 'LASER-789'), row('20065715', 'LASER-789'),
  row('11111111', 'HDF1'),      row('22222222', 'HDF1-CELL'),
];
const mats = (r) => r.rows.map(x => x.mat_no).sort();

test('ไลน์ที่มีพาร์ทของตัวเอง = เห็นแค่ของตัวเอง (ไม่ติดของไลน์แม่มาด้วย)', () => {
  const r = scopeMatRows(ROWS, LINES, 'LASER-789');
  assert.equal(r.scope, 'own');
  assert.deepEqual(mats(r), ['20065635', '20065715']);
  assert.deepEqual(r.owners, []);
  assert.ok(r.rows.every(x => x._foreign === false));
});

test('🔴 ไลน์พี่น้องต้องไม่โผล่เด็ดขาด — LASER-345 ห้ามเห็นของ LASER-789', () => {
  const r = scopeMatRows(ROWS, LINES, 'LASER-345');
  assert.ok(!mats(r).includes('20065635'), 'ของไลน์พี่น้องหลุดเข้ามา = human error ที่ user ทักไว้');
  assert.ok(!mats(r).includes('20065715'));
});

test('ไลน์ที่ไม่มีของตัวเอง ถอยไปใช้ของไลน์แม่ + ติดป้ายเจ้าของ', () => {
  const r = scopeMatRows(ROWS, LINES, 'LASER-345');
  assert.equal(r.scope, 'parent');
  assert.deepEqual(mats(r), ['90031601', '90031602']);
  assert.deepEqual(r.owners, ['HYDROFORM']);
  assert.ok(r.rows.every(x => x._foreign === true && x._owner === 'HYDROFORM'));
});

test('ของตัวเองชนะของไลน์แม่เสมอ (HDF1 มีของตัวเอง ⇒ ไม่เอาของ HYDROFORM)', () => {
  const r = scopeMatRows(ROWS, LINES, 'HDF1');
  assert.equal(r.scope, 'own');
  assert.deepEqual(mats(r), ['11111111']);
});

test('ไม่มีทั้งของตัวเองและของแม่ ⇒ ถอยไปลูกของตัวเอง (scope family)', () => {
  const noHdf1 = ROWS.filter(r => r.dr_products.line_name !== 'HDF1' && r.dr_products.line_name !== 'HYDROFORM');
  const r = scopeMatRows(noHdf1, LINES, 'HDF1');
  assert.equal(r.scope, 'family');
  assert.deepEqual(mats(r), ['22222222']);
  assert.deepEqual(r.owners, ['HDF1-CELL']);
});

test('ไม่เจออะไรเลย = none (จอต้องขึ้นแบนเนอร์ ไม่ใช่ dropdown ว่าง)', () => {
  assert.equal(scopeMatRows(ROWS, LINES, 'ไลน์ไม่มีในผัง').scope, 'none');
  assert.equal(scopeMatRows([], LINES, 'LASER-345').scope, 'none');
  assert.equal(scopeMatRows(ROWS, LINES, '').scope, 'none');
});

test('lines ยังโหลดไม่เสร็จ แต่ไลน์มีของตัวเอง = ต้องใช้ได้ทันที (ไม่ต้องรอผัง)', () => {
  const r = scopeMatRows(ROWS, [], 'LASER-789');
  assert.equal(r.scope, 'own');
  assert.deepEqual(mats(r), ['20065635', '20065715']);
});

test('เทียบชื่อไลน์แบบ trim + ไม่สนตัวพิมพ์ (ชื่อในฐานมีเว้นวรรคเกินจริง เช่น "Assy  LWR")', () => {
  const r = scopeMatRows([row('X', '  laser-789  ')], LINES, 'LASER-789');
  assert.equal(r.scope, 'own');
});

test('ไม่แก้ของเดิม (pure) — แถวต้นทางต้องไม่ถูกแปะ _owner', () => {
  const src = [row('90031601', 'HYDROFORM')];
  scopeMatRows(src, LINES, 'LASER-345');
  assert.equal(src[0]._owner, undefined);
});
