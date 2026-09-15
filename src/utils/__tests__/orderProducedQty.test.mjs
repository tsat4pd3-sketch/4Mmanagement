import test from 'node:test';
import assert from 'node:assert/strict';
import { orderProducedQty } from '../oee.js';

/* สูตรบังคับ "ใบผลิตใบนี้ผลิตได้กี่ชิ้น" — เคยถูกก๊อปไว้ 7 ที่แล้ว drift
   เทสนี้ล็อกเคสที่เคยทำยอดหายจริง (2026-09-09: 3,213 ชิ้น/170 กะ) */

test('confirmed — ใช้ qty_ok ก่อน แล้วค่อย fallback qty', () => {
  assert.equal(orderProducedQty({ status: 'confirmed', qty_ok: 33, qty: 35, qty_actual: 0 }), 33);
  // ใบ confirmed ที่ qty_ok ว่าง (ใบเก่า/ใบเคยถอย) ต้องได้ qty ไม่ใช่ 0
  assert.equal(orderProducedQty({ status: 'confirmed', qty_ok: null, qty: 35, qty_actual: 0 }), 35);
});

test('carry_over — ผลิตจริงส่วนที่ทำได้ ไม่ใช่เป้า', () => {
  assert.equal(orderProducedQty({ status: 'carry_over', qty: 35, qty_actual: 5 }), 5);
});

test('⭐ imported ต้องนับเท่ากับ carry_over (เคสที่ทำยอดหายทั้งระบบ)', () => {
  // ใบเดียวกันคนละจังหวะ — กะถัดไปรับไปแล้ว แต่ยอดที่กะนี้ทำได้ต้องไม่หาย
  const src = { qty: 35, qty_actual: 5 };
  assert.equal(orderProducedQty({ ...src, status: 'carry_over' }), 5);
  assert.equal(orderProducedQty({ ...src, status: 'imported' }), 5);
});

test('ไม่ double count — ต้นทาง(imported) + ปลายทาง(confirmed ยอดที่เหลือ) = เป้าเดิม', () => {
  const source = { status: 'imported', qty: 35, qty_actual: 5 };      // กะเช้าทำได้ 5
  const next   = { status: 'confirmed', qty: 30, qty_ok: 30 };        // กะดึกรับ 30 ที่เหลือไปทำจนจบ
  assert.equal(orderProducedQty(source) + orderProducedQty(next), 35);
});

test('open — นับยอดที่กรอกระหว่างกะ · ยังไม่กรอก = 0 (ไม่ใช่เป้า)', () => {
  assert.equal(orderProducedQty({ status: 'open', qty: 35, qty_actual: 12 }), 12);
  assert.equal(orderProducedQty({ status: 'open', qty: 35, qty_actual: null }), 0);
});

test('cancelled — ยอดที่ทำไปก่อนยกเลิกยังนับ (ของผลิตออกมาจริง)', () => {
  assert.equal(orderProducedQty({ status: 'cancelled', qty: 35, qty_actual: 7 }), 7);
});

test('ค่าว่าง/แถวพัง ต้องไม่ระเบิด', () => {
  assert.equal(orderProducedQty(null), 0);
  assert.equal(orderProducedQty(undefined), 0);
  assert.equal(orderProducedQty({ status: 'open' }), 0);
});
