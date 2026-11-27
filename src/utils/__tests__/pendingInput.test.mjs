/**
 * pendingInput — "มีของกรอกค้างบนจอไหม" (2026-11-27)
 * ใช้เอกสารจำลอง (ไม่มี DOM จริงในโหนด) — จำลองเฉพาะสิ่งที่ `hasPendingInput` อ่าน
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasPendingInput } from '../pendingInput.js';

/** สร้างช่องกรอกจำลอง */
const field = (o = {}) => ({
  tagName: o.tag || 'INPUT',
  type: o.type || 'text',
  value: o.value ?? '',
  defaultValue: o.defaultValue ?? '',
  disabled: !!o.disabled,
  readOnly: !!o.readOnly,
  dataset: o.safe ? { reloadSafe: '1' } : {},
  getClientRects: () => (o.hidden ? [] : [{ width: 100, height: 20 }]),
});

/** เอกสารจำลอง */
const doc = (fields, active = null) => ({
  activeElement: active,
  querySelectorAll: () => fields,
});

test('จอว่าง = ไม่ค้าง', () => {
  assert.equal(hasPendingInput(doc([])), false);
  assert.equal(hasPendingInput(doc([field(), field({ tag: 'TEXTAREA' })])), false);
});

test('ช่องที่คนพิมพ์แล้ว = ค้าง', () => {
  assert.equal(hasPendingInput(doc([field({ value: 'LS-02' })])), true);
  assert.equal(hasPendingInput(doc([field({ tag: 'TEXTAREA', value: 'งานไม่ go' })])), true);
});

test('🔴 ค่าที่ระบบเติมมาให้ (= defaultValue) ไม่นับว่าคนพิมพ์', () => {
  assert.equal(hasPendingInput(doc([field({ value: '2026-11-27', defaultValue: '2026-11-27' })])), false);
  /* แก้จากค่าที่ระบบเติม = คนพิมพ์แล้ว */
  assert.equal(hasPendingInput(doc([field({ value: '2026-11-28', defaultValue: '2026-11-27' })])), true);
});

test('ช่องว่างเปล่า/มีแต่ช่องว่าง ไม่นับ', () => {
  assert.equal(hasPendingInput(doc([field({ value: '   ' })])), false);
});

test('🔴 ช่องที่มองไม่เห็น (modal ปิดอยู่ · แท็บที่ไม่ได้เลือก) ไม่นับ', () => {
  assert.equal(hasPendingInput(doc([field({ value: 'ค่าเก่าใน modal ที่ปิดแล้ว', hidden: true })])), false);
});

test('ช่อง disabled / readOnly ไม่นับ (คนแก้ไม่ได้อยู่แล้ว)', () => {
  assert.equal(hasPendingInput(doc([field({ value: 'x', disabled: true })])), false);
  assert.equal(hasPendingInput(doc([field({ value: 'x', readOnly: true })])), false);
});

test('ติ๊ก/เลือก/ปุ่ม ไม่นับว่าเป็นของที่พิมพ์', () => {
  for (const type of ['checkbox', 'radio', 'range', 'color', 'hidden', 'submit', 'button']) {
    assert.equal(hasPendingInput(doc([field({ type, value: 'on' })])), false, `type=${type} ไม่ควรนับ`);
  }
});

test('🔴 cursor อยู่ในช่องกรอก = ค้าง ถึงช่องจะว่าง (กันเคส "ล้างช่องเพื่อพิมพ์ใหม่")', () => {
  const f = field();   // ว่างเปล่า
  assert.equal(hasPendingInput(doc([f], f)), true);
  /* ถ้าไม่มีกฎนี้ จะรีโหลดใส่ตอนคนลบค่าเก่าเสร็จพอดี */
  assert.equal(hasPendingInput(doc([f], null)), false);
});

test('cursor อยู่บนปุ่ม/ที่อื่น ไม่นับ', () => {
  assert.equal(hasPendingInput(doc([], { tagName: 'BUTTON', dataset: {} })), false);
  assert.equal(hasPendingInput(doc([], { tagName: 'BODY', dataset: {} })), false);
});

test('data-reload-safe="1" = ขอไม่ให้นับช่องนี้', () => {
  assert.equal(hasPendingInput(doc([field({ value: 'คำค้น', safe: true })])), false);
  const f = field({ safe: true });
  assert.equal(hasPendingInput(doc([f], f)), false, 'ช่องที่ยกเว้นแล้ว cursor อยู่ก็ไม่นับ');
});

test('🔴 อ่าน DOM ไม่ได้ = false (ห้ามขัดขวางการรีโหลด — ตาข่ายกันจอดำสำคัญกว่า)', () => {
  assert.equal(hasPendingInput(null), false);
  assert.equal(hasPendingInput({}), false);
  assert.equal(hasPendingInput({ querySelectorAll: () => { throw new Error('detached'); } }), false);
});

test('getClientRects พังไม่ทำให้ทั้งฟังก์ชันพัง', () => {
  const bad = { ...field({ value: 'x' }), getClientRects: () => { throw new Error('no layout'); } };
  assert.equal(hasPendingInput(doc([bad])), false);
});

test('ช่องเดียวใน 100 ช่องที่มีค่า ก็ต้องเจอ', () => {
  const many = Array.from({ length: 100 }, () => field());
  many[73] = field({ value: 'เจอ' });
  assert.equal(hasPendingInput(doc(many)), true);
});
