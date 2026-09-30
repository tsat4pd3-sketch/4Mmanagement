/* เทสแผนสั่งงานรายล็อต (2026-09-30 · คำสั่ง user — งาน lot size ที่ไม่ได้เดินตามคัมบัง)
   🔴 ชุดนี้ล็อก "ความซื่อสัตย์ของตัวเลข" เป็นหลัก:
      ไม่มี CT = null ห้าม 0 · งานคู่ห้ามนับเวลา 2 เท่า · เกินกำลัง = เตือนไม่บล็อก ·
      ใบนอกแผนต้องโผล่ · ล็อตที่ข้อมูลไม่ครบห้ามหายจากลำดับ
   ⏱️ ไม่มี Date.now() (กันเทสระเบิดเวลา) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lotRunMin, planRunMin, planSetup, shiftFit, resequence, moveLot,
  suggestSequence, reconcilePlan, planSummary, sortBySeq,
} from '../planLots.js';

const lot = (id, o = {}) => ({ id, work_date: '2026-10-01', shift: 'day', line_name: 'L1',
  seq: 1, mat_no: 'M1', qty_plan: 600, status: 'planned', ...o });
const CT = { M1: 60, M2: 30 };                 // M1 = 1 นาที/ชิ้น · M2 = 0.5
const ctOf = (m) => CT[m] ?? null;
const RULE = { base_min: 20, same_die_min: 5, per_mm_sec: 1, height_steps: [] };

/* ── เวลาผลิต ─────────────────────────────────────────────────────────── */
test('เวลาผลิตของล็อต = qty × CT ÷ 60', () => {
  assert.equal(lotRunMin(lot('a'), ctOf), 600);          // 600 ชิ้น × 60 วิ = 600 นาที
});

test('🔴 ไม่มี CT = null ห้ามคืน 0', () => {
  assert.equal(lotRunMin(lot('a', { mat_no: 'ZZ' }), ctOf), null);
  assert.equal(lotRunMin(lot('a', { qty_plan: 0 }), ctOf), null);
});

test('🔴 ทุกล็อตไม่มี CT ⇒ min = null (ไม่ใช่ 0) และบอกว่า mat ไหนบ้าง', () => {
  const r = planRunMin([lot('a', { mat_no: 'ZZ' }), lot('b', { mat_no: 'YY' })], ctOf);
  assert.equal(r.min, null);
  assert.deepEqual(r.noCt.sort(), ['YY', 'ZZ']);
});

test('มี CT บางตัว ⇒ รวมเฉพาะที่รู้ + บอกตัวที่ไม่รู้ (จอต้องเขียนว่าต่ำกว่าจริง)', () => {
  const r = planRunMin([lot('a'), lot('b', { mat_no: 'ZZ' })], ctOf);
  assert.equal(r.min, 600);
  assert.deepEqual(r.noCt, ['ZZ']);
});

test('🔴🔴 งานคู่ RH/LH — เวลาต้องนับครั้งเดียว (ชิ้น ≠ shot)', () => {
  const pairOf = (m) => ({ M1: 'M2', M2: 'M1' }[m] || null);
  /* M1 600 ชิ้น = 600 นาที · M2 600 ชิ้น × 30 วิ = 300 นาที ⇒ ปั๊มจังหวะเดียวกัน = max = 600 */
  const r = planRunMin([lot('a'), lot('b', { mat_no: 'M2' })], ctOf, pairOf);
  assert.equal(r.min, 600, 'ต้องเป็น max ของสองข้าง ไม่ใช่ 900');
  /* ไม่ส่ง pairOf = พฤติกรรมเดิม (บวกตรง) */
  assert.equal(planRunMin([lot('a'), lot('b', { mat_no: 'M2' })], ctOf).min, 900);
});

test('ล็อตที่ยกเลิกไม่กินเวลาในกะ', () => {
  assert.equal(planRunMin([lot('a'), lot('b', { status: 'cancelled' })], ctOf).min, 600);
});

/* ── เวลาเปลี่ยนรุ่น (ผ่าน pressSetup) ─────────────────────────────────── */
test('เวลาเปลี่ยนรุ่นคิดตามลำดับที่วางไว้ — ผ่าน pressSetup เท่านั้น', () => {
  const dies = { a: { id: 'D1', die_height_mm: 200 }, b: { id: 'D2', die_height_mm: 260 } };
  const s = planSetup([lot('a', { seq: 1 }), lot('b', { seq: 2 })], (l) => dies[l.id], RULE);
  /* ใบแรกไม่มีของเดิมให้ถอด = 0 · ใบที่สอง = base 20 + |260−200| มม. × 1 วิ = 60 วิ = 1 นาที */
  assert.equal(s.totalMin, 21);
  assert.equal(s.changeCount, 1);
});

test('🔴 ไม่มีกฎ = totalMin null (ห้ามเดา 0)', () => {
  const dies = { a: { id: 'D1', die_height_mm: 200 }, b: { id: 'D2', die_height_mm: 260 } };
  const s = planSetup([lot('a', { seq: 1 }), lot('b', { seq: 2 })], (l) => dies[l.id], null);
  assert.equal(s.totalMin, null);
  assert.equal(s.noRule, true);
});

/* ── กะนี้ทำไหวไหม ─────────────────────────────────────────────────────── */
test('ทำไหว / ตึง / เกิน — แบ่งที่ 90% และ 100%', () => {
  assert.equal(shiftFit({ runMin: 300, setupMin: 20, netShiftMin: 490 }).state, 'ok');
  assert.equal(shiftFit({ runMin: 430, setupMin: 20, netShiftMin: 490 }).state, 'tight');  // 91.8%
  assert.equal(shiftFit({ runMin: 500, setupMin: 20, netShiftMin: 490 }).state, 'over');
});

test('🔴 ข้อมูลไม่พอ = unknown ห้ามตีเป็น ok', () => {
  assert.equal(shiftFit({ runMin: null, netShiftMin: 490 }).state, 'unknown');
  assert.equal(shiftFit({ runMin: 300, netShiftMin: null }).state, 'unknown');
});

test('🔴 setup ประเมินไม่ได้ ⇒ ยังตอบได้แต่ต้องติดธงว่าต่ำกว่าจริง', () => {
  const f = shiftFit({ runMin: 300, setupMin: null, netShiftMin: 490 });
  assert.equal(f.state, 'ok');
  assert.equal(f.setupKnown, false, 'จอต้องรู้ว่าตัวเลขนี้ยังไม่รวมเวลาเปลี่ยนรุ่น');
});

/* ── ลำดับ ─────────────────────────────────────────────────────────────── */
test('เติมเลขลำดับให้ต่อเนื่อง (คนลากแล้วเลขซ้ำ/หาย)', () => {
  const out = resequence([lot('a', { seq: 1 }), lot('b', { seq: 1 }), lot('c', { seq: 7 })]);
  assert.deepEqual(out.map(l => l.seq), [1, 2, 3]);
});

test('เลื่อนขึ้น/ลง แล้วลำดับยังต่อเนื่อง · เลื่อนเกินขอบไม่พัง', () => {
  const arr = [lot('a', { seq: 1 }), lot('b', { seq: 2 }), lot('c', { seq: 3 })];
  assert.deepEqual(moveLot(arr, 'c', -1).map(l => l.id), ['a', 'c', 'b']);
  assert.deepEqual(moveLot(arr, 'a', -1).map(l => l.id), ['a', 'b', 'c'], 'ตัวแรกเลื่อนขึ้นไม่ได้ = คงเดิม');
  assert.deepEqual(moveLot(arr, 'c', 1).map(l => l.id), ['a', 'b', 'c'], 'ตัวท้ายเลื่อนลงไม่ได้ = คงเดิม');
});

test('💡 ระบบเสนอลำดับ = ไล่ความสูงแม่พิมพ์ทางเดียว', () => {
  const dies = { a: { id: 'D1', die_height_mm: 260 }, b: { id: 'D2', die_height_mm: 200 },
                 c: { id: 'D3', die_height_mm: 230 } };
  const out = suggestSequence([lot('a'), lot('b'), lot('c')], (l) => dies[l.id]);
  assert.deepEqual(out.map(l => l.id), ['b', 'c', 'a']);
  assert.deepEqual(out.map(l => l.seq), [1, 2, 3]);
});

test('🔴 ล็อตที่ไม่รู้แม่พิมพ์/ความสูง ต้องต่อท้าย ห้ามหายจากแผน', () => {
  const dies = { a: { id: 'D1', die_height_mm: 260 }, c: { id: 'D3', die_height_mm: 200 } };
  const out = suggestSequence([lot('a'), lot('b'), lot('c')], (l) => dies[l.id] || null);
  assert.equal(out.length, 3, 'ห้ามตัดทิ้ง');
  assert.equal(out[out.length - 1].id, 'b', 'ตัวที่ไม่มีแม่พิมพ์ต่อท้าย');
});

/* ── เทียบแผน ↔ ของจริง ───────────────────────────────────────────────── */
test('จับคู่ด้วย prod_order_id เท่านั้น + คิดยอดที่ทำได้/ยังขาด', () => {
  const lots = [lot('a', { prod_order_id: 'o1', status: 'started' }), lot('b')];
  const orders = [{ id: 'o1', mat_no: 'M1', status: 'open', qty_actual: 250 }];
  const r = reconcilePlan(lots, orders);
  assert.equal(r.rows[0].donePcs, 250);
  assert.equal(r.rows[0].shortPcs, 350);
  assert.equal(r.rows[1].donePcs, null, 'ยังไม่เริ่ม = ไม่รู้ยอด ห้ามเป็น 0');
  assert.equal(r.plannedNotStarted.length, 1);
});

test('🔴 ใบที่หน้างานเปิดเองนอกแผน ต้องโผล่ ห้ามซ่อน', () => {
  const lots = [lot('a', { prod_order_id: 'o1' })];
  const orders = [{ id: 'o1', mat_no: 'M1', status: 'open' }, { id: 'o9', mat_no: 'M9', status: 'open' }];
  const r = reconcilePlan(lots, orders);
  assert.deepEqual(r.startedNotPlanned.map(o => o.id), ['o9']);
});

test('🔴 พาร์ทเดียวกันวางได้หลายล็อตในกะเดียว — ห้ามจับคู่ด้วย mat_no', () => {
  const lots = [lot('a', { prod_order_id: 'o1' }), lot('b', { mat_no: 'M1' })];
  const orders = [{ id: 'o1', mat_no: 'M1', status: 'confirmed', qty_ok: 600 }];
  const r = reconcilePlan(lots, orders);
  assert.equal(r.rows[0].closed, true);
  assert.equal(r.rows[1].started, false, 'ล็อตที่ 2 ของ mat เดียวกันต้องไม่ถูกจับคู่มั่ว');
});

test('ใบที่ปิดแล้วใช้ qty_ok · ใบที่ยังเปิดใช้ qty_actual', () => {
  const r = reconcilePlan([lot('a', { prod_order_id: 'o1' })],
    [{ id: 'o1', status: 'confirmed', qty_ok: 580, qty_actual: 999 }]);
  assert.equal(r.rows[0].donePcs, 580);
});

/* ── สรุปหัวแผง ────────────────────────────────────────────────────────── */
test('สรุปหัวแผง — ยอดชิ้นบวกทั้งคู่ แต่เวลานับครั้งเดียว', () => {
  const pairOf = (m) => ({ M1: 'M2', M2: 'M1' }[m] || null);
  const s = planSummary({
    lots: [lot('a'), lot('b', { mat_no: 'M2', seq: 2 })],
    orders: [], ctOf, pairOf, dieOf: () => null, rule: RULE, netShiftMin: 490,
  });
  assert.equal(s.qtyPlan, 1200, 'ชิ้น = บวกทั้ง RH+LH (ส่งลูกค้าแยกใบ)');
  assert.equal(s.runMin, 600, 'เวลา = นับ shot ครั้งเดียว');
  assert.equal(s.fit.state, 'over', '600 + setup > 490 ⇒ เตือนว่าเกิน (แต่ไม่บล็อก)');
  assert.equal(s.lotCount, 2);
});

test('เรียงตาม seq เสมอ · seq หายไปให้ไปท้าย', () => {
  const out = sortBySeq([lot('a', { seq: 3 }), lot('b', { seq: null }), lot('c', { seq: 1 })]);
  assert.deepEqual(out.map(l => l.id), ['c', 'a', 'b']);
});

/* ══ 🔴 "ไม่ระบุแม่พิมพ์" ≠ "ไม่ต้องเปลี่ยนรุ่น" (เจอจาก harness 2026-09-30) ══════════════
   sequenceSetup([]) คืน 0 ตามนิยาม (ไม่มีของให้เปลี่ยน) แต่บนจอ "🔧 เปลี่ยนรุ่น 0 น."
   อ่านว่า *ไม่เสียเวลาเลย* — ของจริงคือแม่พิมพ์ 262 ตัวยังไม่ได้กรอกความสูงสักตัว        */
test('🔴 มีงานแต่ไม่ระบุแม่พิมพ์เลย ⇒ setupMin = null + ธง noDie (ห้ามโชว์ 0)', () => {
  const s = planSetup([lot('a'), lot('b', { seq: 2 })], () => null, RULE);
  assert.equal(s.totalMin, null);
  assert.equal(s.noDie, true);
  const sum = planSummary({ lots: [lot('a')], orders: [], ctOf, dieOf: () => null, rule: RULE, netShiftMin: 490 });
  assert.equal(sum.setupMin, null);
  assert.equal(sum.setupNoDie, true);
  assert.equal(sum.setupUnknown, true, 'จอต้องขึ้นแถบเตือน');
});

test('ไม่มีล็อตเลย = ไม่ติดธง noDie (แผนว่างไม่ใช่ข้อมูลขาด)', () => {
  const s = planSetup([], () => null, RULE);
  assert.equal(s.noDie, false);
  assert.equal(s.totalMin, 0);
});

test('ระบุแม่พิมพ์ครบ = คิดเวลาได้ตามปกติ (ไม่ติดธง)', () => {
  const dies = { a: { id: 'D1', die_height_mm: 200 }, b: { id: 'D2', die_height_mm: 260 } };
  const s = planSetup([lot('a', { seq: 1 }), lot('b', { seq: 2 })], (l) => dies[l.id], RULE);
  assert.equal(s.noDie, false);
  assert.equal(s.totalMin, 21);
});

/* ══ 🔴🔴 "ไม่มีแผน" ≠ "แผนอยู่คนละกะ" (เคสจริง 30/09 · user จับได้) ══════════════════
   LINE B วางแผนกะเช้า 6 ล็อต · กะเช้าปิดโดยไม่ได้เริ่มสักใบ · กะดึกเปิดอยู่
   จอเดิมกรอง shift = กะที่เปิด ⇒ 0 แถว ⇒ ไม่วาดอะไรเลย ⇒ กะดึกไม่รู้ว่ามีงานค้าง 6 ล็อต */
import { splitPlanForSession } from '../planLots.js';

test('🔴 แผนของกะก่อนที่ยังไม่ได้เริ่ม ต้องโผล่ให้กะปัจจุบันเห็น (carried)', () => {
  const lots = [
    lot('a', { shift: 'day', seq: 1 }), lot('b', { shift: 'day', seq: 2 }),
    lot('c', { shift: 'night', seq: 1 }),
  ];
  const r = splitPlanForSession(lots, { shift: 'night' });
  assert.deepEqual(r.mine.map(l => l.id), ['c']);
  assert.deepEqual(r.carried.map(l => l.id), ['a', 'b'], 'กะเช้าที่ยังไม่เริ่ม = กะดึกหยิบต่อได้');
  assert.equal(r.hasAny, true);
});

test('แผนกะอื่นที่เริ่มไปแล้ว = แค่บอกให้รู้ ไม่ใช่งานค้างของกะนี้', () => {
  const lots = [
    lot('a', { shift: 'day', status: 'started', prod_order_id: 'o1' }),
    lot('b', { shift: 'day', status: 'done', prod_order_id: 'o2' }),
  ];
  const r = splitPlanForSession(lots, { shift: 'night' });
  assert.equal(r.carried.length, 0);
  assert.deepEqual(r.elsewhere.map(l => l.id), ['a', 'b']);
});

test('🔴 ไม่มีแผนเลยจริงๆ = hasAny false (จอไม่ต้องวาด — ไลน์คัมบังจะได้ไม่รก)', () => {
  assert.equal(splitPlanForSession([], { shift: 'day' }).hasAny, false);
  /* ยกเลิกหมด = ไม่นับว่ามีแผน */
  assert.equal(splitPlanForSession([lot('a', { status: 'cancelled' })], { shift: 'day' }).hasAny, false);
});

test('ล็อตที่ยกเลิกไม่โผล่ในกองไหนเลย', () => {
  const r = splitPlanForSession([lot('a', { shift: 'day', status: 'cancelled' })], { shift: 'night' });
  assert.equal(r.mine.length + r.carried.length + r.elsewhere.length, 0);
});
