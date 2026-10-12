/* ══ ยอดผลิตของทั้งกะ — สูตรกลาง `sessionProducedQty` (oee.js §6.0.1 · 2026-10-12) ══
   ที่มา: กฎเดียวกันเคยถูกเขียนมือ 3 ที่ (orderProducedQty / computeSessionOee /
   handleCloseSession) ⇒ เสี่ยง drift · เทสนี้ล็อกว่าทุกสถานะนับเท่าเดิมเป๊ะ
   🔴 ห้ามแก้ค่าที่คาดหวังในไฟล์นี้เพื่อให้เทสผ่าน — ตัวเลขพวกนี้คือพฤติกรรมที่ใช้งานจริงอยู่ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionProducedQty, orderProducedQty } from '../oee.js';

const o = (x) => ({ id: x.id || Math.random().toString(36).slice(2), ...x });

test('confirmed → qty_ok ?? qty · ใบยังไม่ confirmed → qty_actual', () => {
  const orders = [
    o({ id: 'a', status: 'confirmed', qty: 100, qty_ok: 100 }),
    o({ id: 'b', status: 'confirmed', qty: 50, qty_ok: null }),   // qty_ok ว่าง → ถอยไป qty
    o({ id: 'c', status: 'carry_over', qty: 60, qty_actual: 12 }),
    o({ id: 'd', status: 'imported', qty: 30, qty_actual: 8 }),
    o({ id: 'e', status: 'open', qty: 20, qty_actual: 0 }),
  ];
  assert.equal(sessionProducedQty(orders), 100 + 50 + 12 + 8 + 0);
});

test('🔴 ใบ `imported` ต้องนับ — กะถัดไปรับยอดค้างไปแล้ว ต้นทางยังถือยอดที่ตัวเองทำจริง', () => {
  // เคสจริง 09/2026 Line 60 กะเช้า 02/09: ใบสุดท้ายค้าง imported qty_actual 8
  // ⇒ ยอดกะ = 454 (confirmed) + 8 = 462 · ตัดใบ imported ทิ้ง = ยอดหาย 8 ชิ้นเงียบๆ
  const orders = [o({ id: 'x', status: 'confirmed', qty: 454, qty_ok: 454 }),
                  o({ id: 'y', status: 'imported', qty: 10, qty_actual: 8 })];
  assert.equal(sessionProducedQty(orders), 462);
});

test('ช่องยอดที่หัวหน้ากรอกตอนปิดกะ ชนะค่าในฐาน · ว่าง/0 = ใช้ค่าในฐาน', () => {
  const orders = [o({ id: 'c1', status: 'carry_over', qty: 60, qty_actual: 12 })];
  assert.equal(sessionProducedQty(orders, { c1: '25' }), 25);
  assert.equal(sessionProducedQty(orders, { c1: '' }), 12);
  assert.equal(sessionProducedQty(orders, { c1: '0' }), 12);   // 0 = "ยังไม่กรอก" (พฤติกรรมเดิม)
  assert.equal(sessionProducedQty(orders, {}), 12);
});

test('cancelled นับยอดที่ทำไปแล้ว (ไม่ใช่ 0) — ของทำไปจริง ห้ามหายจากยอดผลิต', () => {
  const c = o({ id: 'z', status: 'cancelled', qty: 40, qty_actual: 7 });
  assert.equal(orderProducedQty(c), 7);
  assert.equal(sessionProducedQty([c]), 7);
});

test('ทนค่าขยะ — ใบ null / qty_actual ไม่ใช่ตัวเลข ต้องไม่พ่น NaN', () => {
  assert.equal(sessionProducedQty([null, undefined]), 0);
  assert.equal(sessionProducedQty([o({ status: 'open', qty_actual: 'abc' })]), 0);
  assert.equal(sessionProducedQty(), 0);
});
