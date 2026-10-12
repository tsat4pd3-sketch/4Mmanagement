/* เทส filterRowsByLineScope — ตัวกรอง "ขอบเขตไลน์" ของหน้าที่โชว์ยอดรายไลน์
   โจทย์จาก QC audit รอบ 4 (2026-10-09 · `/line-stock` ป้ายเขียน "ในสิทธิ์ที่เห็น" แต่ไม่กรองจริง):
   1. ไม่จำกัด (null/ว่าง) = คืนของเดิมทั้งก้อน ไม่แตะอะไร
   2. ในขอบเขต = เหลือ · นอกขอบเขตแต่ **อยู่ในทะเบียนไลน์** = ซ่อน + นับไว้
   3. 🔴 ไม่อยู่ในทะเบียนไลน์ (คลัง STORE/FG WAREHOUSE) = **ตัดสินไม่ได้ ⇒ ห้ามซ่อน** + รายงานชื่อ
   4. ทะเบียนยังไม่โหลด = ไม่ซ่อนอะไรเลย (fail-open) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterRowsByLineScope } from '../sectionScope.js';

const REG = ['Line 60', 'Line 61', 'ASSEMBLY 1', 'LINE A ( 800 Ton )'];
const ROWS = [
  { line_name: 'Line 60',            mat_no: 'A' },
  { line_name: 'Line 61',            mat_no: 'B' },
  { line_name: 'ASSEMBLY 1',         mat_no: 'C' },
  { line_name: 'STORE',              mat_no: 'D' },   // ไม่ใช่ไลน์ — วัดจริง 119 แถว
  { line_name: 'FG WAREHOUSE',       mat_no: 'E' },   // ไม่ใช่ไลน์ — วัดจริง 73 แถว
];

test('ไม่จำกัดขอบเขต (null) = คืนของเดิมทั้งก้อน', () => {
  const r = filterRowsByLineScope(ROWS, { scopedNames: null, lineNames: REG });
  assert.equal(r.rows.length, 5);
  assert.equal(r.hidden, 0);
  assert.deepEqual(r.offRegistry, []);
  assert.equal(r.rows, ROWS, 'ต้องคืน array เดิม ไม่ copy (กัน re-render ไม่จำเป็น)');
});

test('ขอบเขตว่าง ([]) = ไม่จำกัด เหมือน null (กฎ UserContext.sections)', () => {
  const r = filterRowsByLineScope(ROWS, { scopedNames: [], lineNames: REG });
  assert.equal(r.rows.length, 5);
  assert.equal(r.hidden, 0);
});

test('นอกขอบเขตแต่อยู่ในทะเบียน = ซ่อน + นับ · คลังที่ไม่ใช่ไลน์ = ยังโชว์', () => {
  const r = filterRowsByLineScope(ROWS, { scopedNames: ['Line 60', 'Line 61'], lineNames: REG });
  assert.deepEqual(r.rows.map(x => x.mat_no), ['A', 'B', 'D', 'E']);
  assert.equal(r.hidden, 1, 'ASSEMBLY 1 อยู่ในทะเบียนแต่นอกขอบเขต ⇒ ซ่อน 1 แถว');
  assert.deepEqual(r.offRegistry.sort(), ['FG WAREHOUSE', 'STORE']);
});

test('🔴 ทะเบียนไลน์ยังไม่โหลด = ตัดสินไม่ได้ทุกแถว ⇒ ห้ามซ่อนอะไรเลย', () => {
  const r = filterRowsByLineScope(ROWS, { scopedNames: ['Line 60'], lineNames: [] });
  assert.equal(r.rows.length, 5);
  assert.equal(r.hidden, 0);
});

test('เทียบชื่อแบบ normalize (เคส/ช่องว่าง) — section/line เป็น text พิมพ์มือ', () => {
  const rows = [{ line_name: '  line 60 ' }, { line_name: 'LINE 61' }];
  const r = filterRowsByLineScope(rows, { scopedNames: ['Line 60'], lineNames: ['Line 60', 'Line 61'] });
  assert.equal(r.rows.length, 1);
  assert.equal(r.hidden, 1);
});

test('แถวที่ไม่มีชื่อไลน์เลย = ตัดสินไม่ได้ ⇒ โชว์ + ขึ้นในรายการที่ตรวจไม่ได้', () => {
  const r = filterRowsByLineScope([{ line_name: null }], { scopedNames: ['Line 60'], lineNames: REG });
  assert.equal(r.rows.length, 1);
  assert.equal(r.hidden, 0);
  assert.deepEqual(r.offRegistry, ['(ไม่ระบุไลน์)']);
});

test('nameOf กำหนดเองได้ (ตารางที่เก็บชื่อไลน์คนละคอลัมน์)', () => {
  const r = filterRowsByLineScope([{ to_line: 'Line 60' }, { to_line: 'ASSEMBLY 1' }],
    { scopedNames: ['Line 60'], lineNames: REG, nameOf: (x) => x.to_line });
  assert.equal(r.rows.length, 1);
  assert.equal(r.hidden, 1);
});

test('ซ่อนหมดได้จริง — แต่ `hidden` ต้องบอกจำนวน ให้จอเขียนได้ว่าทำไมว่าง', () => {
  const r = filterRowsByLineScope([{ line_name: 'ASSEMBLY 1' }],
    { scopedNames: ['Line 60'], lineNames: REG });
  assert.equal(r.rows.length, 0);
  assert.equal(r.hidden, 1);
});
