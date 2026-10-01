/* ลำดับมาตรฐานของรายการจากผังองค์กร (2026-10-01 · user: "dropdown ที่ใช้เหมือนกันหลายหน้า อย่าให้มั่ว")
   ข้อมูล = org_nodes จริง (MAIN · 01/10/2026) ย่อเหลือคอลัมน์ที่ใช้ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { naturalCompare, orgNodeCompare, orgValues, sortLike } from '../listOrder.js';
import { deptOptionsFor, orphanDepts } from '../sectionScope.js';

const SECS = [
  { id: 6, code: null, name: 'TEST', sort_order: 60 }, { id: 3, code: 'PD3', name: 'PD3', sort_order: 3 },
  { id: 5, code: 'Planning&Store', name: 'PLN & STO', sort_order: 42 }, { id: 1, code: 'PD1', name: 'PD1', sort_order: 1 },
];
const DEPTS = [
  { name: 'HYDROFORM', parent_id: 3, sort_order: 62 }, { name: 'LINE APRON ASSY', code: 'LINE APRON ASSY', parent_id: 3, sort_order: 61 },
  { name: 'QA', parent_id: null, sort_order: 36 }, { name: 'MTN', parent_id: null, sort_order: 37 },
  { name: 'JIG MTN', parent_id: null, sort_order: 36 }, { name: 'DIE MTN', parent_id: null, sort_order: 36 },
  { name: 'ไม่มีลำดับ', parent_id: null, sort_order: null },
];

test('ผังองค์กร = sort_order ที่ตั้งไว้ → ชื่อธรรมชาติ · ว่าง = ท้าย', () => {
  assert.deepEqual(orgValues(SECS), ['PD1', 'PD3', 'Planning&Store', 'TEST']);
  assert.deepEqual(orphanDepts(DEPTS).map(d => d.name), ['DIE MTN', 'JIG MTN', 'QA', 'MTN', 'ไม่มีลำดับ']);
});

test('แผนกใต้ส่วนงานตามผัง ไม่ใช่ตัวอักษร (เคสจริง PD3) · ไม่ขึ้นกับลำดับ input', () => {
  const want = ['LINE APRON ASSY', 'HYDROFORM'];
  assert.deepEqual(deptOptionsFor('PD3', SECS, DEPTS).map(d => d.name), want);
  assert.deepEqual(deptOptionsFor('PD3', SECS, [...DEPTS].reverse()).map(d => d.name), want);
});

test('sortLike — ตามลำดับผัง · ค่านอกผังต่อท้ายเรียงธรรมชาติ · ตัดว่าง/ซ้ำ', () => {
  assert.deepEqual(sortLike(['TEST', 'X9', 'PD1', 'X10', '', 'PD1', null], ['PD1', 'PD3', 'TEST']), ['PD1', 'TEST', 'X9', 'X10']);
});

test('naturalCompare — เลขเป็นตัวเลข · ไม่สนตัวพิมพ์', () => {
  assert.deepEqual(['PD10', 'pd2', 'PD1'].sort(naturalCompare), ['PD1', 'pd2', 'PD10']);
  assert.equal(orgNodeCompare({ sort_order: 1, name: 'b' }, { sort_order: null, name: 'a' }) < 0, true);
});
