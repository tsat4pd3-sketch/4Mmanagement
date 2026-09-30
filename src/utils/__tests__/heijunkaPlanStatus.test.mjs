/* เทส "หลุดแผนไปแค่ไหน" — planStatusOf (2026-09-30 · feedback หน้างาน)
   ที่มา: *"ไม่รู้ว่าดีเลย์หรือหลุดแผนไปแค่ไหน เพราะการ์ดใหม่จะต่อไปเรื่อยๆ"*
   🔴 ชุดนี้ล็อก "ความซื่อสัตย์ของตัวเลข" เป็นหลัก: ไม่มี CT = null ห้าม 0 ·
      หลายพาร์ท CT ต่างกัน = บอกเป็นชิ้นไม่ได้ · ไม่ส่งปลายกะ = ไม่เดาปลายกะให้
   ⏱️ ตรึงเวลาเองทุกเคส ไม่มี Date.now() (กันเทสระเบิดเวลา) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionAllCards, planStatusOf } from '../heijunkaQueue.js';

const T0 = Date.parse('2026-09-01T01:00:00Z');        // 08:00 ไทย
const H = 3600_000, M = 60_000;
const SHIFT_END = T0 + 12 * H;                         // 20:00 ไทย
/* 1 ใบ = 60 ชิ้น × CT 60 วิ = 1 ชม. */
const card = (id, o = {}) => ({
  id, line_name: 'L1', mat_no: 'M1', machine_no: null, status: 'open',
  orderStartMs: T0, orderEndMs: T0 + H, qty: 60, qty_actual: 0, ...o,
});
const pos = (cards, nowMs) => positionAllCards(cards, {
  breaks: [], ctByMat: { M1: 60, M2: 30 }, nowMs,
  roundIndexOf: () => 0, roundStartOf: () => T0,
});
const stat = (cards, nowMs, opt = {}) => planStatusOf({
  positioned: pos(cards, nowMs), cards, breaks: [], ctByMat: { M1: 60, M2: 30 },
  nowMs, shiftEndMs: SHIFT_END, ...opt,
});

test('งานเดินตามแผน = ไม่ช้า ไม่ล้นกะ', () => {
  const s = stat([card('a'), card('b', { orderStartMs: T0 + H, orderEndMs: T0 + 2 * H })], T0 + 30 * M);
  assert.equal(s.slipMin, 0);
  assert.equal(s.overShiftMin, 0);
  assert.equal(s.lateCards, 0);
  assert.equal(s.remainCards, 2);
});

test('⭐ ใบแรกค้าง 3 ชม. → ดันทั้งแถว ⇒ ช้ากว่าแผน ~180 นาที (คำถามหลักของหน้างาน)', () => {
  const now = T0 + 4 * H;   // ผ่านไป 4 ชม. ใบแรก (ควรจบ 1 ชม.) ยังไม่ปิด
  const s = stat([card('a'), card('b'), card('c')], now);
  assert.ok(s.slipMin >= 175 && s.slipMin <= 185, `slip=${s.slipMin}`);
  assert.equal(s.delayed, 1, 'ค้างจริงใบเดียว — แต่ผลกระทบคือ 3 ชม. (นี่คือเหตุผลที่นับใบไม่พอ)');
});

test('⭐ เลขที่บอก "ขนาด" ต้องต่างกัน แม้ "ดีเลย์กี่ใบ" เท่ากัน', () => {
  const small = stat([card('a'), card('b')], T0 + 70 * M);   // เลยแผน 10 นาที
  const big   = stat([card('a'), card('b')], T0 + 6 * H);    // เลยแผน 5 ชม.
  assert.equal(small.delayed, big.delayed, 'นับใบได้เท่ากัน = จอเดิมบอกอะไรไม่ได้');
  assert.ok(big.slipMin - small.slipMin > 240, 'แต่นาทีที่ช้าต้องต่างกันชัดเจน');
});

test('ล้นปลายกะ: บอกทั้งกี่นาทีที่เกิน และกี่ใบที่ไม่ทันกะ', () => {
  const cards = Array.from({ length: 14 }, (_, i) => card(`c${i}`));
  const s = stat(cards, T0 + 2 * H);
  assert.ok(s.overShiftMin > 0, 'งาน 14 ชม. ในกะ 12 ชม. ต้องล้น');
  assert.ok(s.lateCards >= 2 && s.lateCards <= 14, `lateCards=${s.lateCards}`);
});

test('🔴 ไม่ส่งปลายกะมา = ห้ามเดาปลายกะให้ (null ไม่ใช่ 0)', () => {
  const s = stat([card('a')], T0 + 3 * H, { shiftEndMs: null });
  assert.equal(s.overShiftMin, null);
  assert.equal(s.lateCards, null);
});

test('🔴 ไม่มี CT = ประเมินไม่ได้ ⇒ behindMin/behindPcs = null ห้ามเป็น 0', () => {
  const s = planStatusOf({
    positioned: positionAllCards([card('a')], { breaks: [], ctByMat: {}, nowMs: T0 + 3 * H, roundIndexOf: () => 0, roundStartOf: () => T0 }),
    cards: [card('a')], breaks: [], ctByMat: {}, nowMs: T0 + 3 * H, shiftEndMs: SHIFT_END,
  });
  assert.equal(s.noCt, true);
  assert.equal(s.behindMin, null);
  assert.equal(s.behindPcs, null);
});

test('ขาดกี่ชิ้น: พาร์ทเดียว CT 60 วิ · ช้า 30 นาที ⇒ ขาด 30 ชิ้น', () => {
  const s = stat([card('a'), card('b')], T0 + 30 * M);
  assert.equal(s.behindMin, 30, 'ผ่านไป 30 นาที ยังไม่ได้ของเลย');
  assert.equal(s.behindPcs, 30);
  assert.equal(s.pcsCt, 60);
});

test('🔴 หลายพาร์ท CT ไม่เท่ากัน = บอกเป็นชิ้นไม่ได้ (null) แต่ยังบอกเป็นนาทีได้', () => {
  const s = stat([card('a'), card('b', { mat_no: 'M2' })], T0 + 30 * M);
  assert.equal(s.behindPcs, null);
  assert.equal(s.pcsCt, null);
  assert.ok(s.behindMin > 0);
});

test('ยอดที่ทำได้จริงหักหนี้เวลา — ปิดใบครบตามจังหวะ = ไม่ขาด', () => {
  const done = card('a', { isDone: true, qty_ok: 60, confirmed_at: new Date(T0 + H).toISOString() });
  const s = stat([done], T0 + H);
  assert.equal(s.behindPcs, null, 'ไม่มีงานเหลือ = ไม่มีพาร์ทให้อ้าง CT');
  assert.equal(s.behindMin, 0);
  assert.equal(s.remainCards, 0);
  assert.equal(s.finishMs, null, 'ไม่มีงานเหลือ = ไม่มีเวลาคาดจบ');
});

test('ไม่มีงานเหลือ = slipMin null (ไม่ใช่ 0) — "ไม่มีอะไรให้เทียบ" ไม่ใช่ "ตรงแผน"', () => {
  const done = card('a', { isDone: true, qty_ok: 60, confirmed_at: new Date(T0 + H).toISOString() });
  assert.equal(stat([done], T0 + 2 * H).slipMin, null);
});

/* ── 🔴 วันย้อนหลัง: "ตอนนี้" ต้องไม่หลุดกรอบวันงาน (เจอจาก harness 2026-09-30) ──────────
   บอร์ดของวันเก่าที่มีใบไม่เคยถูกปิด — ถ้าเอา Date.now() จริงมาดันคิว จอจะขึ้น
   "ช้ากว่าแผน 1368:00 ชม." (57 วัน) = ตัวเลขขยะที่ทำให้คนเลิกเชื่อจอ */
const FRAME_END = T0 + 24 * H;                 // 08:00 วันถัดไป
const REAL_NOW  = T0 + 57 * 24 * H;            // ผ่านมา 57 วัน (เหมือนเปิดดูวันเก่า)

test('🔴 ดูวันย้อนหลัง: ส่ง frameEndMs ⇒ ช้ากว่าแผนถูกตรึงไว้ในกรอบวันงาน ไม่ใช่ 57 วัน', () => {
  const cards = [card('a'), card('b')];
  const p = positionAllCards(cards, {
    breaks: [], ctByMat: { M1: 60 }, nowMs: REAL_NOW, frameEndMs: FRAME_END,
    roundIndexOf: () => 0, roundStartOf: () => T0,
  });
  const s = planStatusOf({ positioned: p, cards, breaks: [], ctByMat: { M1: 60 },
    nowMs: REAL_NOW, frameEndMs: FRAME_END, shiftEndMs: SHIFT_END });
  assert.ok(s.slipMin <= 24 * 60, `slip=${s.slipMin} ต้องไม่เกิน 1 วันงาน`);
  assert.ok(s.behindMin <= 24 * 60, `behind=${s.behindMin}`);
  /* ⚠️ "คาดจบ" **ยังเลยปลายกรอบวันได้** และนั่นถูกต้อง — งานที่เหลือ 1 ชม. ต่อจากปลายวัน
     คือความจริงว่า "ล้นวันงาน" (บอร์ดมีชิป 🔴 ล้นวันงาน รออยู่แล้ว) · ที่ห้ามคือมันวิ่งตาม
     เวลาปัจจุบันจริงไป 57 วัน */
  assert.ok(s.finishMs <= FRAME_END + 3 * H, `finish เลยกรอบได้แค่เท่างานที่เหลือ (got ${new Date(s.finishMs).toISOString()})`);
  assert.ok(s.finishMs < T0 + 2 * 24 * H, 'ห้ามวิ่งตามเวลาปัจจุบันจริง (57 วัน)');
});

test('ไม่ส่ง frameEndMs = พฤติกรรมเดิมเป๊ะ (ของวันนี้ now ยังไม่ถึงปลายกรอบ ไม่มีผล)', () => {
  const cards = [card('a'), card('b')];
  const mk = (frameEndMs) => planStatusOf({
    positioned: positionAllCards(cards, { breaks: [], ctByMat: { M1: 60 }, nowMs: T0 + 3 * H, frameEndMs, roundIndexOf: () => 0, roundStartOf: () => T0 }),
    cards, breaks: [], ctByMat: { M1: 60 }, nowMs: T0 + 3 * H, frameEndMs, shiftEndMs: SHIFT_END,
  });
  assert.deepEqual(mk(null), mk(FRAME_END));
});

/* ══ 🔴 วันย้อนหลังที่มีใบไม่เคยถูกปิด — วัดกับข้อมูลจริง 2026-09-30 ══════════════════════
   วันงาน 25/09 · LINE A (800 Ton) เหลือ 14 ใบที่ไม่เคยถูกสแกนปิด ⇒ slipMin = 1249 น.
   จอจะขึ้น "⏱️ ช้ากว่าแผน 20:49 ชม." (ต่ำกว่าเพดาน "ค้างข้ามวัน" ที่ 1440 น. จึงไม่เข้าเงื่อนไข)
   ซึ่งเล่าผิดเรื่อง — วันนั้นจบไปแล้ว ไม่มีใครมาปิดอีก ความจริงคือ "14 ใบไม่เคยถูกปิด"       */
test('🔴 ดูวันย้อนหลัง: ใบที่เปิดค้าง ต้องรายงานเป็น neverClosed ไม่ใช่ปล่อยให้อ่านว่าช้ากว่าแผน', () => {
  const cards = [card('a'), card('b', { orderStartMs: T0 + H, orderEndMs: T0 + 2 * H })];
  const nowMs = FRAME_END + 5 * H;                      // ดูวันที่จบไปแล้ว 5 ชม.
  const st = planStatusOf({
    positioned: positionAllCards(cards, { breaks: [], ctByMat: { M1: 60 }, nowMs, frameEndMs: FRAME_END, roundIndexOf: () => 0, roundStartOf: () => T0 }),
    cards, breaks: [], ctByMat: { M1: 60 }, nowMs, frameEndMs: FRAME_END, shiftEndMs: SHIFT_END,
  });
  assert.equal(st.dayOver, true);
  assert.equal(st.neverClosed, 2);
  assert.equal(st.remainCards, 2);
});

test('ดูวันนี้ (วันยังไม่จบ) = neverClosed ต้องเป็น 0 เสมอ (พฤติกรรมเดิมไม่เปลี่ยน)', () => {
  const cards = [card('a'), card('b', { orderStartMs: T0 + H, orderEndMs: T0 + 2 * H })];
  const nowMs = T0 + 3 * H;
  const st = planStatusOf({
    positioned: positionAllCards(cards, { breaks: [], ctByMat: { M1: 60 }, nowMs, frameEndMs: FRAME_END, roundIndexOf: () => 0, roundStartOf: () => T0 }),
    cards, breaks: [], ctByMat: { M1: 60 }, nowMs, frameEndMs: FRAME_END, shiftEndMs: SHIFT_END,
  });
  assert.equal(st.dayOver, false);
  assert.equal(st.neverClosed, 0);
  assert.ok(st.remainCards > 0);
});
