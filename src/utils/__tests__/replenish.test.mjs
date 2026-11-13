/* เติมเต็ม (src/utils/replenish.js) — "ลดต่ำกว่า Max เท่าไหร่ ⇒ ต้องเติมเท่าไหร่"
   🔴 เทสครึ่งหนึ่งของไฟล์นี้คือ "เมื่อไหร่ต้องตอบว่าไม่รู้" — นั่นคือหัวใจของฟีเจอร์
      (วัดจริง 20/10: 252 จาก 332 คู่มี qty_on_hand = 0 ซึ่งแปลว่า "ไม่ได้นับ" ไม่ใช่ "หมด") */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refillNeed, refillSummary, daysSince, STALE_DAYS, minAlerts, minAlertSummary, isFgMat } from '../replenish.js';

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

/* ═══ 🔔 ของถึง min → ส่งความต้องการไปหาไลน์เจ้าของงาน + ฝ่ายวางแผน (13/11) ══════════
   วัดจริงวันนั้น: ทะเบียน 74 แถว · ชิ้นส่วน 41 (ไม่มี max เลยสักแถว · ไม่มีบัญชี 7 · ติด min 32)
   · FG ปนมา 32 แถว ซึ่งห้ามมี min ที่ไลน์ */
const LV = (mat, min, max, line = 'Line 60', part = '') => ({ line_name: line, mat_no: mat, min_qty: min, max_qty: max, part_name: part });

test('ติด min = ต้องรู้ min + ยอดที่นับแล้ว · เกิน min = ยังพอ', () => {
  const rows = minAlerts([LV('20058498', 100, null), LV('20058495', 100, null)],
    (ln, m) => (m === '20058498' ? 80 : 500), () => 'Assy GOR');
  assert.equal(rows[0].state, 'at_min');
  assert.equal(rows[0].ownerLine, 'Assy GOR');
  assert.equal(rows[1].state, 'ok');
});

test('🔴 ไม่มีบัญชี = unknown ห้ามนับเป็นติด min (ไม่เคยนับ ≠ ของหมด)', () => {
  const r = minAlerts([LV('20058498', 100, null)], () => null)[0];
  assert.equal(r.state, 'unknown');
  assert.equal(r.refillPcs, null);
  assert.match(r.why, /ไม่เคยนับ/);
});

test('🔴 ไม่รู้ max = ติด min ได้ แต่บอก "ต้องผลิตเท่าไหร่" ไม่ได้ (null ห้ามเดา)', () => {
  const noMax = minAlerts([LV('20058498', 100, null)], () => 80)[0];
  assert.equal(noMax.state, 'at_min');
  assert.equal(noMax.refillPcs, null);
  const withMax = minAlerts([LV('20058498', 100, 500)], () => 80)[0];
  assert.equal(withMax.refillPcs, 420);
});

test('ยอดเท่ากับ min พอดี = ติด min แล้ว (min คือ "ถึงจุดสั่ง" ไม่ใช่ "ต่ำกว่าจุดสั่ง")', () => {
  assert.equal(minAlerts([LV('20058498', 100, null)], () => 100)[0].state, 'at_min');
});

test('ยังไม่ตั้ง min = unknown ห้ามเงียบ', () => {
  for (const m of [null, 0, undefined, 'x'])
    assert.equal(minAlerts([LV('X', m, null)], () => 10)[0].state, 'unknown');
});

test('🔴 ไลน์เจ้าของงานมาจาก Product Master ไม่ใช่ไลน์ที่ของกอง (แจ้งผิดไลน์ = คนไม่ได้เตรียม)', () => {
  const r = minAlerts([LV('10086024', 100, null, 'FG WAREHOUSE')], () => 10, () => 'Assy GOR')[0];
  assert.equal(r.line_name, 'FG WAREHOUSE');   // ของกองอยู่ที่คลัง
  assert.equal(r.ownerLine, 'Assy GOR');       // แต่คนที่ต้องเตรียมคือไลน์นี้
});

test('🔴 FG ติดธงไว้ ห้ามกรองทิ้งเงียบ (ทะเบียนเปื้อนต้องเห็นถึงจะมีคนไปล้าง)', () => {
  assert.equal(isFgMat('10086024'), true);
  assert.equal(isFgMat('20058498'), false);
  const rows = minAlerts([LV('10086024', 100, null), LV('20058498', 100, null)], () => 10);
  assert.equal(rows.length, 2, 'ห้ามหายไปจากลิสต์');
  assert.equal(rows.filter(r => r.fgNotAllowed).length, 1);
});

test('เรียง: ติด min ก่อน → ขาดลึกสุดก่อน → ตอบไม่ได้ต่อท้าย', () => {
  const rows = minAlerts([
    LV('A', 100, null), LV('B', 100, null), LV('C', 100, null), LV('D', 100, null),
  ], (ln, m) => ({ A: 90, B: 10, C: 500, D: null }[m]));
  assert.deepEqual(rows.map(r => r.mat_no), ['B', 'A', 'C', 'D']);
});

test('สรุปหัวข้อ — ต้องบอกได้ว่าติดกี่ตัว ตอบไม่ได้กี่ตัว และกี่ตัวที่ยังไม่รู้ว่าต้องผลิตเท่าไหร่', () => {
  const rows = minAlerts([
    LV('20058498', 100, null), LV('20058495', 100, 400), LV('10086024', 100, null), LV('20066660', 100, null),
  ], (ln, m) => ({ '20058498': 80, '20058495': 80, '10086024': 80, '20066660': null }[m]), () => 'Assy GOR');
  const s = minAlertSummary(rows);
  assert.equal(s.atMin, 3);
  assert.equal(s.unknown, 1);
  assert.equal(s.noMax, 2);     // 20058498 + 10086024 ติด min แต่ไม่รู้ max
  assert.equal(s.fgRows, 1);
  assert.equal(s.lines, 1);
});

test('ลิสต์ว่าง/ข้อมูลเพี้ยน ต้องไม่ระเบิด', () => {
  assert.deepEqual(minAlerts([], () => 1), []);
  assert.deepEqual(minAlerts(null, () => 1), []);
  assert.equal(minAlertSummary([]).atMin, 0);
  assert.equal(minAlerts([null, LV('A', 100, null)], () => 1).length, 1);
});
