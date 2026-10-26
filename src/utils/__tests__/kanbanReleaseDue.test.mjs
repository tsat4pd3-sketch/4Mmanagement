import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseDueRows, openLotMats } from '../kanbanReleaseDue.js';

/* ไลน์ A ผลิต M1/M2 · กฎรับเข้า: prefix '2' → STORE · M2 เป็นพาร์ทโหมดล็อต (ยอดอยู่ที่ไลน์เอง) */
const PRODUCTS = [
  { mat_no: '20000001', name: 'ชิ้น A', line_name: 'LINE A', is_active: true },
  { mat_no: '20000002', name: 'ชิ้น B', line_name: 'LINE A', is_active: true },
  { mat_no: '20000003', name: 'ชิ้น C', line_name: 'LINE A', is_active: true },
  { mat_no: '20000009', name: 'ขั้น OP', line_name: 'LINE A', is_active: true, is_operation: true },
];
const RULES = [{ match_type: 'prefix', match_value: '2', dest_line_name: 'STORE', is_active: true, mode: 'confirm' }];
const stockOf = (map) => (loc, mat) => (Object.hasOwn(map, `${loc}|${mat}`) ? map[`${loc}|${mat}`] : null);

test('สต็อก ≤ min = ต้องปล่อย · มากกว่า min = ไม่ขึ้น', () => {
  const r = releaseDueRows({
    stds: [{ mat_no: '20000001', min_qty: 100, max_qty: 400 }, { mat_no: '20000002', min_qty: 100, max_qty: 400 }],
    products: PRODUCTS, rules: RULES,
    stockAt: stockOf({ 'STORE|20000001': 80, 'STORE|20000002': 500 }),
  });
  assert.deepEqual(r.due.map(d => d.mat_no), ['20000001']);
  assert.equal(r.due[0].loc, 'STORE', 'ของที่ไลน์ผลิตเองต้องเทียบยอดคลังปลายทาง ไม่ใช่ยอดหน้าไลน์');
  assert.equal(r.due[0].suggestQty, 320, 'เติมให้ถึง max');
  assert.equal(r.due[0].shortage, 20);
});

test('เท่ากับ min พอดี = ต้องปล่อย (ข้อความสโตร์คือ "ต่ำกว่าหรือเท่ากับ")', () => {
  const r = releaseDueRows({
    stds: [{ mat_no: '20000001', min_qty: 100 }], products: PRODUCTS, rules: RULES,
    stockAt: stockOf({ 'STORE|20000001': 100 }),
  });
  assert.equal(r.due.length, 1);
});

test('🔴 ไม่มีแถวสต็อก = "เช็คไม่ได้" ห้ามนับเป็นของหมด', () => {
  const r = releaseDueRows({
    stds: [{ mat_no: '20000001', min_qty: 100 }], products: PRODUCTS, rules: RULES,
    stockAt: () => null,
  });
  assert.equal(r.due.length, 0, 'ห้ามเดาว่าเป็น 0');
  assert.deepEqual(r.unknown.map(u => u.mat_no), ['20000001'], 'ต้องมีกองให้จอเขียนบอก');
});

test('🔴 ไม่ได้ตั้ง min = ไม่เฝ้า · ไม่รู้คลังเลย = noLine (ทั้งคู่ต้องนับให้จอบอก)', () => {
  const r = releaseDueRows({
    stds: [{ mat_no: '20000001' }, { mat_no: '99999999', min_qty: 5 }],
    products: PRODUCTS, rules: RULES, stockAt: () => 0,
  });
  assert.deepEqual(r.noMin, ['20000001']);
  assert.deepEqual(r.noLine, ['99999999'], 'ไม่อยู่ใน Product Master และไม่เข้ากฎรับเข้าข้อไหน');
  assert.equal(r.due.length, 0);
});

/* 🔴 พาร์ทลูกส่วนใหญ่ไม่มีแถวใน Product Master (วัด 26/10: ตั้ง min 367 แต่มีแถว 138)
   ⇒ ถ้าบังคับว่าต้องรู้ไลน์ จะเฝ้าได้แค่ 1 ใน 3 — ถอยไปใช้คลังปลายทางตามกฎรับเข้าแทน */
test('ไม่อยู่ใน Product Master แต่เข้ากฎรับเข้า = ยังเฝ้าได้ (เทียบยอดที่คลังปลายทาง)', () => {
  const r = releaseDueRows({
    stds: [{ mat_no: '29999999', min_qty: 5 }], products: PRODUCTS, rules: RULES,
    stockAt: stockOf({ 'STORE|29999999': 1 }),
  });
  assert.equal(r.due.length, 1);
  assert.equal(r.due[0].loc, 'STORE');
  assert.equal(r.due[0].line_name, null, 'ไม่รู้ไลน์ = null ห้ามเดา');
});

test('พาร์ทที่มีใบล็อตค้างแล้ว ไม่ใช่ "ต้องปล่อยเพิ่ม" — แยกกอง', () => {
  const open = openLotMats([
    { child_mat_no: '20000001', status: 'pending' },
    { child_mat_no: '20000002', status: 'done' },
  ]);
  assert.deepEqual([...open], ['20000001']);
  const r = releaseDueRows({
    stds: [{ mat_no: '20000001', min_qty: 100 }, { mat_no: '20000002', min_qty: 100 }],
    products: PRODUCTS, rules: RULES, openMats: open,
    stockAt: stockOf({ 'STORE|20000001': 0, 'STORE|20000002': 0 }),
  });
  assert.deepEqual(r.due.map(d => d.mat_no), ['20000002']);
  assert.deepEqual(r.alreadyQueued.map(d => d.mat_no), ['20000001']);
});

test('ชั้น OP (is_operation) ไม่เข้าคลัง = ไม่มีไลน์ให้เฝ้า', () => {
  const r = releaseDueRows({
    stds: [{ mat_no: '20000009', min_qty: 1 }], products: PRODUCTS, rules: RULES, stockAt: () => 0,
  });
  assert.deepEqual(r.noLine, ['20000009']);
});

test('พาร์ทโหมดล็อต อ้างยอดที่ไลน์ตัวเอง (ยอดเข้าทางปิดล็อตลงที่ชื่อไลน์ผลิต)', () => {
  const r = releaseDueRows({
    stds: [{ mat_no: '20000003', min_qty: 50, max_qty: 200 }],
    products: PRODUCTS, rules: RULES, lotMats: ['20000003'],
    stockAt: stockOf({ 'LINE A|20000003': 10, 'STORE|20000003': 999 }),
  });
  assert.equal(r.due.length, 1);
  assert.equal(r.due[0].loc, 'LINE A');
});

test('เรียงวิกฤตก่อน (เหลือเทียบ min น้อยสุดมาก่อน)', () => {
  const r = releaseDueRows({
    stds: [{ mat_no: '20000001', min_qty: 100 }, { mat_no: '20000002', min_qty: 100 }],
    products: PRODUCTS, rules: RULES,
    stockAt: stockOf({ 'STORE|20000001': 90, 'STORE|20000002': 10 }),
  });
  assert.deepEqual(r.due.map(d => d.mat_no), ['20000002', '20000001']);
});

test('ไม่ตั้ง max = เสนอขนาดล็อต · ไม่มีทั้งคู่ = null (ห้ามเดา)', () => {
  const r = releaseDueRows({
    stds: [{ mat_no: '20000001', min_qty: 100, lot_size: 250 }, { mat_no: '20000002', min_qty: 100 }],
    products: PRODUCTS, rules: RULES,
    stockAt: stockOf({ 'STORE|20000001': 0, 'STORE|20000002': 0 }),
  });
  const by = Object.fromEntries(r.due.map(d => [d.mat_no, d.suggestQty]));
  assert.equal(by['20000001'], 250);
  assert.equal(by['20000002'], null);
});
