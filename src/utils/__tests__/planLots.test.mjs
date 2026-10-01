/* เทสแผนสั่งงานรายล็อต (2026-09-30 · คำสั่ง user — งาน lot size ที่ไม่ได้เดินตามคัมบัง)
   🔴 ชุดนี้ล็อก "ความซื่อสัตย์ของตัวเลข" เป็นหลัก:
      ไม่มี CT = null ห้าม 0 · งานคู่ห้ามนับเวลา 2 เท่า · เกินกำลัง = เตือนไม่บล็อก ·
      ใบนอกแผนต้องโผล่ · ล็อตที่ข้อมูลไม่ครบห้ามหายจากลำดับ
   ⏱️ ไม่มี Date.now() (กันเทสระเบิดเวลา) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lotRunMin, lotRunInfo, isTrialLot, planRunMin, planSetup, shiftFit, resequence, moveLot,
  suggestSequence, planSummary, sortBySeq,
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

test('🔴 แผนของกะก่อนต้องโผล่ให้กะปัจจุบันเห็น (other)', () => {
  const lots = [
    lot('a', { shift: 'day', seq: 1 }), lot('b', { shift: 'day', seq: 2 }),
    lot('c', { shift: 'night', seq: 1 }),
  ];
  const r = splitPlanForSession(lots, { shift: 'night' });
  assert.deepEqual(r.mine.map(l => l.id), ['c']);
  assert.deepEqual(r.other.map(l => l.id), ['a', 'b'], 'กะเช้า = กะดึกเห็นและทำต่อได้');
  assert.equal(r.hasAny, true);
});

test('🔴 ห้ามตัดสิน "ทำแล้วหรือยัง" จาก status/prod_order_id — ไม่มีใครเขียนแล้ว', () => {
  /* ตั้งแต่ 01/10 แผนเป็นกรอบล้วน ⇒ ถ้าตัวนี้ยังกรองด้วย status ล็อตจะ "ค้าง" ตลอดกาล
     ความจริงต้องมาจากยอดที่ทำได้ (matchPlanToActual) ที่ชั้นจอ */
  const lots = [lot('a', { shift: 'day', status: 'planned' })];
  const r = splitPlanForSession(lots, { shift: 'night' });
  assert.equal(r.other.length, 1, 'ต้องคืนทุกล็อตของกะอื่น ไม่กรองด้วยสถานะ');
});

test('🔴 ไม่มีแผนเลยจริงๆ = hasAny false (จอไม่ต้องวาด — ไลน์คัมบังจะได้ไม่รก)', () => {
  assert.equal(splitPlanForSession([], { shift: 'day' }).hasAny, false);
  /* ยกเลิกหมด = ไม่นับว่ามีแผน */
  assert.equal(splitPlanForSession([lot('a', { status: 'cancelled' })], { shift: 'day' }).hasAny, false);
});

test('ล็อตที่ยกเลิกไม่โผล่ในกองไหนเลย', () => {
  const r = splitPlanForSession([lot('a', { shift: 'day', status: 'cancelled' })], { shift: 'night' });
  assert.equal(r.mine.length + r.other.length, 0);
  assert.equal(r.hasAny, false);
});

/* ══ 🧩 Layer 1 (แผน) ↔ Layer 2 (ของจริง) — จับคู่จากยอดรวม (2026-10-01 · คำสั่ง user) ═══════
   วัดจากฐานจริง 25/09: 1 พาร์ท 1 กะ = ใบผลิต 5–40 ใบ (คัมบัง 1 ใบ = 1 กล่อง) manual = 0
   ⇒ 1 ล็อตแผน ≠ 1 ใบผลิต · แผนต้องไม่ออกใบ (ไม่งั้นเป้าถูกนับซ้ำกับคัมบังที่สแกนจริง)      */
import { matchPlanToActual, orderDonePcs } from '../planLots.js';

const ord = (mat, o = {}) => ({ id: `o-${Math.random()}`, mat_no: mat, status: 'confirmed', qty_ok: 10, ...o });

test('⭐ 1 ล็อตแผน = ใบคัมบังหลายใบ — รวมยอดแล้วเทียบกับกรอบ', () => {
  /* เคสจริง LINE B: แผน 1,000 ชิ้น · หน้างานสแกน 7 ใบ × 60 = 420 */
  const lots = [lot('a', { mat_no: 'M1', qty_plan: 1000 })];
  const orders = Array.from({ length: 7 }, () => ord('M1', { qty_ok: 60 }));
  const r = matchPlanToActual(lots, orders);
  assert.equal(r.rows[0].donePcs, 420);
  assert.equal(r.rows[0].pct, 42);
  assert.equal(r.rows[0].state, 'partial');
  assert.equal(r.rows[0].fromOrders, 7, 'จอต้องบอกได้ว่ามาจากกี่ใบ');
});

test('ทำครบ = done · ยังไม่เริ่ม = pending (ยอด 0 ไม่ใช่ null)', () => {
  const lots = [lot('a', { mat_no: 'M1', qty_plan: 100 }), lot('b', { mat_no: 'M2', qty_plan: 50, seq: 2 })];
  const r = matchPlanToActual(lots, [ord('M1', { qty_ok: 100 })]);
  assert.equal(r.rows[0].state, 'done');
  assert.equal(r.rows[1].state, 'pending');
  assert.equal(r.rows[1].donePcs, 0);
});

test('🔴 พาร์ทเดียวกันหลายล็อต — ปันตามลำดับ seq จนเต็มแล้วค่อยล้นใบถัดไป', () => {
  const lots = [lot('a', { mat_no: 'M1', qty_plan: 100, seq: 1 }),
                lot('b', { mat_no: 'M1', qty_plan: 100, seq: 2 })];
  const r = matchPlanToActual(lots, [ord('M1', { qty_ok: 150 })]);
  assert.equal(r.rows[0].donePcs, 100, 'ล็อตแรกเต็มก่อน');
  assert.equal(r.rows[1].donePcs, 50);
  assert.equal(r.over.length, 0);
});

test('🔴 ทำเกินแผนต้องโชว์ ห้ามกลืน', () => {
  const r = matchPlanToActual([lot('a', { mat_no: 'M1', qty_plan: 100 })], [ord('M1', { qty_ok: 130 })]);
  assert.equal(r.rows[0].donePcs, 100);
  assert.deepEqual(r.over.map(o => [o.mat_no, o.pcs]), [['M1', 30]]);
});

test('🔴 พาร์ทที่ผลิตจริงแต่ไม่มีในแผน = offPlan ต้องโชว์', () => {
  const r = matchPlanToActual([lot('a', { mat_no: 'M1', qty_plan: 100 })],
    [ord('M1', { qty_ok: 100 }), ord('M9', { qty_ok: 55 }), ord('M9', { qty_ok: 45 })]);
  assert.deepEqual(r.offPlan.map(o => [o.mat_no, o.pcs, o.orders]), [['M9', 100, 2]]);
});

test('ใบที่ยังไม่ปิดใช้ qty_actual · ปิดแล้วใช้ qty_ok', () => {
  assert.equal(orderDonePcs({ status: 'open', qty_actual: 30, qty_ok: 999 }), 30);
  assert.equal(orderDonePcs({ status: 'confirmed', qty_ok: 58, qty_actual: 999 }), 58);
  assert.equal(orderDonePcs({ status: 'open' }), 0, 'ไม่มียอด = 0 ไม่ใช่ NaN');
});

test('ล็อตที่ยกเลิกไม่กินยอด — ยอดไปลงล็อตที่ยังอยู่', () => {
  const lots = [lot('x', { mat_no: 'M1', qty_plan: 100, seq: 1, status: 'cancelled' }),
                lot('b', { mat_no: 'M1', qty_plan: 100, seq: 2 })];
  const r = matchPlanToActual(lots, [ord('M1', { qty_ok: 80 })]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].donePcs, 80);
});

test('สรุปรวม % ของทั้งแผน', () => {
  const lots = [lot('a', { mat_no: 'M1', qty_plan: 100 }), lot('b', { mat_no: 'M2', qty_plan: 100, seq: 2 })];
  const r = matchPlanToActual(lots, [ord('M1', { qty_ok: 100 }), ord('M2', { qty_ok: 50 })]);
  assert.equal(r.planPcs, 200);
  assert.equal(r.donePcs, 150);
  assert.equal(r.pct, 75);
  assert.equal(r.doneLots, 1);
  assert.equal(r.startedLots, 2);
});

test('ไม่มีใบผลิตเลย = ทุกล็อต pending · ไม่พัง', () => {
  const r = matchPlanToActual([lot('a', { mat_no: 'M1', qty_plan: 100 })], []);
  assert.equal(r.pct, 0);
  assert.equal(r.rows[0].state, 'pending');
  assert.equal(r.offPlan.length, 0);
});

/* ══ 🧪 ใบจองเครื่องทดลองงานใหม่ (2026-10-01 · หน้างานแจ้ง "new model มาขอ trial เครื่อง") ══
   โจทย์: พาร์ทใหม่ **ยังไม่มีในระบบ** (SAP ยังไม่ออกเลข MAT) และ **ไม่มี CT แน่ๆ**
   แต่มันกินเวลาเครื่องจริง ⇒ ถ้าไม่อยู่ในแผน ไทม์ไลน์จะบอกว่าไลน์ว่างทั้งที่เครื่องถูกยึด */
const trial = (id, o = {}) => ({
  id, work_date: '2026-10-01', shift: 'day', line_name: 'L1', seq: 1,
  source: 'trial', mat_no: null, qty_plan: 50, status: 'planned',
  trial_part_no: 'MB3B-99Z999-AA', trial_part_name: 'BRKT NEW MODEL', est_min: 240, ...o,
});

test('🧪 เวลาของใบทดลองมาจาก "ที่ขอ" (est_min) ไม่ใช่ qty × CT', () => {
  assert.equal(lotRunMin(trial('t1')), 240);
  const i = lotRunInfo(trial('t1'));
  assert.equal(i.from, 'est', '🔴 จอต้องรู้ว่าเลขนี้คนกรอก ไม่ใช่ระบบคำนวณ');
  assert.equal(isTrialLot(trial('t1')), true);
  assert.equal(isTrialLot(lot('a')), false);
});

test('🧪 est_min ชนะ CT เสมอเมื่อกรอก (คนวางแผนรู้ดีกว่าสูตรว่างานนี้กินเครื่องกี่ชั่วโมง)', () => {
  const l = lot('a', { est_min: 90 });                 // ปกติ 600 × 60 ÷ 60 = 600 นาที
  assert.equal(lotRunMin(l, ctOf), 90);
  assert.equal(lotRunInfo(l, ctOf).from, 'est');
});

test('🔴 ใบทดลองที่ลืมกรอกเวลา = ประเมินไม่ได้ ต้องนับแยก ห้ามเงียบ', () => {
  const r = planRunMin([trial('t1', { est_min: null })], ctOf);
  assert.equal(r.min, null, 'ประเมินไม่ได้ = null ห้าม 0');
  assert.deepEqual(r.noCt, [], 'ไม่มี mat ให้บอกชื่อ');
  assert.equal(r.noTimeLots, 1, '🔴 ต้องนับไว้ ไม่งั้นจอเขียน "0 พาร์ทไม่มี CT" ทั้งที่มีงานประเมินไม่ได้');
});

test('🧪 เวลาทดลองบวกเข้าภาระกะจริง · แต่ไม่ถูกยุบคู่ RH/LH (เป็นเวลานาฬิกา ไม่ใช่ shot)', () => {
  const pairOf = (m) => (m === 'M1' ? 'M2' : m === 'M2' ? 'M1' : null);
  const r = planRunMin([lot('a', { mat_no: 'M1', qty_plan: 60 }), trial('t1', { seq: 2, est_min: 120 })], ctOf, pairOf);
  assert.equal(r.estMin, 120);
  assert.equal(r.min, 60 + 120, 'งานผลิต 60 นาที + เวลาที่ขอ 120 นาที');
});

test('🔴 ใบทดลองห้ามเข้าการจับคู่ยอดจริง — state = trial ไม่ใช่ pending', () => {
  const m = matchPlanToActual(
    [lot('a', { mat_no: 'M1', qty_plan: 100, seq: 1 }), trial('t1', { seq: 2 })],
    [{ id: 'o1', mat_no: 'M1', status: 'confirmed', qty_ok: 100 }],
  );
  const t = m.rows.find(r => r.lot.id === 't1');
  assert.equal(t.state, 'trial', '🔴 pending = ค้าง "ยังไม่เริ่ม" ตลอดกาลบนจอ');
  assert.equal(t.donePcs, null, 'ตอบไม่ได้ ไม่ใช่ 0');
  assert.equal(m.planPcs, 100, 'ยอดชิ้นของกรอบไม่รวมของทดลอง');
  assert.equal(m.pct, 100, 'ใบทดลองต้องไม่ถ่วง % ความคืบหน้าของงานผลิต');
  assert.deepEqual(m.offPlan, [], 'พาร์ทที่ผลิตจริงตรงกับแผน ⇒ ไม่มีงานนอกแผน');
});

test('🧪 สรุปหัวแผงแยกงานทดลองออกจากงานผลิต (คนละเรื่อง คนละเจ้าของ)', () => {
  const s = planSummary({
    lots: [lot('a', { mat_no: 'M1', qty_plan: 60, seq: 1 }), trial('t1', { seq: 2, est_min: 180 })],
    orders: [], ctOf, netShiftMin: 470,
  });
  assert.equal(s.trialCount, 1);
  assert.equal(s.trialMin, 180);
  assert.equal(s.qtyPlan, 60, 'ยอดชิ้นไม่รวมของทดลอง');
  assert.equal(s.lotCount, 2, 'แต่จำนวนล็อตในคิวนับทั้งหมด (มันกินเวลาเครื่องจริง)');
  assert.equal(s.runMin, 60 + 180);
});
