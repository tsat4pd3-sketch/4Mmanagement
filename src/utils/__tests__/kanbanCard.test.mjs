import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_STATES, CARD_FLOW, nextCardState, canMoveCard, cardNo,
  planCards, suggestWithdraw, pickWalkOrder, cabinetSummary } from '../kanbanCard.js';

/* ── ลูปของใบ = ลูปของกล่องจริง (ติดกล่อง → ไลน์ → ตู้ → สโตร์เก็บ → ส่งกลับ) ───── */

test('nextCardState: วนกลับที่เดิม · สถานะไม่รู้จัก = null ห้ามเดา', () => {
  assert.equal(nextCardState('at_line'), 'in_box');
  assert.equal(nextCardState('in_box'), 'picking');
  assert.equal(nextCardState('picking'), 'delivering');
  assert.equal(nextCardState('delivering'), 'at_line');   // ของถึงไลน์ = เริ่มรอบใหม่
  assert.equal(nextCardState('มั่ว'), null);
  assert.equal(nextCardState(null), null);
});

test('ทะเบียนสถานะครบทุกตัวใน flow — ห้าม hardcode สตริงในหน้า', () => {
  CARD_FLOW.forEach(k => {
    assert.ok(CARD_STATES[k], `ขาดทะเบียนของสถานะ ${k}`);
    assert.ok(CARD_STATES[k].label && CARD_STATES[k].act, `สถานะ ${k} ต้องมีทั้ง label และคำบนปุ่ม`);
  });
  assert.equal(Object.keys(CARD_STATES).length, CARD_FLOW.length);
});

test('canMoveCard: เดินทีละขั้น · ข้ามขั้นต้องบอกเหตุผล', () => {
  assert.equal(canMoveCard('at_line', 'in_box').ok, true);
  const skip = canMoveCard('at_line', 'delivering');
  assert.equal(skip.ok, false);
  assert.match(skip.why, /ทีละขั้น/);
  assert.equal(canMoveCard('at_line', 'at_line').ok, false);        // อยู่แล้ว
  assert.equal(canMoveCard('มั่ว', 'in_box').ok, false);
  /* ถอยหลังได้เมื่อมีเหตุผล (สโตร์เก็บผิดใบ) — ผู้เรียกบังคับกรอกเหตุผลเอง */
  assert.equal(canMoveCard('picking', 'in_box', { allowBack: true }).ok, true);
  assert.equal(canMoveCard('picking', 'in_box').ok, false);
});

test('cardNo: MAT + ลำดับ 2 หลัก · ค่าไม่ครบ = null', () => {
  assert.equal(cardNo('30051864', 3), '30051864-03');
  assert.equal(cardNo('30051864', 12), '30051864-12');
  assert.equal(cardNo('', 1), null);
  assert.equal(cardNo('30051864', 0), null);
});

/* ── ออกใบ = ระบบเสนอ ไม่เขียนเอง ──────────────────────────────────────────── */

test('planCards: ทะเบียนไม่ครบ = ออกใบไม่ได้ ห้ามเดา', () => {
  assert.equal(planCards({ matNo: 'A', lineName: 'L1', totalCards: null, qtyPerCard: 600 }).ok, false);
  assert.equal(planCards({ matNo: 'A', lineName: 'L1', totalCards: 8, qtyPerCard: null }).ok, false);
  assert.match(planCards({ matNo: 'A', lineName: 'L1', totalCards: 8, qtyPerCard: 0 }).why, /ชิ้นต่อใบ/);
  assert.match(planCards({ matNo: '', lineName: 'L1', totalCards: 8, qtyPerCard: 600 }).why, /พาร์ท/);
});

test('planCards: ออกเฉพาะใบที่ยังไม่มี · ใบเดิมห้ามแตะ', () => {
  const r = planCards({ matNo: '30051864', lineName: 'Line 061', totalCards: 4, qtyPerCard: 600,
    fromLocation: 'P411', existing: [{ seq: 1, is_active: true }, { seq: 3, is_active: true }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.toCreate.map(c => c.seq), [2, 4]);
  assert.equal(r.toCreate[0].card_no, '30051864-02');
  assert.equal(r.toCreate[0].qty_per_card, 600);     // snapshot ตอนออก
  assert.equal(r.toCreate[0].from_location, 'P411');
  assert.equal(r.keep, 2);
});

test('planCards: ใบเกินจำนวน = เสนอให้ถอน ไม่ลบให้เอง', () => {
  const r = planCards({ matNo: 'A', lineName: 'L1', totalCards: 2, qtyPerCard: 100,
    existing: [{ seq: 1, is_active: true }, { seq: 2, is_active: true }, { seq: 3, is_active: true }] });
  assert.deepEqual(r.toRetire.map(c => c.seq), [3]);
  assert.deepEqual(r.toCreate, []);
  assert.equal(r.keep, 2);
});

/* ── ระบบเสนอ คนตัดสิน ─────────────────────────────────────────────────────── */

test('suggestWithdraw: ไม่รู้ว่ากินไปเท่าไหร่ = ไม่เสนอ ห้ามเดาว่าหมด', () => {
  const card = { state: 'at_line', qty_per_card: 600 };
  assert.equal(suggestWithdraw({ card, consumedSince: null }).suggest, false);
  assert.equal(suggestWithdraw({ card, consumedSince: undefined }).suggest, false);
  assert.equal(suggestWithdraw({ card: { state: 'at_line', qty_per_card: 0 }, consumedSince: 999 }).suggest, false);
});

test('suggestWithdraw: ถึงโควตากล่องถึงเสนอ · ใบที่ไม่ได้อยู่ที่ไลน์ไม่เสนอ', () => {
  const card = { state: 'at_line', qty_per_card: 600 };
  assert.equal(suggestWithdraw({ card, consumedSince: 599 }).suggest, false);
  const hit = suggestWithdraw({ card, consumedSince: 600 });
  assert.equal(hit.suggest, true);
  assert.match(hit.reason, /600/);
  assert.equal(hit.ratio, 1);
  /* ใบที่อยู่ในตู้/กำลังส่ง ไม่มีอะไรให้ถอด */
  assert.equal(suggestWithdraw({ card: { state: 'in_box', qty_per_card: 600 }, consumedSince: 9999 }).suggest, false);
});

/* ── 🚶 ลดการเดิน ───────────────────────────────────────────────────────────── */

test('pickWalkOrder: เรียงตามโซนหยิบ · ใบที่ไม่รู้โซนไปท้ายคิว ห้ามทิ้ง', () => {
  const r = pickWalkOrder([
    { card_no: 'c1', from_location: 'P420', line_name: 'L2' },
    { card_no: 'c2', from_location: null,   line_name: 'L1' },
    { card_no: 'c3', from_location: 'P411', line_name: 'L1' },
    { card_no: 'c4', from_location: 'P411', line_name: 'L3' },
  ]);
  assert.deepEqual(r.rows.map(x => x.card_no), ['c3', 'c4', 'c1', 'c2']);
  assert.equal(r.rows.length, 4);        // ไม่มีใบหาย
  assert.equal(r.zones, 2);
  assert.equal(r.unknown, 1);
  assert.equal(r.rows[3].zoneUnknown, true);
});

test('pickWalkOrder: zoneOf กำหนดเองได้ (โซนจริงอาจไม่ใช่ from_location)', () => {
  const r = pickWalkOrder([{ card_no: 'a', from_location: 'Z9' }, { card_no: 'b', from_location: 'Z1' }],
    (c) => (c.card_no === 'a' ? 'A1' : 'B2'));
  assert.deepEqual(r.rows.map(x => x.card_no), ['a', 'b']);
});

/* ── สรุปตู้ ───────────────────────────────────────────────────────────────── */

test('cabinetSummary: อ่านใบไม่ได้ = null ห้ามคืน 0', () => {
  assert.equal(cabinetSummary(null), null);
  assert.equal(cabinetSummary(undefined), null);
  assert.deepEqual(cabinetSummary([]), { waiting: 0, oldestMin: null, suggested: 0, total: 0 });
});

test('cabinetSummary: นับใบรอสโตร์ + ใบที่ระบบเสนอ + รอนานสุดกี่นาที (now ตรึงได้)', () => {
  const now = '2026-11-25T10:00:00Z';
  const s = cabinetSummary([
    { state: 'in_box', state_at: '2026-11-25T09:00:00Z' },
    { state: 'in_box', state_at: '2026-11-25T09:45:00Z' },
    { state: 'at_line', suggested_at: '2026-11-25T09:50:00Z' },
    { state: 'delivering', state_at: '2026-11-25T08:00:00Z' },
  ], now);
  assert.equal(s.waiting, 2);
  assert.equal(s.oldestMin, 60);
  assert.equal(s.suggested, 1);
  assert.equal(s.total, 4);
});

test('cabinetSummary: เวลาเสียรูป = ไม่โยน error · oldestMin คงเป็น null', () => {
  const s = cabinetSummary([{ state: 'in_box', state_at: 'มั่ว' }], '2026-11-25T10:00:00Z');
  assert.equal(s.waiting, 1);
  assert.equal(s.oldestMin, null);
});

/* ── 🔖 QR ของใบ — ใช้ uuid ไม่ใช่เลขใบ (เลขใบเปลี่ยนได้ตอนทะเบียนปรับจำนวน) ───── */
import { QR_KINDS, buildQrPayload, parseQrPayload } from '../qrCode.js';

test('QR ใบคัมบัง: ESM:K:<uuid> · อ่านกลับได้ชนิด card', () => {
  assert.equal(QR_KINDS.card.code, 'K');
  const id = '11111111-2222-3333-4444-555555555555';
  const payload = buildQrPayload('card', id);
  assert.equal(payload, `ESM:K:${id}`);
  const back = parseQrPayload(payload);
  assert.equal(back.kind, 'card');
  assert.equal(back.id, id);
});

test('QR: รหัสชนิดห้ามชนกัน (เพิ่มชนิดใหม่แล้วทับของเดิม = ป้ายเก่าอ่านผิด)', () => {
  const codes = Object.values(QR_KINDS).map(k => k.code);
  assert.equal(new Set(codes).size, codes.length);
});
