/* เทสไทม์ไลน์จัดแผน (2026-09-30 · คำสั่ง user — ลากจัดแผน สลับก่อนหลัง)
   🔴 ล็อกไว้ว่ากล่องที่คำนวณไม่ได้ **ห้ามหาย ห้ามยาว 0 เงียบๆ** · ยืดข้ามเบรคเหมือนบอร์ดจริง ·
      งานคู่ติดกันไม่กินเวลา 2 เท่า · ล้นปลายกะต้องเห็น
   ⏱️ ตรึงเวลาเอง ไม่มี Date.now() */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutLots, reorderTo, hourTicks } from '../planTimeline.js';

const T0 = Date.parse('2026-10-01T01:00:00Z');        // 08:00 ไทย
const H = 3600_000, M = 60_000;
const END = T0 + 12 * H;                               // 20:00 ไทย
const lot = (id, o = {}) => ({ id, seq: 1, mat_no: 'M1', qty_plan: 60, status: 'planned', ...o });
const CT = { M1: 60, M2: 60 };                         // 60 วิ/ชิ้น ⇒ 60 ชิ้น = 60 นาที
const ctOf = (m) => CT[m] ?? null;
const RULE = { base_min: 20, same_die_min: 5, per_mm_sec: 1, height_steps: [] };
const lay = (lots, o = {}) => layoutLots({ lots, ctOf, startMs: T0, endMs: END, ...o });

test('กล่องยาวตามเวลาจริง · เรียงต่อกันไม่ทับกัน', () => {
  const r = lay([lot('a', { seq: 1 }), lot('b', { seq: 2 })]);
  assert.equal(r.boxes[0].startMs, T0);
  assert.equal(r.boxes[0].endMs, T0 + 60 * M);
  assert.equal(r.boxes[1].startMs, T0 + 60 * M, 'ใบที่ 2 เริ่มตอนใบแรกจบ');
  assert.equal(r.boxes[0].widthPct, (60 * M / (12 * H)) * 100);
});

test('🔴 ไม่มี CT = คำนวณความยาวไม่ได้ ⇒ กล่องยังอยู่ · widthPct = null (ไม่ใช่ 0)', () => {
  const r = lay([lot('a', { mat_no: 'ZZ' })]);
  assert.equal(r.boxes.length, 1, 'ห้ามหายจากจอ');
  assert.equal(r.boxes[0].noCt, true);
  assert.equal(r.boxes[0].widthPct, null);
  assert.equal(r.unknownCount, 1);
});

test('🔴 มีกล่องคำนวณไม่ได้ ⇒ ทุกกล่องถัดไปติดธง afterUnknown (เวลาเชื่อไม่ได้)', () => {
  const r = lay([lot('a', { seq: 1, mat_no: 'ZZ' }), lot('b', { seq: 2 })]);
  assert.equal(r.boxes[0].afterUnknown, true);
  assert.equal(r.boxes[1].afterUnknown, true);
  assert.equal(r.overflowMin, null, 'ตอบไม่ได้ว่าล้นกี่นาที ห้ามบอก 0');
});

test('ยืดข้ามเวลาพัก — กฎเดียวกับบอร์ดจริง', () => {
  /* ใบ 60 นาทีเริ่ม 08:00 · พัก 08:30–09:00 (30 น.) ⇒ ต้องจบ 09:30 ไม่ใช่ 09:00 */
  const breaks = [[T0 + 30 * M, T0 + 60 * M]];
  const r = lay([lot('a')], { breaks });
  assert.equal(r.boxes[0].endMs, T0 + 90 * M);
});

test('เวลาเปลี่ยนรุ่นแทรกก่อนกล่อง — ใบแรกของกะไม่มี', () => {
  const dies = { a: { id: 'D1', die_height_mm: 200 }, b: { id: 'D2', die_height_mm: 260 } };
  const r = lay([lot('a', { seq: 1 }), lot('b', { seq: 2 })], { dieOf: (l) => dies[l.id], rule: RULE });
  assert.equal(r.boxes[0].setupMs, 0, 'ใบแรกไม่มีของเดิมให้ถอด');
  assert.equal(r.boxes[1].setupMs, 21 * M, 'base 20 + 60มม.×1วิ = 1 นาที');
  assert.equal(r.boxes[1].startMs, T0 + 60 * M + 21 * M);
});

test('🔴 ไม่รู้เวลาเปลี่ยนรุ่น = ธง setupKnown:false (ไม่เลื่อนเวลาเดาเอา)', () => {
  const dies = { a: { id: 'D1', die_height_mm: 200 }, b: { id: 'D2', die_height_mm: 260 } };
  const r = lay([lot('a', { seq: 1 }), lot('b', { seq: 2 })], { dieOf: (l) => dies[l.id], rule: null });
  assert.equal(r.boxes[1].setupKnown, false);
  assert.equal(r.boxes[1].setupMs, 0, 'ไม่รู้ = ไม่บวกเวลาเดา แต่ต้องติดธงให้จอเขียนบอก');
  assert.equal(r.setupUnknownCount, 1);
});

test('👯 งานคู่ RH/LH วางติดกัน = ปั๊มจังหวะเดียว ไม่กินเวลา 2 เท่า', () => {
  const pairOf = (m) => ({ M1: 'M2', M2: 'M1' }[m] || null);
  const r = lay([lot('a', { seq: 1, mat_no: 'M1' }), lot('b', { seq: 2, mat_no: 'M2' })], { pairOf });
  assert.equal(r.boxes[1].pairedWithPrev, true);
  assert.equal(r.boxes[1].runMin, 0, 'ยอดเท่ากัน ⇒ ใบหลังไม่กินเวลาเพิ่ม');
  assert.equal(r.endMs, T0 + 60 * M, 'คิวจบที่ 60 นาที ไม่ใช่ 120');
});

test('คู่ที่ยอดไม่เท่ากัน = ใบหลังกินเฉพาะส่วนที่เกิน', () => {
  const pairOf = (m) => ({ M1: 'M2', M2: 'M1' }[m] || null);
  const r = lay([lot('a', { seq: 1, mat_no: 'M1', qty_plan: 60 }),
                 lot('b', { seq: 2, mat_no: 'M2', qty_plan: 90 })], { pairOf });
  assert.equal(r.boxes[1].runMin, 30, '90 − 60 = 30 นาที');
});

test('คู่ที่ถูกพาร์ทอื่นคั่น = คนละรอบ กินเวลาเต็ม', () => {
  /* ⚠️ ตัวคั่นต้องเป็น**คนละพาร์ท**จริงๆ — ถ้าคั่นด้วย M1 ตัวที่สอง แม่พิมพ์คู่ก็ยังอยู่บนเครื่อง
     ⇒ ระบบถือว่ายังปั๊มพร้อมกันได้ (pairedWithPrev = true) ซึ่งถูกแล้ว */
  const pairOf = (m) => ({ M1: 'M2', M2: 'M1' }[m] || null);
  const ct2 = (m) => ({ M1: 60, M2: 60, M9: 60 }[m] ?? null);
  const r = layoutLots({
    lots: [lot('a', { seq: 1, mat_no: 'M1' }), lot('x', { seq: 2, mat_no: 'M9' }),
           lot('b', { seq: 3, mat_no: 'M2' })],
    ctOf: ct2, pairOf, startMs: T0, endMs: END,
  });
  assert.equal(r.boxes[2].pairedWithPrev, false);
  assert.equal(r.boxes[2].runMin, 60);
});

test('🔴 ล้นปลายกะต้องเห็น — ไม่ตัดกล่องทิ้ง ไม่บีบให้พอดี', () => {
  const big = lot('a', { qty_plan: 60 * 13 });          // 13 ชั่วโมง > กะ 12 ชั่วโมง
  const r = lay([big]);
  assert.equal(r.boxes.length, 1);
  assert.equal(r.overflowMin, 60);
  assert.ok(r.boxes[0].widthPct > 100, 'กล่องยาวเกินราง = จอต้องวาดหางล้นออกไป');
});

test('ล็อตที่ยกเลิกไม่อยู่บนไทม์ไลน์', () => {
  const r = lay([lot('a', { seq: 1 }), lot('b', { seq: 2, status: 'cancelled' })]);
  assert.equal(r.boxes.length, 1);
});

/* ── ลากสลับลำดับ ─────────────────────────────────────────────────────── */
test('🧲 ลากไปวางตำแหน่งใหม่ แล้ว seq ต่อเนื่อง', () => {
  const arr = [lot('a', { seq: 1 }), lot('b', { seq: 2 }), lot('c', { seq: 3 })];
  assert.deepEqual(reorderTo(arr, 'c', 0).map(l => l.id), ['c', 'a', 'b']);
  assert.deepEqual(reorderTo(arr, 'c', 0).map(l => l.seq), [1, 2, 3]);
  assert.deepEqual(reorderTo(arr, 'a', 2).map(l => l.id), ['b', 'c', 'a']);
});

test('ลากเกินขอบ / ลาก id ที่ไม่มี = ไม่พัง', () => {
  const arr = [lot('a', { seq: 1 }), lot('b', { seq: 2 })];
  assert.deepEqual(reorderTo(arr, 'a', 99).map(l => l.id), ['b', 'a']);
  assert.deepEqual(reorderTo(arr, 'zz', 0).map(l => l.id), ['a', 'b'], 'id ไม่มี = คืนของเดิม');
});

test('ล็อตที่ยกเลิกไม่ถูกจัดลำดับใหม่ แต่ต้องไม่หายไปจากลิสต์', () => {
  const arr = [lot('a', { seq: 1 }), lot('x', { seq: 2, status: 'cancelled' }), lot('b', { seq: 3 })];
  const out = reorderTo(arr, 'b', 0);
  assert.equal(out.length, 3, 'ของที่ยกเลิกต้องยังอยู่ (เก็บเป็นประวัติ)');
  assert.deepEqual(out.filter(l => l.status !== 'cancelled').map(l => l.id), ['b', 'a']);
});

test('ป้ายชั่วโมงบนหัวราง — รวมป้ายที่ต้นราง', () => {
  /* T0 = 08:00 ตรงชั่วโมงพอดี ⇒ ได้ 08/09/10/11 = 4 ป้าย · ป้ายแรกอยู่ที่ 0% (ป้ายเวลาเริ่มกะ) */
  const t = hourTicks(T0, T0 + 3 * H);
  assert.equal(t.length, 4);
  assert.equal(t[0].pct, 0);
  assert.ok(t[t.length - 1].pct <= 100);
});

/* ══ 🔴 กล่องที่คำนวณไม่ได้ ห้ามทับกัน (เจอจากจอทดสอบ 2026-09-30) ══════════════════════
   เดิม cursor ไม่เลื่อนเมื่อไม่มี CT ⇒ 14 ใบซ้อนกันที่จุดเดียว อ่านไม่ออก กดไม่ได้ ลากไม่ได้ */
test('🔴 หลายล็อตที่ไม่มี CT ต้องไม่ทับกัน — แต่ต้องยังบอกว่าความยาวไม่ใช่เวลาจริง', () => {
  const r = lay([lot('a', { seq: 1, mat_no: 'ZZ' }), lot('b', { seq: 2, mat_no: 'ZZ' }),
                 lot('c', { seq: 3, mat_no: 'ZZ' })]);
  const lefts = r.boxes.map(b => b.leftPct);
  assert.equal(new Set(lefts).size, 3, 'ตำแหน่งต้องต่างกันทั้ง 3 ใบ');
  assert.ok(lefts[0] < lefts[1] && lefts[1] < lefts[2], 'เรียงไปทางขวาตามลำดับ');
  r.boxes.forEach(b => {
    assert.equal(b.widthPct, null, 'widthPct ต้องเป็น null = ความยาวไม่สเกลกับเวลา');
    assert.ok(b.nominalPct > 0, 'แต่ต้องมีความกว้างให้วาด/กดได้');
  });
  assert.equal(r.overflowMin, null, 'ยังต้องตอบไม่ได้ว่าล้นกี่นาที');
});

test('ช่องนามธรรมของกล่องไม่มี CT ไม่ทำให้ตัวที่คำนวณได้เพี้ยนตำแหน่งสัมพัทธ์', () => {
  const r = lay([lot('a', { seq: 1, mat_no: 'ZZ' }), lot('b', { seq: 2 })]);
  assert.equal(r.boxes[1].startMs, r.boxes[0].endMs, 'ใบถัดไปต่อท้ายช่องนามธรรมพอดี');
  assert.equal(r.boxes[1].afterUnknown, true, 'และต้องติดธงว่าเวลาเชื่อไม่ได้');
});
