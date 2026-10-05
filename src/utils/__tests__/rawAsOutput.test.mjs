/* กฎ "ของที่ออกจากกระบวนการ ห้ามเป็นเลขวัตถุดิบ (5xx)" — ดูที่มาใน src/utils/matPrefix.js
   เคสจริง 05/10: ไลน์เลเซอร์บันทึกขั้นตอนตัดด้วยเลขวัตถุดิบ 4 เลข 208 ใบ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawAsOutputWarning } from '../matPrefix.js';

test('🔴 เลขวัตถุดิบ 5xx ที่ยังไม่ได้ตั้งเป็นชั้น OP = ต้องเตือน', () => {
  const w = rawAsOutputWarning('50029017', false);
  assert.match(w, /วัตถุดิบ/);
  assert.match(w, /ขั้นตอน/, 'ต้องบอกทางแก้ ไม่ใช่แค่ห้าม');
});

test('ตั้งเป็นชั้น OP แล้ว = ถูกต้อง ไม่เตือน', () => {
  assert.equal(rawAsOutputWarning('50029017', true), null);
});

test('พาร์ทประเภทอื่นไม่เกี่ยว (FG 1xx · child 2xx · ซื้อ 3xx · ภายใน 9xx)', () => {
  ['10105769', '20058498', '30047596', '90031601'].forEach(m =>
    assert.equal(rawAsOutputWarning(m, false), null, m));
});

test('🔴 ไม่ใช่เลข SAP 8 หลัก = ตอบไม่ได้ ห้ามเดา (ชื่อขั้นตอนใช้ช่อง mat_no ช่องเดียวกัน)', () => {
  ['5049 (SPOT)', '127', '', null, undefined].forEach(m =>
    assert.equal(rawAsOutputWarning(m, false), null, String(m)));
});
