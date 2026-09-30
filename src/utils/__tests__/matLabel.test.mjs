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

/* ลำดับเปลี่ยนเป็น Part No. → Part Name → MAT SAP (2026-09-30 · คำสั่ง user "เอาให้ฟอร์แมทเดียวกัน")
   — ต้องตรงกับที่ <MatLabel>/<PartCard> วาดเสมอ ไม่งั้น toast/export พูดคนละภาษากับจอ */
test('matText: ลำดับเดียวกับที่ <MatLabel>/<PartCard> วาด — Part No. → ชื่อ → MAT', () => {
  assert.equal(matText('10100379', IDX, {}), 'MB3B 8C306 BC · BRACKET RR · MAT 10100379');
  // ไม่มี Part No. → ขึ้นต้นด้วยชื่อ ไม่เว้นช่องว่างค้างไว้
  assert.equal(matText('10100380', IDX, {}), 'REINF FR · MAT 10100380');
  // ไม่รู้จัก MAT นี้ → เหลือแค่เลข ห้ามขึ้น "MAT" ลอยๆ โดยไม่มีอะไรนำหน้า
  assert.equal(matText('99999999', IDX, {}), 'MAT 99999999');
});

test('buildMatIndex: parts_master เติมพาร์ทลูกที่ dr_products ไม่มี · แต่ห้ามทับของเดิม', () => {
  const idx = buildMatIndex(
    [{ mat_no: '10100379', name: 'BRACKET RR', p_no: 'MB3B 8C306 BC', is_active: true }],
    [{ mat_no: '10100379', part_name: 'ชื่อจาก parts_master', part_no: 'PM-999' },
     { mat_no: '30042566', part_name: 'NUT WELD M8', part_no: 'W520721-S300' }],
  );
  assert.equal(idx.get('10100379').name, 'BRACKET RR');      // dr_products ชนะ
  assert.equal(idx.get('10100379').p_no, 'MB3B 8C306 BC');
  assert.equal(idx.get('30042566').name, 'NUT WELD M8');     // พาร์ทลูกถูกเติมเข้ามา
  assert.equal(idx.get('30042566').p_no, 'W520721-S300');
});

test('buildMatIndex: ไม่ส่ง childParts = พฤติกรรมเดิมเป๊ะ (backward compatible)', () => {
  const only = buildMatIndex([{ mat_no: 'A1', name: 'X', p_no: 'P1', is_active: true }]);
  assert.equal(only.size, 1);
  assert.equal(only.get('A1').p_no, 'P1');
});
