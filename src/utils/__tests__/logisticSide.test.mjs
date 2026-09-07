/**
 * เทสการจัดฝั่งงาน Logistic (ขาเข้า / ขาออก)
 *
 * ที่มา (2026-09-03): ฝ่าย Logistic & Sales แบ่งความรับผิดชอบเป็น 2 ฝั่งหลัก + 1 ชั้นข้อมูล
 * และเส้นแบ่งผูกกับ "เลข MAT ตัวแรก" ตรงๆ ตามที่ user ระบุ:
 *     Warehouse = เก็บ FG 1xx รอส่งลูกค้า   → ขาออก
 *     Store     = คุม 2xx / 3xx / 5xx        → ขาเข้า
 * สลับสองอันนี้เมื่อไหร่ = ของไปโผล่ผิดแผนก และไม่มีอะไรฟ้อง (ตัวเลขยังขึ้นครบเหมือนเดิม)
 * เทสนี้จึงล็อกทิศทางไว้ ไม่ให้ใครเผลอกลับด้าน
 *
 * รัน: node --test 'src/utils/__tests__/*.test.mjs'  (npm run build เรียกให้อยู่แล้ว)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { sideOfMat, sideMatches, splitBySide, SIDES, UNKNOWN_SIDE, matClassesOfSide } from '../logisticSide.js';

test('FG 1xx = ขาออก (Warehouse + Delivery) — ห้ามกลับด้านกับ Store', () => {
  assert.equal(sideOfMat('10100384'), 'outbound');
  assert.equal(sideOfMat('101002'), 'outbound');
  // เลข FG ทะลุช่วงเดิมไปเป็น 101xxxxx แล้ว — ต้องยังจับได้ (บทเรียนจาก matPrefix)
  assert.equal(sideOfMat('10106790'), 'outbound');
});

test('2xx / 3xx / 5xx = ขาเข้า (Store)', () => {
  assert.equal(sideOfMat('20058626'), 'inbound', '2xx child ผลิตเอง');
  assert.equal(sideOfMat('30045438'), 'inbound', '3xx child ซื้อนอกจาก supplier');
  assert.equal(sideOfMat('50031601'), 'inbound', '5xx raw material');
});

test('เลขที่จัดฝั่งไม่ได้ต้องคืน null — ห้ามเดาเข้าฝั่งใดฝั่งหนึ่ง', () => {
  assert.equal(sideOfMat('90031601'), null, 'เลขภายใน 9xx ยังไม่มี routing SAP บอกไม่ได้ว่าไหลทางไหน');
  assert.equal(sideOfMat('MB3B-16E060-CH'), null, 'เลขพาร์ทลูกค้าที่ยังไม่ resolve เป็น MAT SAP');
  assert.equal(sideOfMat(''), null);
  assert.equal(sideOfMat(null), null);
  assert.equal(sideOfMat(undefined), null);
});

test('sideMatches: ไม่เลือกฝั่ง = ผ่านหมด · unknown = เฉพาะที่จัดฝั่งไม่ได้', () => {
  assert.equal(sideMatches('10100384', ''), true, 'ไม่เลือก = ไม่กรอง');
  assert.equal(sideMatches('10100384', 'outbound'), true);
  assert.equal(sideMatches('10100384', 'inbound'), false);
  assert.equal(sideMatches('90031601', 'unknown'), true);
  assert.equal(sideMatches('90031601', 'inbound'), false, 'เลขภายในต้องไม่หลุดเข้าฝั่งขาเข้า');
  assert.equal(sideMatches('20058626', 'unknown'), false);
});

test('splitBySide แตกครบ 3 กอง ไม่มีแถวหาย', () => {
  const rows = [
    { mat_no: '10100384' }, { mat_no: '10100385' },   // outbound 2
    { mat_no: '20058626' }, { mat_no: '30045438' }, { mat_no: '50031601' }, // inbound 3
    { mat_no: 'MB3B-16E060-CH' },                      // unknown 1
  ];
  const g = splitBySide(rows);
  assert.equal(g.outbound.length, 2);
  assert.equal(g.inbound.length, 3);
  assert.equal(g.unknown.length, 1);
  assert.equal(g.inbound.length + g.outbound.length + g.unknown.length, rows.length,
    'ผลรวม 3 กองต้องเท่าจำนวนแถวเดิมเสมอ — ตัวนับบนชิปพึ่งข้อนี้');
});

test('splitBySide รับ matOf ของตัวเองได้ (แถวที่ชื่อคอลัมน์ต่างกัน)', () => {
  const g = splitBySide([{ mat: '10100384' }, { mat: '20058626' }], r => r.mat);
  assert.equal(g.outbound.length, 1);
  assert.equal(g.inbound.length, 1);
});

test('SIDES มี 3 ฝั่ง และเจ้าของงานต้องไม่สลับ Warehouse/Store', () => {
  assert.deepEqual(SIDES.map(s => s.key), ['inbound', 'outbound', 'control']);
  const inb = SIDES.find(s => s.key === 'inbound');
  const outb = SIDES.find(s => s.key === 'outbound');
  assert.match(inb.owner, /Store/, 'ขาเข้าต้องเป็นของ Store');
  assert.ok(!/Warehouse/.test(inb.owner), 'Warehouse ห้ามอยู่ฝั่งขาเข้า (เก็บ FG รอส่งลูกค้า)');
  assert.match(outb.owner, /Warehouse/, 'ขาออกต้องมี Warehouse');
  assert.ok(!/\bStore\b/.test(outb.owner.replace('Rack Center', '')), 'Store ห้ามอยู่ฝั่งขาออก');
});

test('matClassesOfSide บอกได้ว่าฝั่งไหนครอบเลขอะไร (ไม่ต้อง hardcode ซ้ำในหน้า)', () => {
  assert.deepEqual(matClassesOfSide('inbound').map(c => c.digit).sort(), ['2', '3', '5']);
  assert.deepEqual(matClassesOfSide('outbound').map(c => c.digit), ['1']);
});

test('UNKNOWN_SIDE ต้องแยกจาก SIDES (เป็นสถานะ "ไม่รู้" ไม่ใช่ฝั่งที่ 4)', () => {
  assert.equal(UNKNOWN_SIDE.key, 'unknown');
  assert.ok(!SIDES.some(s => s.key === 'unknown'), 'ห้ามยัด unknown เข้า SIDES — จะกลายเป็นฝั่งที่มีเจ้าของ');
});
