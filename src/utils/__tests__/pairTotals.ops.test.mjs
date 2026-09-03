/**
 * งานคู่ RH/LH ต้องนับ "1 คู่ = 1 ครั้งปั๊ม" แม้คู่นั้นถูกประกาศไว้ที่ชั้น OP
 *
 * เคสจริงที่ทำให้ต้องมีเทสนี้ (HDF1 · 2026-09-03):
 *   90031601 (RH) ↔ 90031602 (LH) เป็นคู่กัน เป้าใบละ 550
 *   แต่ op_parent_mat คนละตัว → ยุบเข้าพาร์ทจริงแล้วได้ 2 แถวที่ไม่ได้ผูก pair_mat_no ต่อกัน
 *   ⇒ แบนเนอร์ "จะส่งต่อกะหน้า" เคยขึ้น 1,100 ทั้งที่ต้องปั๊มแค่ 550 ครั้ง
 *
 * ⚠️ ห้ามแก้ด้วยการไปตั้ง pair_mat_no ให้พาร์ทจริง — กฎเหล็ก CLAUDE.md:
 *    "FG อิสระที่ผลิตแยกกันได้ ห้ามผูก pair_mat_no"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairAwareOpTotal, orderTotal, collapseOps, pairAwareTotal } from '../pairTotals.js';

const PAIR = { '90031601': '90031602', '90031602': '90031601' };
const pairOf = (m) => PAIR[m] || null;

/* op_parent_mat คนละตัว (ตรงกับ migration 20260821_laser345_own_op_numbers) */
const OP_SPLIT = {
  '90031601': { parent: '10100385', seq: 10 },
  '90031602': { parent: '20065715', seq: 10 },
};
const rows = () => ([
  { mat_no: '90031601', target: 550, produced: 0 },
  { mat_no: '90031602', target: 550, produced: 0 },
]);

test('OP คนละพาร์ทจริง + เป็นคู่กัน → นับ 550 ไม่ใช่ 1100', () => {
  assert.equal(pairAwareOpTotal(rows(), pairOf, OP_SPLIT).target, 550);
});

test('พิสูจน์ว่าลำดับ "ยุบก่อนจับคู่" คือที่มาของบั๊ก (กันคนแก้ย้อน)', () => {
  const naive = pairAwareTotal(collapseOps(rows(), OP_SPLIT), pairOf).target;
  assert.equal(naive, 1100, 'ยุบแล้วทิ้งร่องรอย OP = บวกซ้ำ 2 เท่า');
});

test('OP พาร์ทจริงตัวเดียวกัน → ยุบเหลือแถวเดียว ใช้ max', () => {
  const same = { '90031601': { parent: 'P', seq: 10 }, '90031602': { parent: 'P', seq: 20 } };
  assert.equal(pairAwareOpTotal(rows(), pairOf, same).target, 550);
});

test('ไม่ใช่ OP เลย → จับคู่ตรงตัวเหมือนเดิม', () => {
  assert.equal(pairAwareOpTotal(rows(), pairOf, {}).target, 550);
  assert.equal(pairAwareOpTotal(rows(), pairOf, null).target, 550);
});

test('พาร์ทเดี่ยวยังบวกปกติ — ห้ามเผลอยุบของที่ไม่ได้เป็นคู่', () => {
  const solo = [{ mat_no: 'A', target: 100, produced: 0 }, { mat_no: 'B', target: 40, produced: 0 }];
  assert.equal(pairAwareOpTotal(solo, () => null, OP_SPLIT).target, 140);
});

test('คู่ที่อีกฝั่งไม่ได้อยู่ในกะนี้ → นับเต็มใบเดียว ไม่หายไปไหน', () => {
  const one = [{ mat_no: '90031601', target: 550, produced: 0 }];
  assert.equal(pairAwareOpTotal(one, pairOf, OP_SPLIT).target, 550);
});

test('hasPair บอกได้ว่าชุดนี้มีงานคู่ (ใช้สลับหน่วย ชิ้น ↔ ชุด บนจอ)', () => {
  assert.equal(pairAwareOpTotal(rows(), pairOf, OP_SPLIT).hasPair, true);
  assert.equal(pairAwareOpTotal(rows(), () => null, OP_SPLIT).hasPair, false);
});

test('orderTotal (ตัวที่แบนเนอร์ใช้) ได้ผลเดียวกัน + ใบไม่ระบุ mat บวกแยก', () => {
  const orders = [
    { mat_no: '90031601', qty_target: 550, qty_actual: 0 },
    { mat_no: '90031602', qty_target: 550, qty_actual: 0 },
    { mat_no: null,       qty_target: 30,  qty_actual: 0 },
  ];
  const remain = (o) => Math.max(0, (o.qty_target ?? o.qty) - (o.qty_actual || 0));
  assert.equal(orderTotal(orders, remain, pairOf, OP_SPLIT), 580);
});

test('ยอดที่ทำไปแล้วไม่เท่ากันสองฝั่ง → ใช้ max (จำนวนครั้งที่ปั๊มไปแล้ว)', () => {
  const r = [
    { mat_no: '90031601', target: 550, produced: 300 },
    { mat_no: '90031602', target: 550, produced: 280 },
  ];
  const t = pairAwareOpTotal(r, pairOf, OP_SPLIT);
  assert.equal(t.target, 550);
  assert.equal(t.produced, 300);
});

test('OP ที่ยังไม่ผูกพาร์ทจริง (parent null) = นับแบบเดิม ห้ามเดา', () => {
  const noParent = { '90031601': { parent: null }, '90031602': { parent: null } };
  assert.equal(pairAwareOpTotal(rows(), pairOf, noParent).target, 550, 'ยังจับคู่ตรงตัวได้');
});
