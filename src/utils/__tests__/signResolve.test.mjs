/* ═══ ✍️ ลายเซ็นดึงสดจากโปรไฟล์ (2026-10-24 · คำสั่ง user) ═══ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { signMapOf, signUrlOf } from '../signResolve.js';

const PEOPLE = [
  { id: 'u1', full_name: 'ก', signature_url: 'https://x/signatures/u1/new.png' },
  { id: 'u2', full_name: 'ข', signature_url: null },
  { id: null, full_name: 'ไม่มี uid', signature_url: 'https://x/zz.png' },
];
const M = signMapOf(PEOPLE);

test('ลายเซ็นปัจจุบันของคนนั้นชนะค่าที่เก็บไว้ในใบ (ไฟล์เดิมถูกลบได้)', () => {
  assert.equal(signUrlOf('u1', 'https://x/signatures/u1/OLD-ถูกลบแล้ว.png', M),
    'https://x/signatures/u1/new.png');
});

test('ไม่มีลายเซ็นในโปรไฟล์ = ถอยไปใช้ของที่เก็บไว้ (รวมที่วาดสดต่อใบ)', () => {
  assert.equal(signUrlOf('u2', 'https://x/sign/order-1/checker_sign-9.png', M),
    'https://x/sign/order-1/checker_sign-9.png');
  assert.equal(signUrlOf(null, 'https://x/sign/order-1/a.png', M), 'https://x/sign/order-1/a.png');
});

test('ไม่มีทั้งคู่ = null (เว้นช่องไว้ให้เซ็นมือ ห้ามคืนสตริงว่าง)', () => {
  assert.equal(signUrlOf('u2', null, M), null);
  assert.equal(signUrlOf(null, null, M), null);
  assert.equal(signUrlOf('u1', null, undefined), null, 'ยังไม่ได้โหลดรายชื่อ = ไม่เดา');
});

test('signMapOf ข้ามแถวที่ไม่มี uid หรือไม่มีลายเซ็น', () => {
  assert.deepEqual(Object.keys(M), ['u1']);
  assert.deepEqual(signMapOf(null), {});
});
