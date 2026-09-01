import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAT_CLASSES, matDigit, isSapMat, classByDigit, matClassOf, matColor, matLabel, isFgMat, matMatches,
} from '../matPrefix.js';

/* เลข MAT SAP จริงจากข้อมูลในรีโป (ทุกตัว 8 หลักเป๊ะ) */
const REAL = ['10100333', '10100379', '10100385', '20058626', '20065715', '20066660',
  '50031601', '50031602', '90031601', '90031604'];
/* ของที่ "ไม่ใช่เลข SAP" แต่เคยถูกตีความด้วยตัวแรกจนป้ายผิด */
const NOT_SAP = [
  '127 (M6 มีเกลียว)',   // ชั้น OP — เคยถูกป้ายว่า FG เพราะขึ้นต้นด้วย 1
  '173 M8(ไม่มีเกลียว)',
  '290/291 (M6 มีเกลียว)',
  '291+088',
  '5049 (SPOT)',
  'E024 (M6 ไม่มีเกลียว)',
  'M6 ไม่มีเกลียว',
  'MB3B-16E060-CH',      // เลขพาร์ทลูกค้า
  'RB3B 8C306 BB',
  '1234567',             // 7 หลัก (ในรีโปมีแต่เลขเคลม ไม่ใช่ MAT)
  '101003840',           // 9 หลัก
  '2140661101',          // 10 หลัก = cost center
  '',
  null,
  undefined,
];

test('isSapMat: ตัวเลขล้วน 8 หลักเท่านั้น', () => {
  for (const m of REAL) assert.equal(isSapMat(m), true, `${m} ต้องเป็นเลข SAP`);
  for (const m of NOT_SAP) assert.equal(isSapMat(m), false, `${JSON.stringify(m)} ต้องไม่ใช่เลข SAP`);
  assert.equal(isSapMat(' 10100333 '), true, 'ช่องว่างหัวท้ายต้อง trim');
});

test('🔴 ของที่ไม่ใช่เลข SAP ต้องไม่ถูกตีเป็นประเภท (คืน null / ป้าย —)', () => {
  for (const m of NOT_SAP) {
    assert.equal(matClassOf(m), null, `${JSON.stringify(m)} ห้ามได้ class`);
    assert.equal(matLabel(m), '—');
    assert.equal(matColor(m), 'var(--muted)');
  }
  // เคสที่เป็นต้นเหตุจริง — "127 (M6 มีเกลียว)" เป็นงานขับนัท ไม่ใช่ FG ส่งลูกค้า
  assert.notEqual(matClassOf('127 (M6 มีเกลียว)')?.key, 'fg');
});

test('เลข SAP จริงยังได้ประเภทตามเลขตัวแรกเหมือนเดิม', () => {
  assert.equal(matClassOf('10100333').key, 'fg');
  assert.equal(matClassOf('20058626').key, 'child');
  assert.equal(matClassOf('30051864').key, 'buy');
  assert.equal(matClassOf('50031601').key, 'raw');
  assert.equal(matClassOf('90031601').key, 'internal');
  // FG วิ่งทะลุช่วง 100xxxxx ไปเป็น 101xxxxx แล้ว — ต้องยังเป็น FG (กฎ "เลขตัวแรกตัวเดียว")
  assert.equal(matClassOf('10106790').key, 'fg');
});

test('🔴 isFgMat เป็นด่านกัน "FG ห้ามจ่ายเข้าไลน์" — ต้องยิงกับ FG จริงทุกตัว และไม่ยิงกับของที่ไม่ใช่เลข SAP', () => {
  for (const m of ['10100333', '10100379', '10100385', '10106790']) assert.equal(isFgMat(m), true, m);
  for (const m of ['20058626', '50031601', '90031601']) assert.equal(isFgMat(m), false, m);
  // ขึ้นต้นด้วย 1 แต่ไม่ใช่เลข SAP → ไม่ใช่ FG (เดิมโดนกันผิด)
  assert.equal(isFgMat('127 (M6 มีเกลียว)'), false);
  assert.equal(isFgMat('1234567'), false);
});

test('classByDigit ใช้กับ "เลขประเภท" ไม่ใช่เลข MAT — ห้ามสลับกับ matClassOf', () => {
  assert.equal(classByDigit('2').key, 'child');
  assert.equal(classByDigit('200').key, 'child', 'ค่าเก่าในฐานเป็น 200/300/500');
  assert.equal(classByDigit('9').key, 'internal');
  assert.equal(classByDigit(''), null);
  // matClassOf กับค่าเดียวกันต้องคืน null (ไม่ใช่เลข MAT 8 หลัก) — นี่คือเหตุผลที่ต้องแยก 2 ฟังก์ชัน
  assert.equal(matClassOf('2'), null);
});

test('matMatches ตั้งใจให้หลวม — ตัวกรองมีหน้าที่ไม่ซ่อนของ ป้ายมีหน้าที่ไม่โกหก', () => {
  assert.equal(matMatches('10100333', '1'), true);
  assert.equal(matMatches('10100333', '100'), true, 'ทนค่าเก่าใน state/localStorage');
  assert.equal(matMatches('20058626', '1'), false);
  assert.equal(matMatches('10100333', ''), true, 'ไม่เลือกประเภท = ผ่านหมด');
  // ของที่ไม่ใช่เลข SAP ยัง match ตามตัวแรกได้ (จอที่อยากคงไว้เสมอให้เช็ค isSapMat เอง)
  assert.equal(matMatches('127 (M6 มีเกลียว)', '1'), true);
});

test('MAT_CLASSES ครบ 5 ประเภท และ digit ไม่ซ้ำ', () => {
  const digits = MAT_CLASSES.map(c => c.digit);
  assert.deepEqual(digits, ['1', '2', '3', '5', '9']);
  assert.equal(new Set(digits).size, digits.length);
  assert.equal(matDigit('20066636'), '2');
});
