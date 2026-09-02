import test from 'node:test';
import assert from 'node:assert/strict';
import { normMat, isSapMat, buildPnIndex, resolveMatNo, pickStockMat, stockLookupKeys } from '../matResolve.js';

/* ข้อมูลจริงจาก dr_products 2026-08-31 — ชั้น OP ถูกตั้ง p_no เป็นเลขของพาร์ทจริง
   ทำให้กลุ่มนั้นกลายเป็น ambiguous แล้ว "ไม่ตัดสต็อกเลย" */
const OP  = (mat, p_no) => ({ mat_no: mat, p_no, is_operation: true });
const REAL = (mat, p_no) => ({ mat_no: mat, p_no, is_operation: false });

test('normMat — ตัดขีด/ช่องว่าง แล้วตัวพิมพ์ใหญ่', () => {
  assert.equal(normMat('MB3B 16A126 AB'), 'MB3B16A126AB');
  assert.equal(normMat('MB3B-16A126-A'),  'MB3B16A126A');
  assert.notEqual(normMat('MB3B 16A126 AB'), normMat('MB3B-16A126-A')); // suffix ต่าง = คนละคีย์
});

test('isSapMat — ตัวเลขล้วนเท่านั้น', () => {
  assert.equal(isSapMat('10088342'), true);
  assert.equal(isSapMat('127 (M6 มีเกลียว)'), false);
  assert.equal(isSapMat('30047596 & 30052451'), false);
});

test('🔴 OP ต้องไม่เข้า index — ไม่งั้นกลายเป็นผู้สมัครปลอมแล้วทั้งกลุ่ม ambiguous', () => {
  // MB3B-E102D04-BC: OP 'D04 (BOLT M6)' + พาร์ทจริง 20065733
  const rows = [OP('D04 (BOLT M6)', 'MB3B-E102D04-BC'), REAL('20065733', 'MB3B-E102D04-BC')];
  const idx = buildPnIndex(rows);
  assert.deepEqual([...idx.get('MB3BE102D04BC')], ['20065733']);
  // ก่อนแก้ = ambiguous (ไม่ตัดสต็อก) · หลังแก้ = mapped
  assert.deepEqual(resolveMatNo('MB3B E102D04 BC', idx), { mat: '20065733', status: 'mapped', candidates: ['20065733'] });
});

test('🔴 กลุ่มที่มีแต่ OP → none ไม่ใช่ ambiguous (ข้อความบอกสาเหตุถูกขึ้น)', () => {
  // MB3B-16C173-A: '173 M6(มีเกลียว)' + '173 M8(ไม่มีเกลียว)' — OP ทั้งคู่
  const idx = buildPnIndex([OP('173 M6(มีเกลียว)', 'MB3B-16C173-A'), OP('173 M8(ไม่มีเกลียว)', 'MB3B-16C173-A')]);
  assert.equal(idx.size, 0);
  assert.equal(resolveMatNo('MB3B 16C173 A', idx).status, 'none');
});

test('ตัด OP แล้วยังเหลือหลายตัวจริง = ยัง ambiguous ห้ามเดา', () => {
  // RB3B-16E024-AA: OP 'E024' + พาร์ทจริง 2 ตัว → ยังเลือกไม่ได้
  const idx = buildPnIndex([
    OP('E024 (M6 ไม่มีเกลียว)', 'RB3B-16E024-AA'),
    REAL('20066660', 'RB3B-16E024-AA'), REAL('20067027', 'RB3B-16E024-AA'),
  ]);
  const r = resolveMatNo('RB3B-16E024-AA', idx);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.mat, null);
  assert.deepEqual(r.candidates.sort(), ['20066660', '20067027']);
});

test('⚠️ แถวที่ไม่ได้ select is_operation มา (undefined) = ไม่ถูกกรอง — พฤติกรรมเดิม', () => {
  const idx = buildPnIndex([{ mat_no: '10088342', p_no: 'MB3B 16A126 AB' }]);   // ไม่มีคีย์ is_operation
  assert.deepEqual([...idx.get('MB3B16A126AB')], ['10088342']);
});

test('pickStockMat — ของอยู่ใต้เลขบน order อยู่แล้ว ชนะ resolve เสมอ (ห้ามบังคับ resolve ทับ)', () => {
  const idx = buildPnIndex([REAL('10100379', 'MB3B 8A297 CB')]);
  const r = pickStockMat('MB3B 8A297 CB', idx, (m) => m === 'MB3B 8A297 CB');
  assert.equal(r.status, 'direct');
  assert.equal(r.mat, 'MB3B 8A297 CB');
});

test('pickStockMat — map ได้แต่ยังไม่มีของ = mapped_nostock (ไม่ใช่ none)', () => {
  const idx = buildPnIndex([REAL('20065733', 'MB3B-E102D04-BC')]);
  const r = pickStockMat('MB3B E102D04 BC', idx, () => false);
  assert.equal(r.status, 'mapped_nostock');
  assert.equal(r.mat, '20065733');
});

test('🔴 OP ที่มีสต็อกค้างอยู่จริง ยังตัดได้ทาง direct — การกรองไม่ปิดทางนั้น', () => {
  const idx = buildPnIndex([OP('127 (M6 มีเกลียว)', 'MB3B-16A127-AA')]);
  const r = pickStockMat('127 (M6 มีเกลียว)', idx, (m) => m === '127 (M6 มีเกลียว)');
  assert.equal(r.status, 'direct');
});

test('stockLookupKeys — เอาทั้งเลขบน order และปลายทางที่ map ได้', () => {
  const idx = buildPnIndex([REAL('20065733', 'MB3B-E102D04-BC')]);
  assert.deepEqual(stockLookupKeys(['MB3B E102D04 BC'], idx).sort(),
    ['20065733', 'MB3B E102D04 BC'].sort());
});
