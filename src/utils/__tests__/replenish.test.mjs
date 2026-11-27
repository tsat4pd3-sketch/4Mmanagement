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

/* ═══ 🔴 ด่านความสดของบัญชี (16/11) ════════════════════════════════════════════
   วัดจริง: 41 คู่ที่ตั้ง min → ติด min 32 คู่ และ **ทั้ง 32 คู่คงเหลือ 0 เป๊ะ**
   ไม่มีคู่ไหนมีของเหลือบางส่วนเลย · บัญชีขยับล่าสุด 30/10 (17 วันก่อน) · 7 คู่ไม่เคยขยับ
   ⇒ "0" คือ "ไม่ได้นับ" ไม่ใช่ "ของหมด" — ปล่อยผ่าน = จอขึ้นติด min 32 ตัวที่ผิดทั้งหมด */
const NOW16 = '2026-11-16T03:00:00Z';

test('🔴 บัญชีไม่ขยับเกินเกณฑ์ = unknown ห้ามรายงานว่าติด min', () => {
  const r = minAlerts([LV('20059152', 6000, null)], () => 0, () => 'LINE D',
    { lastMoveOf: () => '2026-10-30T00:00:00Z', now: NOW16 })[0];
  assert.equal(r.state, 'unknown');
  assert.equal(r.staleDays, 17);
  assert.match(r.why, /ไม่ขยับมา 17 วัน/);
});

test('🔴 บัญชีไม่เคยขยับเลย = unknown (เคส 7 คู่ที่วัดได้)', () => {
  const r = minAlerts([LV('X', 100, null)], () => 0, () => 'L',
    { lastMoveOf: () => null, now: NOW16 })[0];
  assert.equal(r.state, 'unknown');
  assert.match(r.why, /ไม่เคยขยับ/);
});

test('บัญชีสด = ติด min ได้ตามปกติ · ขอบเกณฑ์ไม่พลิกก่อน', () => {
  const at = (iso) => minAlerts([LV('X', 100, null)], () => 80, () => 'L',
    { lastMoveOf: () => iso, now: NOW16 })[0].state;
  assert.equal(at('2026-11-15T03:00:00Z'), 'at_min');          // 1 วัน
  assert.equal(at('2026-11-13T03:00:00Z'), 'at_min');          // 3 วัน = เท่าเกณฑ์
  assert.equal(at('2026-11-12T03:00:00Z'), 'unknown');         // 4 วัน = เกิน
});

test('ไม่ส่ง lastMoveOf = ไม่ตรวจความสด (พฤติกรรมเดิมเป๊ะ)', () => {
  assert.equal(minAlerts([LV('X', 100, null)], () => 0)[0].state, 'at_min');
});

test('ด่านความสดไม่แตะของที่ "พอ" — ของพอก็คือพอ ไม่ต้องสนใจว่าบัญชีเก่าแค่ไหน', () => {
  const r = minAlerts([LV('X', 100, null)], () => 500, () => 'L',
    { lastMoveOf: () => '2026-01-01T00:00:00Z', now: NOW16 })[0];
  assert.equal(r.state, 'ok');
});

/* ═══ 🔎 "ทะเบียนตั้ง min ผิดที่" (18/11 · วัดจริง 35/41 คู่) ════════════════════════
 * โซ่จริง: ไลน์ปั๊ม ──issue──▶ STORE ──ใบขอเติม──▶ ไลน์ประกอบ ──คอนเฟิร์ม FG──▶ consume
 * ทะเบียนตั้ง min ที่ไลน์ปั๊ม = บัญชีที่นั่นนิ่งถาวร ⇒ ต้องชี้ที่จริงให้คนแก้ ไม่ใช่บอก "ตอบไม่ได้"
 * ═════════════════════════════════════════════════════════════════════════════════ */
const EL = (line, lastAt = '2026-11-18T03:00:00Z', moves = 291) => () => ({ line_name: line, lastAt, moves });

test('🔎 บัญชีที่ไลน์ทะเบียนนิ่ง + ของขยับที่อื่น = ติดธง wrongPlace + ชี้ชื่อที่จริง', () => {
  const r = minAlerts([LV('X', 2400, null)], () => 0, () => 'LINE C',
    { lastMoveOf: () => '2026-10-27T00:00:00Z', movesElsewhereOf: EL('STORE'), now: NOW16 })[0];
  assert.equal(r.state, 'unknown');                 // ยัง "ติด min" ไม่ได้ — ของไม่ได้อยู่ที่นี่
  assert.equal(r.wrongPlace, true);
  assert.equal(r.elsewhere.line_name, 'STORE');
  assert.equal(r.elsewhere.moves, 291);
  assert.match(r.why, /ขยับจริงที่ "STORE"/);
  assert.match(r.why, /2026-11-18/);
  assert.match(r.why, /ตั้ง min ผิดที่/);
});

test('🔎 บัญชีไม่เคยขยับเลย + ของขยับที่อื่น = ติดธงเหมือนกัน (เคส 3 คู่ที่ไม่มีบัญชี)', () => {
  const r = minAlerts([LV('X', 600, null)], () => 0, () => 'LINE D',
    { lastMoveOf: () => null, movesElsewhereOf: EL('Assembly Line D - GWM&RA'), now: NOW16 })[0];
  assert.equal(r.state, 'unknown');
  assert.equal(r.wrongPlace, true);
  assert.match(r.why, /ไม่เคยขยับ/);
  assert.match(r.why, /Assembly Line D - GWM&RA/);
});

test('🔴 ที่จริง = ไลน์เดิม ⇒ ห้ามติดธง (บัญชีเก่าจริงๆ ไม่ใช่ตั้งผิดที่ · 3 คู่ที่ LINE D)', () => {
  const r = minAlerts([LV('X', 3600, null)], () => 0, () => 'L',
    /* 🔴 'Line 60' = ไลน์ในทะเบียน (`LV` ตั้งไว้) · 'L' คือไลน์เจ้าของงาน — คนละแกน ห้ามปน */
    { lastMoveOf: () => '2026-10-21T00:00:00Z', movesElsewhereOf: EL('Line 60'), now: NOW16 })[0];
  assert.equal(r.state, 'unknown');
  assert.equal(r.wrongPlace, false);
  assert.equal(r.elsewhere, null);
  assert.doesNotMatch(r.why, /ผิดที่/);
});

test('🔴 ไม่ส่ง movesElsewhereOf = พฤติกรรมเดิมเป๊ะ (ข้อความไม่เปลี่ยน)', () => {
  const a = minAlerts([LV('X', 100, null)], () => 0, () => 'L',
    { lastMoveOf: () => '2026-10-30T00:00:00Z', now: NOW16 })[0];
  assert.equal(a.wrongPlace, false);
  assert.equal(a.elsewhere, null);
  assert.match(a.why, /ไม่ขยับมา 17 วัน \(ล่าสุด 2026-10-30\) — ยอดคงเหลือเชื่อเป็นของจริงไม่ได้$/);
});

test('🔴 movesElsewhereOf โยน/คืนค่าขยะ = ไม่ติดธง ไม่พัง (อ่านไม่ได้ ≠ ตั้งผิดที่)', () => {
  const run = (fn) => minAlerts([LV('X', 100, null)], () => 0, () => 'L',
    { lastMoveOf: () => '2026-10-30T00:00:00Z', movesElsewhereOf: fn, now: NOW16 })[0];
  for (const fn of [() => { throw new Error('boom'); }, () => null, () => ({}), () => ({ line_name: '  ' }), () => 7]) {
    const r = run(fn);
    assert.equal(r.wrongPlace, false, String(fn));
    assert.equal(r.elsewhere, null);
  }
});

test('🔴 ของยังพอ = ok ไม่ติดธง (ธงนี้ใช้อธิบาย "ตอบไม่ได้" เท่านั้น)', () => {
  const r = minAlerts([LV('X', 100, null)], () => 500, () => 'L',
    { lastMoveOf: () => '2026-01-01T00:00:00Z', movesElsewhereOf: EL('STORE'), now: NOW16 })[0];
  assert.equal(r.state, 'ok');
  assert.equal(r.wrongPlace, false);
});

test('minAlertSummary — wrongPlace แยกออกจากกองตอบไม่ได้ทั่วไป', () => {
  const rows = minAlerts(
    [LV('A', 2400, null), LV('B', 2400, null), LV('C', 100, null)],
    (ln, mat) => (mat === 'C' ? 500 : 0), () => 'L',
    { lastMoveOf: (ln, mat) => (mat === 'A' ? '2026-10-27T00:00:00Z' : null),
      movesElsewhereOf: (ln, mat) => (mat === 'A' ? { line_name: 'STORE', lastAt: '2026-11-18T00:00:00Z' } : null),
      now: NOW16 });
  const s = minAlertSummary(rows);
  assert.equal(s.unknown, 2);        // A (นิ่ง) + B (ไม่มีบัญชี)
  assert.equal(s.wrongPlace, 1);     // เฉพาะ A ที่ชี้ที่จริงได้ = แก้ได้
  assert.equal(s.ok, 1);
});
