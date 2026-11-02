/* ═══ 🧹 ปุ่มล้างตัวกรอง — กฎกลาง (2026-10-22 · คำสั่ง user) ═══ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEW_PARAMS, clearableParams, hasActiveFilters, resetSearch } from '../filterReset.js';

test('ล้างเฉพาะ "ตัวกรอง" — พารามิเตอร์ที่บอกว่าดูอะไรอยู่ต้องไม่ถูกแตะ', () => {
  const q = '?tab=list&wait=close&from=2026-10-01&to=2026-10-22&scale=day';
  assert.deepEqual(clearableParams(q), ['wait', 'from', 'to', 'scale']);
  assert.equal(resetSearch(q), '?tab=list');
});

test('🔴 ?mo= / ?die= / ?fx= / ?asset= / ?dept= ห้ามถูกล้าง (เป็นตัวเลือกหน้า/ระเบียน)', () => {
  for (const k of VIEW_PARAMS) {
    assert.deepEqual(clearableParams(`?${k}=x&line=A`), ['line'], `${k} ต้องรอด`);
    assert.equal(resetSearch(`?${k}=x&line=A`), `?${k}=x`);
  }
});

test('ไม่มีตัวกรองค้าง = ไม่ต้องวาดปุ่ม', () => {
  assert.equal(hasActiveFilters(''), false);
  assert.equal(hasActiveFilters('?tab=list'), false);
  assert.equal(hasActiveFilters('?tab=list&q=abc'), true);
  assert.equal(resetSearch(''), '', 'ไม่เหลืออะไร = คืนสตริงว่าง เอาไปต่อท้าย pathname ได้ตรงๆ');
});

test('keep ของหน้า เพิ่มเข้ามาได้ และค่าซ้ำของพารามิเตอร์ที่เก็บต้องไม่หาย', () => {
  assert.deepEqual(clearableParams('?tab=a&view=b&q=c', ['view']), ['q']);
  assert.equal(resetSearch('?tab=a&tab=b&q=c'), '?tab=a&tab=b');
});

test('search พัง/ว่าง ต้องไม่โยน error', () => {
  assert.deepEqual(clearableParams(null), []);
  assert.equal(resetSearch(undefined), '');
});
