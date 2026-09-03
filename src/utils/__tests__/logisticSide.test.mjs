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

/* ═══ ชั้น 3 — ฝั่งของคน/หน่วยงาน (2026-09-04) ═══════════════════════════════════ */
import {
  SIDE_KEYS, normalizeSides, sideOfNode, sideOfEmployee, sidesForUser,
  pageSidesOf, sideAllows, defaultSideFilter,
} from '../logisticSide.js';

/* ผังจำลองตาม seed ใน migration 20260904: section Planning&Store (ไม่มีป้าย) → 7 แผนกมีป้าย */
const ORG = [
  { id: 'ps',  kind: 'section',    name: 'Planning&Store', parent_id: null, division: 'logistic' },
  { id: 'st',  kind: 'department', name: 'Store',       parent_id: 'ps', logistic_side: 'inbound' },
  { id: 'wh',  kind: 'department', name: 'Warehouse',   parent_id: 'ps', logistic_side: 'outbound' },
  { id: 'dl',  kind: 'department', name: 'Delivery',    parent_id: 'ps', logistic_side: 'outbound' },
  { id: 'sl',  kind: 'department', name: 'Sales',       parent_id: 'ps', logistic_side: 'control' },
  { id: 'g1',  kind: 'line',       name: 'WH Team 1',   parent_id: 'wh' },                         // ลูกของ Warehouse ไม่ติดป้ายเอง
  { id: 'pd1', kind: 'section',    name: 'PD1', code: 'PD1', parent_id: null, division: 'production' },
];

test('SIDE_KEYS ตรงกับ SIDES และ normalizeSides ล้างค่าเพี้ยน/ซ้ำ/ตัวพิมพ์', () => {
  assert.deepEqual(SIDE_KEYS, SIDES.map(s => s.key));
  assert.deepEqual(normalizeSides(['Inbound', 'inbound', 'bogus', null, 'OUTBOUND']), ['inbound', 'outbound']);
  assert.deepEqual(normalizeSides(null), []);
  assert.deepEqual(normalizeSides('inbound'), [], 'ไม่ใช่ array = ว่าง (ค่าจาก sessionStorage อาจเพี้ยน)');
});

test('sideOfNode: ป้ายที่แผนก ลูกตกทอด · section ที่ไม่มีป้าย = null · Warehouse ≠ Store', () => {
  assert.equal(sideOfNode('st', ORG), 'inbound',  'Store = ขาเข้า');
  assert.equal(sideOfNode('wh', ORG), 'outbound', 'Warehouse = ขาออก — ห้ามกลับด้านกับ Store');
  assert.equal(sideOfNode('g1', ORG), 'outbound', 'ลูกของ Warehouse ตกทอดขาออก');
  assert.equal(sideOfNode('ps', ORG), null, 'Planning&Store ไม่มีป้าย (ทั้ง 3 ฝั่งอยู่ใต้ส่วนเดียวกัน) ห้ามเดา');
  assert.equal(sideOfNode('pd1', ORG), null);
  assert.equal(sideOfNode(null, ORG), null);
});

test('sideOfEmployee: ยึดแผนกก่อน section · ไม่มีแผนก/ไม่มีป้าย = null', () => {
  assert.equal(sideOfEmployee({ section: 'Planning&Store', department: 'Store' }, ORG), 'inbound');
  assert.equal(sideOfEmployee({ section: 'Planning&Store', department: 'warehouse ' }, ORG), 'outbound', 'เทียบชื่อแบบไม่สนตัวพิมพ์/ช่องว่าง (department เป็น free text)');
  assert.equal(sideOfEmployee({ section: 'Planning&Store', department: null }, ORG), null, 'พนักงานที่ยังไม่ระบุแผนก = ไม่รู้ฝั่ง ไม่จำกัด');
  assert.equal(sideOfEmployee({ section: 'PD1', department: 'ASSY' }, ORG), null, 'ฝ่ายผลิตไม่มีฝั่ง Logistic');
});

test('sidesForUser: ค่าที่ตั้งตรงชนะค่าตกทอด · ไม่มีทั้งคู่ = [] (ไม่จำกัด — บัญชีเดิมไม่เสียอะไร)', () => {
  assert.deepEqual(sidesForUser(['outbound'], 'inbound'), ['outbound'], 'admin ตั้งเองต้องทับค่าตกทอด');
  assert.deepEqual(sidesForUser([], 'inbound'), ['inbound']);
  assert.deepEqual(sidesForUser(null, null), []);
  assert.deepEqual(sidesForUser(['bogus'], 'bogus'), [], 'ค่าเพี้ยนทั้งคู่ = ไม่จำกัด ไม่ใช่ล็อกทุกหน้า');
});

test('pageSidesOf: ฝั่งของเมนูมาจาก NAV_GROUP_META.side ของหมวดหลัก + alsoIn · หมวดอื่นไม่มี', () => {
  const META = {
    'Logistic - ขาเข้า (Inbound)': { side: 'inbound' },
    'Logistic - ขาออก (Outbound)': { side: 'outbound' },
    'ฝ่ายผลิต': { icon: '🏭' },
  };
  assert.deepEqual(pageSidesOf({ to: '/line-stock', group: 'Logistic - ขาเข้า (Inbound)' }, META), ['inbound']);
  assert.deepEqual(pageSidesOf({ to: '/store-monitor', group: 'Logistic - ขาเข้า (Inbound)', alsoIn: 'Logistic - ขาออก (Outbound)' }, META),
    ['inbound', 'outbound'], 'หน้าที่คาบ 2 ฝั่งต้องได้ทั้งคู่');
  assert.deepEqual(pageSidesOf({ to: '/daily-report', group: 'ฝ่ายผลิต' }, META), [], 'หน้าหมวดอื่น = หน้ากลาง');
});

test('sideAllows: ว่าง = ไม่จำกัด · หน้ากลางผ่านเสมอ · จำกัดแล้วเห็นเฉพาะฝั่งตัวเอง (หน้าคาบ 2 ฝั่งผ่าน)', () => {
  assert.equal(sideAllows(['inbound'], []), true, 'บัญชีไม่ถูกตั้งฝั่ง = เห็นทุกหน้าเหมือนเดิม');
  assert.equal(sideAllows([], ['inbound']), true, 'หน้ากลาง (ไม่มีฝั่ง) ไม่ถูกกรอง');
  assert.equal(sideAllows(['inbound'], ['inbound']), true);
  assert.equal(sideAllows(['outbound'], ['inbound']), false, 'คน Store ไม่เห็นหน้าขาออก');
  assert.equal(sideAllows(['inbound'], ['outbound']), false, 'คน Warehouse ไม่เห็นหน้าขาเข้า');
  assert.equal(sideAllows(['inbound', 'outbound'], ['outbound']), true, 'เฝ้าระวังสต๊อกคาบ 2 ฝั่ง — คน Warehouse ยังเห็น');
  assert.equal(sideAllows(['control'], ['inbound', 'outbound']), false);
  assert.equal(sideAllows(['control'], ['control']), true);
});

test('defaultSideFilter: ฝั่งเดียวที่ถือของ = เริ่มที่ฝั่งนั้น · control/หลายฝั่ง/ไม่จำกัด = ทั้งหมด', () => {
  assert.equal(defaultSideFilter(['inbound']), 'inbound');
  assert.equal(defaultSideFilter(['outbound', 'control']), 'outbound', 'control ไม่ถือของ ไม่นับ');
  assert.equal(defaultSideFilter(['inbound', 'outbound']), '');
  assert.equal(defaultSideFilter(['control']), '');
  assert.equal(defaultSideFilter([]), '');
});
