import test from 'node:test';
import assert from 'node:assert/strict';
import { matKey, buildMatIndex, matInfo, matText } from '../matLabel.js';

const PRODUCTS = [
  { mat_no: '10100379', name: 'BRACKET RR', p_no: 'MB3B 8C306 BC', customer: 'FVL', is_active: true },
  { mat_no: '10100380', name: 'REINF FR', p_no: '', customer: 'AAT', is_active: true },
  { mat_no: '10100381', name: '', p_no: 'RB3B 16E060 BA', customer: '', is_active: true },
  // แถวเลิกใช้ที่ใช้ mat_no ซ้ำ — ต้องแพ้แถว is_active
  { mat_no: '10100379', name: 'ชื่อเก่าที่เลิกใช้', p_no: 'OLD', customer: '', is_active: false },
  // ชั้น OP ตั้ง p_no ซ้ำกับพาร์ทจริง (กับดักใน matResolve) — ที่นี่ค้นด้วย mat_no จึงไม่ชนกัน
  { mat_no: 'OP-127', name: '127 (M6 มีเกลียว)', p_no: 'MB3B 8C306 BC', is_active: true, is_operation: true },
];
const IDX = buildMatIndex(PRODUCTS);

test('matKey: trim + uppercase', () => {
  assert.equal(matKey('  ab3b1 '), 'AB3B1');
  assert.equal(matKey(null), '');
  assert.equal(matKey(undefined), '');
});

test('buildMatIndex: แถว is_active ชนะแถวเลิกใช้ที่ mat_no ซ้ำ', () => {
  assert.equal(IDX.get('10100379').name, 'BRACKET RR');
  assert.equal(IDX.get('10100379').p_no, 'MB3B 8C306 BC');
});

test('buildMatIndex: แถว OP เข้า index ได้ปกติ (ค้นด้วย mat_no ของตัวเอง ไม่ใช่ p_no)', () => {
  assert.equal(IDX.get('OP-127').name, '127 (M6 มีเกลียว)');
});

test('buildMatIndex: ข้ามแถวที่ไม่มี mat_no · รับ input ว่าง/undefined ได้', () => {
  assert.equal(buildMatIndex([{ name: 'ไม่มีเลข' }]).size, 0);
  assert.equal(buildMatIndex(undefined).size, 0);
});

test('matInfo: ไม่มีค่าบนแถว → ตกไปทะเบียน', () => {
  const i = matInfo('10100379', IDX, {});
  assert.deepEqual([i.name, i.pNo, i.from], ['BRACKET RR', 'MB3B 8C306 BC', 'master']);
});

test('matInfo: 🔴 ค่าบนแถวชนะทะเบียนเสมอ (snapshot ตอนเปิดใบ)', () => {
  const i = matInfo('10100379', IDX, { name: 'ชื่อตอนเปิดใบ' });
  assert.equal(i.name, 'ชื่อตอนเปิดใบ');
  assert.equal(i.pNo, 'MB3B 8C306 BC');   // แถวไม่มี p_no → เติมจากทะเบียน
  assert.equal(i.from, 'mixed');
});

test('matInfo: ทะเบียนยังโหลดไม่เสร็จ (index = null) → คืนเลข MAT เฉยๆ ห้ามพัง', () => {
  const i = matInfo('10100379', null, {});
  assert.deepEqual([i.mat, i.name, i.pNo, i.from], ['10100379', '', '', null]);
});

test('matInfo: MAT ที่ไม่มีในทะเบียน → from = null (จอโชว์เลขเปล่า ไม่ใช่ "-")', () => {
  assert.equal(matInfo('99999999', IDX, {}).from, null);
});

test('matInfo: มีแค่ชื่อ หรือมีแค่ p_no ก็ต้องโชว์', () => {
  assert.deepEqual(
    [matInfo('10100380', IDX, {}).pNo, matInfo('10100381', IDX, {}).name],
    ['', ''],
  );
  assert.equal(matInfo('10100380', IDX, {}).name, 'REINF FR');
  assert.equal(matInfo('10100381', IDX, {}).pNo, 'RB3B 16E060 BA');
});

test('matInfo: ค่าว่าง/ช่องว่างล้วนบนแถว ไม่ถือว่ามีค่า', () => {
  assert.equal(matInfo('10100379', IDX, { name: '   ' }).name, 'BRACKET RR');
});

/* 🔴 ลำดับ Part No. → Part Name → MAT SAP (2026-09-30 · คำสั่ง user)
   ล็อกไว้เพราะเป็น "ลำดับที่คนหน้างานอ่าน" ไม่ใช่รสนิยม — สลับกลับเมื่อไหร่ต้องรู้ตัว */
test('matText: Part No. → ชื่องาน → MAT (MAT มีป้ายกำกับเสมอ)', () => {
  assert.equal(matText('10100379', IDX, {}), 'MB3B 8C306 BC · BRACKET RR · MAT 10100379');
  // ไม่มี Part No. → ชื่อขึ้นก่อน แล้ว MAT ต่อท้าย (ห้ามหาย)
  assert.equal(matText('10100380', IDX, {}), 'REINF FR · MAT 10100380');
  // ไม่มีทั้งชื่อและ Part No. → เหลือ MAT อย่างเดียว **ยังต้องมีป้าย** (เลขเปล่าแยกไม่ออกจาก Part No.)
  assert.equal(matText('99999999', IDX, {}), 'MAT 99999999');
  // มีแต่ Part No. ไม่มีชื่อ
  assert.equal(matText('10100381', IDX, {}), 'RB3B 16E060 BA · MAT 10100381');
});
