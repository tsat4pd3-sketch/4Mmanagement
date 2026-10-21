/* เติมเต็ม (src/utils/replenish.js) — "ลดต่ำกว่า Max เท่าไหร่ ⇒ ต้องเติมเท่าไหร่"
   🔴 เทสครึ่งหนึ่งของไฟล์นี้คือ "เมื่อไหร่ต้องตอบว่าไม่รู้" — นั่นคือหัวใจของฟีเจอร์
      (วัดจริง 20/10: 252 จาก 332 คู่มี qty_on_hand = 0 ซึ่งแปลว่า "ไม่ได้นับ" ไม่ใช่ "หมด") */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refillNeed, refillSummary, daysSince, STALE_DAYS } from '../replenish.js';

const NOW = '2026-10-21T10:00:00Z';
const fresh = '2026-10-20T08:00:00Z';

test('ของลดต่ำกว่า Max → บอกชิ้นและจำนวนใบคัมบัง', () => {
  const r = refillNeed({ onHand: 1330, max: 1610, perKanban: 70, lastMoveAt: fresh, now: NOW });
  assert.equal(r.state, 'need');
  assert.equal(r.pcs, 280);
  assert.equal(r.cards, 4);          // 280 / 70
});

test('เศษใบต้องปัดขึ้น (ครึ่งใบส่งไม่ได้)', () => {
  const r = refillNeed({ onHand: 518, max: 2268, perKanban: 14, lastMoveAt: fresh, now: NOW });
  assert.equal(r.pcs, 1750);
  assert.equal(r.cards, 125);        // 1750 / 14 = 125 พอดี
  const r2 = refillNeed({ onHand: 0, max: 100, perKanban: 30, lastMoveAt: fresh, now: NOW });
  assert.equal(r2.cards, 4);         // 100/30 = 3.33 → 4
});

test('เต็มแล้ว/เกิน Max = full และ pcs = 0 (ไม่ติดลบ)', () => {
  assert.deepEqual(
    (({ state, pcs, cards }) => ({ state, pcs, cards }))(refillNeed({ onHand: 1470, max: 1330, perKanban: 70, lastMoveAt: fresh, now: NOW })),
    { state: 'full', pcs: 0, cards: 0 });
});

/* ── 🔴 กองที่ต้องตอบว่า "ไม่รู้" ─────────────────────────────────────────────── */
test('ยังไม่ตั้ง Max = unknown ห้ามเดา', () => {
  for (const max of [null, 0, undefined, 'x'])
    assert.equal(refillNeed({ onHand: 10, max, lastMoveAt: fresh, now: NOW }).state, 'unknown');
});

test('🔴 ไม่มีบัญชีคงเหลือ = unknown — ห้ามบีบเป็น 0 แล้วสั่งผลิตเต็ม Max', () => {
  const r = refillNeed({ onHand: null, max: 1000, perKanban: 50, lastMoveAt: fresh, now: NOW });
  assert.equal(r.state, 'unknown');
  assert.equal(r.pcs, null);
  assert.match(r.why, /ไม่มีบัญชี/);
});

test('🔴 ยอด 0 แต่ไม่เคยมีการบันทึกเลย = unknown (0 ไม่ได้แปลว่าของหมด)', () => {
  const r = refillNeed({ onHand: 0, max: 1000, perKanban: 50, lastMoveAt: null, now: NOW });
  assert.equal(r.state, 'unknown');
  assert.match(r.why, /ไม่เคยถูกบันทึก/);
});

test('🔴 ledger ค้างเกินเกณฑ์ = unknown + บอกว่าค้างกี่วัน (เคส Assy GOR ค้าง 9 วัน)', () => {
  const r = refillNeed({ onHand: 518, max: 2268, perKanban: 14, lastMoveAt: '2026-10-12T00:00:00Z', now: NOW });
  assert.equal(r.state, 'unknown');
  assert.equal(r.staleDays, 9);
  assert.match(r.why, /ค้างมา 9 วัน/);
});

test('ขอบเกณฑ์ค้าง — เท่าเกณฑ์ยังเชื่อได้ · เกิน 1 วันคือเชื่อไม่ได้', () => {
  const at = (d) => `2026-10-${String(21 - d).padStart(2, '0')}T10:00:00Z`;
  assert.equal(refillNeed({ onHand: 1, max: 10, lastMoveAt: at(STALE_DAYS), now: NOW }).state, 'need');
  assert.equal(refillNeed({ onHand: 1, max: 10, lastMoveAt: at(STALE_DAYS + 1), now: NOW }).state, 'unknown');
});

test('ไม่รู้ว่า 1 ใบกี่ชิ้น = บอกเป็นใบไม่ได้ (null) แต่ยังบอกชิ้นได้', () => {
  const r = refillNeed({ onHand: 10, max: 100, perKanban: null, lastMoveAt: fresh, now: NOW });
  assert.equal(r.pcs, 90);
  assert.equal(r.cards, null);
});

test('daysSince — อ่านไม่ออก = null ห้ามคืน 0', () => {
  assert.equal(daysSince(null, NOW), null);
  assert.equal(daysSince(fresh, null), null);
  assert.equal(daysSince('ไม่ใช่เวลา', NOW), null);
  assert.equal(daysSince(NOW, NOW), 0);
});

test('สรุปทั้งไลน์ — ต้องบอกด้วยว่าตอบไม่ได้กี่รายการ และตอบได้กี่ %', () => {
  const rows = [
    { need: refillNeed({ onHand: 10, max: 100, perKanban: 10, lastMoveAt: fresh, now: NOW }) },  // need 90 / 9 ใบ
    { need: refillNeed({ onHand: 100, max: 100, perKanban: 10, lastMoveAt: fresh, now: NOW }) }, // full
    { need: refillNeed({ onHand: null, max: 100, lastMoveAt: fresh, now: NOW }) },               // unknown
    { need: refillNeed({ onHand: 5, max: null, lastMoveAt: fresh, now: NOW }) },                 // unknown
  ];
  assert.deepEqual(refillSummary(rows), { need: 1, full: 1, unknown: 2, pcs: 90, cards: 9, coverage: 50 });
});

test('สรุปตอน cards ไม่รู้เลย = null ไม่ใช่ 0', () => {
  const rows = [{ need: refillNeed({ onHand: 1, max: 10, perKanban: null, lastMoveAt: fresh, now: NOW }) }];
  assert.equal(refillSummary(rows).cards, null);
  assert.equal(refillSummary([]).coverage, null);
  assert.deepEqual(refillSummary(null).need, 0);
});
