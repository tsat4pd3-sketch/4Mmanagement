import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_ROW, initialActiveRow, moveActiveRow } from '../pickerKeys.js';

const rows = ['A', 'B', 'C'];

test('🔴 เปิดลิสต์เฉยๆ (ไม่มีคำค้น) = ไม่มีแถวติดอาวุธ — Enter ที่หลงเข้ามาต้องไม่เลือกอะไร', () => {
  const a = initialActiveRow('');
  assert.equal(a, NO_ROW);
  assert.equal(rows[a], undefined, 'rows[active] ต้อง undefined ⇒ pick() ไม่ถูกเรียก');
});

test('🔴 เคสจริง 02/10 — สแกน PROD.NO ซ้ำ → focus เด้งมาช่อง MAT → Enter ตามท้ายจากเครื่องสแกน', () => {
  // ลิสต์เปิดจาก focus · ยังไม่มีใครพิมพ์อะไร
  const active = initialActiveRow('');
  const picked = rows[active];
  assert.equal(picked, undefined, 'ห้ามเลือก "ตัวบนสุดของ dropdown" ให้เอง (เดิมได้ rows[0] = A)');
});

test('พิมพ์ค้นแล้ว Enter ต้องยังเลือกตัวที่ตรงที่สุดได้เหมือนเดิม (ห้ามเสียพฤติกรรมนี้)', () => {
  const a = initialActiveRow('100');
  assert.equal(a, 0);
  assert.equal(rows[a], 'A');
});

test('ช่องว่างล้วนนับเป็น "ยังไม่พิมพ์"', () => {
  assert.equal(initialActiveRow('   '), NO_ROW);
  assert.equal(initialActiveRow(null), NO_ROW);
  assert.equal(initialActiveRow(undefined), NO_ROW);
});

test('กดลูกศรลงจากสถานะไม่เล็ง ต้องได้แถวแรก (คนตั้งใจเลือกเอง = อนุญาต)', () => {
  assert.equal(moveActiveRow(NO_ROW, 1, rows.length), 0);
  assert.equal(moveActiveRow(0, 1, rows.length), 1);
  assert.equal(moveActiveRow(2, 1, rows.length), 2, 'ชนท้ายลิสต์แล้วอยู่กับที่');
});

test('กดลูกศรขึ้น ไม่หลุดไปค่าติดลบ', () => {
  assert.equal(moveActiveRow(1, -1, rows.length), 0);
  assert.equal(moveActiveRow(0, -1, rows.length), 0);
  assert.equal(moveActiveRow(NO_ROW, -1, rows.length), 0);
});

test('ลิสต์ว่าง = ไม่เล็งอะไรเลย ไม่ว่ากดลูกศรทางไหน', () => {
  assert.equal(moveActiveRow(0, 1, 0), NO_ROW);
  assert.equal(moveActiveRow(0, -1, 0), NO_ROW);
});

test('active ที่เพี้ยน (NaN/undefined) ต้องไม่ทำให้ลูกศรพัง', () => {
  assert.equal(moveActiveRow(undefined, 1, rows.length), 0);
  assert.equal(moveActiveRow(NaN, 1, rows.length), 0);
});
