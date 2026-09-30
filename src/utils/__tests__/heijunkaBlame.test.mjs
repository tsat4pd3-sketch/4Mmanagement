/* เทส "หลุดมาจากตัวไหน พาลไปโดนตัวไหน" + สรุปรายวัน (2026-09-30 · คำขอทีมปั๊ม)
   🔴🔴 เคสสำคัญสุดคือเคส **สแกนเปิดรวดเดียวตอนต้นกะ** — ทุกใบมี orderStartMs เท่ากันหมด
        ถ้านับ "เริ่มช้ากว่าเวลาเปิด" เป็นดีเลย์ จอจะโทษทุกใบในกะทั้งที่งานเดินปกติ
   ⏱️ ตรึงเวลาเองทุกเคส (กันเทสระเบิดเวลา) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionAllCards, pushChainOf, dayDelaySummaryOf } from '../heijunkaQueue.js';

const T0 = Date.parse('2026-09-01T01:00:00Z');       // 08:00 ไทย
const H = 3600_000, M = 60_000;
const FRAME_END = T0 + 24 * H;
/* ใบละ 1 ชม. · เปิดไล่กันชั่วโมงละใบ (กรณีสแกนเปิดตรงเวลา) */
const card = (id, startH, o = {}) => ({
  id, line_name: 'L1', mat_no: 'M1', machine_no: null, status: 'open',
  orderStartMs: T0 + startH * H, orderEndMs: T0 + (startH + 1) * H,
  qty: 60, qty_actual: 0, ...o,
});
const pos = (cards, nowMs) => positionAllCards(cards, {
  breaks: [], ctByMat: { M1: 60 }, nowMs, frameEndMs: FRAME_END,
  roundIndexOf: () => 0, roundStartOf: () => T0,
});

test('⭐ ใบแรกค้าง → ระบุต้นเหตุได้ 1 ใบ พร้อมรายชื่อใบที่ถูกพาล', () => {
  const now = T0 + 3.5 * H;                    // ใบแรก (ควรจบ 09:00) ยังไม่ปิดถึง 11:30
  const chains = pushChainOf(pos([card('a', 0), card('b', 1), card('c', 2)], now));
  assert.equal(chains.length, 1, 'ต้นเหตุมีใบเดียว');
  assert.equal(chains[0].rootKey, 'a');
  assert.ok(chains[0].ownLateMin >= 145 && chains[0].ownLateMin <= 155, `ownLate=${chains[0].ownLateMin}`);
  assert.deepEqual(chains[0].victims.map(v => v.key), ['b', 'c']);
  assert.equal(chains[0].victimCount, 2);
});

test('🔴🔴 สแกนเปิดรวดเดียวตอนต้นกะ (ทุกใบ orderStartMs = 08:00) และงานเดินปกติ = ห้ามโทษใครเลย', () => {
  const cards = [card('a', 0), card('b', 0), card('c', 0)];   // เปิดพร้อมกันหมด
  /* ปิดตามจังหวะจริง: ใบละ 1 ชม. ⇒ 09:00 / 10:00 / 11:00 */
  cards[0] = { ...cards[0], isDone: true, qty_ok: 60, confirmed_at: new Date(T0 + 1 * H).toISOString() };
  cards[1] = { ...cards[1], isDone: true, qty_ok: 60, confirmed_at: new Date(T0 + 2 * H).toISOString() };
  cards[2] = { ...cards[2], isDone: true, qty_ok: 60, confirmed_at: new Date(T0 + 3 * H).toISOString() };
  const chains = pushChainOf(pos(cards, T0 + 3 * H));
  assert.equal(chains.length, 0, 'เข้าคิวตามธรรมชาติ ไม่ใช่ความเสียหาย — ห้ามมีต้นเหตุ');
});

test('🔴 โทษได้ไม่เกินเวลาที่ต้นเหตุกินเกินจริง (ส่วนที่เหลือคือคิวปกติ)', () => {
  /* ทุกใบเปิด 08:00 พร้อมกัน (สแกนรวด) แล้วใบแรกค้าง 30 นาที
     ⇒ ใบที่ 3 "ถูกดัน" ไป ~2.5 ชม. จากเวลาเปิด แต่ 2 ชม. คือคิวปกติ โทษได้แค่ 30 นาที */
  const cards = [card('a', 0), card('b', 0), card('c', 0)];
  const chains = pushChainOf(pos(cards, T0 + 1.5 * H));
  assert.equal(chains.length, 1);
  const c3 = chains[0].victims.find(v => v.key === 'c');
  assert.ok(c3.pushedMin > 100, `pushed=${c3.pushedMin} (คิวปกติรวมอยู่ด้วย)`);
  assert.ok(c3.blameMin <= chains[0].ownLateMin, 'blame ห้ามเกินเวลาที่ต้นเหตุกินเกิน');
  assert.ok(c3.blameMin <= 35, `blame=${c3.blameMin} ควรอยู่ราว 30 นาที`);
});

test('ใบปิดช้า (ปิดแล้วแต่เลยกรอบ) ก็เป็นต้นเหตุได้ — ไม่ใช่แค่ใบที่ยังค้าง', () => {
  const late = { ...card('a', 0), isDone: true, qty_ok: 60, confirmed_at: new Date(T0 + 3 * H).toISOString() };
  const chains = pushChainOf(pos([late, card('b', 1)], T0 + 4 * H));
  assert.equal(chains.length, 1);
  assert.equal(chains[0].rootKey, 'a');
  assert.ok(chains[0].ownLateMin >= 110, `ownLate=${chains[0].ownLateMin}`);
});

test('คนละเลน (เครื่องขนาน) ห้ามโทษข้ามกัน', () => {
  const cards = [card('a', 0, { machine_no: 'SP-1' }), card('b', 0, { machine_no: 'SP-2' })];
  const chains = pushChainOf(positionAllCards(cards, {
    breaks: [], ctByMat: { M1: 60 }, nowMs: T0 + 3 * H, frameEndMs: FRAME_END,
    roundIndexOf: () => 0, roundStartOf: () => T0,
    flowByLine: { L1: { flow_mode: 'parallel_machine', parallel_stations: 2 } },
  }));
  chains.forEach(c => assert.equal(c.victimCount, 0, 'แต่ละเครื่องมีคิวของตัวเอง ไม่ถีบกัน'));
});

/* ── 📆 สรุปรายวัน ─────────────────────────────────────────────────────────── */
test('⭐ "วันนี้ดีเลย์ไปกี่งาน" ต้องรวมใบที่ปิดช้าไปแล้วด้วย (ไม่ใช่แค่ที่ค้างอยู่ตอนนี้)', () => {
  const lateDone = { ...card('a', 0), isDone: true, qty_ok: 60, confirmed_at: new Date(T0 + 3 * H).toISOString() };
  /* now = 13:00 — ใบ b ถูกดันไปเริ่ม 11:00 ควรจบ 12:00 แต่ยังไม่ปิด ⇒ ค้างอยู่จริง
     (ถ้าใช้ 12:00 พอดี ใบ b จะ "ยังไม่เลยกำหนด" — เส้นแบ่งอยู่ที่ endMs < now เป๊ะๆ) */
  const p = pos([lateDone, card('b', 1)], T0 + 5 * H);
  const d = dayDelaySummaryOf(p, { frameEndMs: FRAME_END });
  assert.equal(d.lateDone, 1, 'ใบที่ช้าแล้วปิดได้ ต้องไม่หายจากสรุปวัน');
  assert.equal(d.stillLate, 1);
  assert.equal(d.lateJobs, 2);
  assert.equal(d.totalJobs, 2);
});

test('ต้องยกยอดไปวันถัดไปกี่ใบ = ใบที่คิวดันไปจบเลยกรอบวันงาน', () => {
  const many = Array.from({ length: 30 }, (_, i) => card(`c${i}`, 0));
  const d = dayDelaySummaryOf(pos(many, T0 + 2 * H), { frameEndMs: FRAME_END });
  assert.ok(d.willCarry > 0, 'งาน 30 ชม. ในวันงาน 24 ชม. ต้องมีใบที่ต้องยกยอด');
  assert.ok(d.willCarry < 30);
});

test('🔴 ไม่ส่งกรอบวันมา = ไม่เดาให้ (willCarry = null ไม่ใช่ 0)', () => {
  assert.equal(dayDelaySummaryOf(pos([card('a', 0)], T0 + 3 * H)).willCarry, null);
});

test('นับใบที่ยกยอดมาจากกะก่อน (หนี้เก่า) แยกจากใบที่จะต้องยกยอดต่อ', () => {
  const carried = card('a', 0, { carry_over_from_session_id: 's-prev' });
  const d = dayDelaySummaryOf(pos([carried], T0 + 30 * M), { frameEndMs: FRAME_END });
  assert.equal(d.carriedIn, 1);
});

test('🔴 วันงานจบแล้ว (ดูย้อนหลัง): "ต้องยกยอด" = ใบที่ปิดไม่ได้ทุกใบ ไม่ใช่เฉพาะที่คาดจบเลยปลายวัน', () => {
  /* 2 ใบเปิดค้าง · now = หลังปลายวันงานไปแล้ว ⇒ ทั้ง 2 ใบคือ "ไม่จบในวันงาน"
     ถ้าใช้สูตร "คาดจบ > ปลายวัน" จะได้ 1 ใบ เพราะเวลาถูก clamp ไว้ที่ปลายวันพอดี
     ⇒ เคยทำให้จอเดียวกันขึ้น 2 เลขขัดกัน (ชิป PLANNER vs สรุปวัน) */
  const cards = [card('a', 0), card('b', 1)];
  const p = positionAllCards(cards, { breaks: [], ctByMat: { M1: 60 }, nowMs: FRAME_END + 2 * H,
    frameEndMs: FRAME_END, roundIndexOf: () => 0, roundStartOf: () => T0 });
  const d = dayDelaySummaryOf(p, { frameEndMs: FRAME_END, nowMs: FRAME_END + 2 * H });
  assert.equal(d.dayOver, true);
  assert.equal(d.willCarry, 2);
});

test('วันนี้ (ยังไม่จบวัน) = ใช้สูตร "คาดจบเลยปลายวัน" ตามเดิม', () => {
  const d = dayDelaySummaryOf(pos([card('a', 0)], T0 + 3 * H), { frameEndMs: FRAME_END, nowMs: T0 + 3 * H });
  assert.equal(d.dayOver, false);
  assert.equal(d.willCarry, 0);
});

/* ══ 🔴🔴 อันดับของ chain — วัดกับข้อมูลจริง 2026-09-30 (วันงาน 25/09 ทั้งโรงงาน) ═══════════
   chain ที่ "พาลคนอื่นจริง" มี 27 ตัว แต่**ถูกบังไม่ขึ้นจอ 22 ตัว** เพราะเรียงด้วย ownLateMin ล้วน
   แล้วใบ manual/ใบที่เปิดคลุมทั้งกะ (กินเกิน 270–806 น. โดยไม่มีใบต่อท้าย) ชนะการเรียงทุกครั้ง
   ⇒ ไลน์ GOR มีตัวจริง 4 ตัว ขึ้นจอ 0 ตัว = จอตอบคำถามทีมปั๊มไม่ได้เลยทั้งที่คำนวณถูก      */
test('🔴 ใบที่พาลคนอื่นจริง ต้องขึ้นก่อนใบที่กินเกินนานกว่าแต่ไม่พาลใคร', () => {
  const now = T0 + 5 * H;
  /* เลน L1: ใบ a ค้าง (กินเกิน ~3 ชม.) แล้วมี b, c ต่อท้าย ⇒ พาล 2 ใบ
     เลน L2: ใบ z ค้างยาวกว่ามาก (กินเกิน ~4 ชม.) แต่ไม่มีใบต่อท้ายเลย ⇒ ไม่พาลใคร */
  const cards = [
    card('a', 0), card('b', 1), card('c', 2),
    { ...card('z', 0), id: 'z', line_name: 'L2', orderEndMs: T0 + 0.5 * H },
  ];
  const chains = pushChainOf(positionAllCards(cards, {
    breaks: [], ctByMat: { M1: 60 }, nowMs: now, frameEndMs: FRAME_END,
    roundIndexOf: () => 0, roundStartOf: () => T0,
  }));
  const z = chains.find(c => c.rootKey === 'z');
  const a = chains.find(c => c.rootKey === 'a');
  assert.equal(a.victimCount > 0, true);
  assert.equal(z.victimCount, 0);
  assert.ok(z.ownLateMin > a.ownLateMin, 'ตั้งเคสให้ใบที่ไม่พาลใครกินเกินนานกว่า');
  assert.ok(chains.indexOf(a) < chains.indexOf(z), 'ใบที่พาลคนอื่นต้องมาก่อนเสมอ');
});

test('ความเสียหายรวม (blameTotalMin) เป็นตัวตัดสินอันดับระหว่างใบที่พาลคนอื่นทั้งคู่', () => {
  const now = T0 + 6 * H;
  const cards = [
    card('a', 0), card('b', 1), card('c', 2),                                  // L1: พาล 2 ใบ
    { ...card('p', 0), id: 'p', line_name: 'L2' },
    { ...card('q', 1), id: 'q', line_name: 'L2' },                             // L2: พาล 1 ใบ
  ];
  const chains = pushChainOf(positionAllCards(cards, {
    breaks: [], ctByMat: { M1: 60 }, nowMs: now, frameEndMs: FRAME_END,
    roundIndexOf: () => 0, roundStartOf: () => T0,
  })).filter(c => c.victimCount > 0);
  assert.ok(chains.length >= 2);
  for (let i = 1; i < chains.length; i++) {
    assert.ok(chains[i - 1].blameTotalMin >= chains[i].blameTotalMin, 'เรียงตามความเสียหายรวมจากมากไปน้อย');
  }
  /* blameTotalMin ต้องเท่ากับ Σ blameMin ของผู้ถูกพาลจริง (ไม่ใช่ ownLateMin) */
  chains.forEach(c => assert.equal(c.blameTotalMin, c.victims.reduce((a, v) => a + v.blameMin, 0)));
});

test('🔴 ใบที่ยังไม่ถูกปิด ต้องติดธง rootUnclosed (จอจะเขียน ≥ กำกับ ห้ามรายงานเป็นเวลาจริง)', () => {
  const now = T0 + 4 * H;
  const open = pushChainOf(pos([card('a', 0), card('b', 1)], now)).find(c => c.rootKey === 'a');
  assert.equal(open.rootUnclosed, true);
  /* ใบที่ปิดช้าแล้ว = รู้เวลาจบจริง ⇒ ไม่ต้องมี ≥ */
  const closed = pushChainOf(pos([
    card('a', 0, { status: 'confirmed', isDone: true, confirmed_at: new Date(T0 + 3 * H).toISOString() }),
    card('b', 1),
  ], now)).find(c => c.rootKey === 'a');
  assert.equal(closed?.rootUnclosed, false);
});
