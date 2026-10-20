/* ป้าย "ยอดสะสม" ต้องแยก 3 สถานะ — อ่านไม่ได้ ≠ ยังไม่เคยผลิต ≠ ผลิตแล้ว
   (เดิมจอเขียน `{totalQty > 0 && …}` ⇒ ทั้ง "0" และ "อ่านไม่ได้" หายไปเหมือนกัน · QC audit 15/10) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyQtyChip } from '../familyTotals.js';
import { STATUS_COLOR } from '../statusTone.js';

test('ผลิตแล้ว → ตัวเลขมีคอมมา + tone ok', () => {
  const c = familyQtyChip({ f1: 66278 }, 'f1');
  assert.equal(c.tone, 'good');
  assert.match(c.text, /66,278/);
});

test('ยังไม่เคยผลิต (ไม่มีคีย์ / เป็น 0) → บอกตรงๆ ไม่ใช่ซ่อน', () => {
  for (const t of [familyQtyChip({}, 'f1'), familyQtyChip({ f1: 0 }, 'f1')]) {
    assert.equal(t.tone, 'none');
    assert.match(t.text, /ยังไม่เคยผลิต/);
  }
});

test('อ่านไม่ได้ → ต้องไม่กลายเป็น "ยังไม่เคยผลิต"', () => {
  const c = familyQtyChip({}, 'f1', true);
  assert.equal(c.tone, 'warn');
  assert.match(c.text, /อ่านยอดสะสมไม่ได้/);
  assert.notEqual(c.text, familyQtyChip({}, 'f1', false).text);
});

test('ทุก tone ที่คืน ต้องมีสีในชุดกลาง (ห้ามตั้ง hex เองในไฟล์นี้)', () => {
  for (const tone of ['good', 'none', 'warn']) assert.ok(STATUS_COLOR[tone]);
});
