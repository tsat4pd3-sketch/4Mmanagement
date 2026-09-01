import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastRunout, producedOf, remainingOf, byUrgency } from '../wipRunout.js';

const T0 = Date.parse('2026-08-31T01:00:00Z');   // 08:00 ไทย
const HOUR = 3600_000;

// FG "A" ใช้ลูก X 2 ชิ้น/ตัว · CT 60 วิ → กิน X 2 ชิ้นต่อนาที = 120 ชิ้น/ชม.
const bom = { A: [{ mat_no: 'X', qty_per_unit: 2 }], B: [{ mat_no: 'Y', qty_per_unit: 1 }] };
const mk = (o = {}) => ({
  bomOf: (m) => bom[m] || [],
  ctOf: () => 60,
  wipOf: () => 0,
  nowMs: T0,
  ...o,
});

test('WIP พอดี 1 ชม. → runout ที่ +1 ชม.', () => {
  const r = forecastRunout(mk({
    orders: [{ matNo: 'A', qty: 1000, openedAt: '2026-08-31T01:00:00Z' }],
    wipOf: (m) => (m === 'X' ? 120 : null),
  }));
  assert.equal(r.parts[0].reason, 'soon');
  assert.equal(r.parts[0].runoutMs, T0 + HOUR);
  assert.equal(r.firstRunoutMs, T0 + HOUR);
});

test('WIP พอถึงจบแผน → enough ไม่ใช่ runout', () => {
  // 100 ชิ้น × 2 = ต้องใช้ 200 · มี 500
  const r = forecastRunout(mk({
    orders: [{ matNo: 'A', qty: 100, openedAt: '2026-08-31T01:00:00Z' }],
    wipOf: () => 500,
  }));
  assert.equal(r.parts[0].reason, 'enough');
  assert.equal(r.parts[0].runoutMs, null);
  assert.equal(r.firstRunoutMs, null);
});

test('🔴 ไม่มีแถวสต็อก = unknown ห้ามกลายเป็น "ขาดแล้ว"', () => {
  const r = forecastRunout(mk({
    orders: [{ matNo: 'A', qty: 100, openedAt: '2026-08-31T01:00:00Z' }],
    wipOf: () => null,
  }));
  assert.equal(r.parts[0].reason, 'unknown');
  assert.equal(r.parts[0].runoutMs, null);
  assert.equal(r.parts[0].wipNow, null);
});

test('🔴 WIP = 0 จริง (มีแถว) = ขาดแล้ว ต่างจาก unknown', () => {
  const r = forecastRunout(mk({
    orders: [{ matNo: 'A', qty: 100, openedAt: '2026-08-31T01:00:00Z' }],
    wipOf: () => 0,
  }));
  assert.equal(r.parts[0].reason, 'out');
  assert.equal(r.parts[0].runoutMs, T0);
});

test('🔴 หัก WIP ด้วยของที่ผลิตไปแล้ววันนี้ (backflush แบบคำนวณ)', () => {
  // ใบปิดแล้ว 50 ตัว → กิน X ไป 100 · ledger 300 ⇒ เหลือจริง 200
  const r = forecastRunout(mk({
    orders: [
      { matNo: 'A', qty: 50, qtyOk: 50, confirmed: true, openedAt: '2026-08-31T01:00:00Z' },
      { matNo: 'A', qty: 1000, openedAt: '2026-08-31T02:00:00Z' },
    ],
    wipOf: () => 300,
  }));
  const x = r.parts.find(p => p.mat_no === 'X');
  assert.equal(x.consumedDone, 100);
  assert.equal(x.wipNow, 200);
  assert.equal(x.runoutMs, T0 + (200 / 2) * 60 * 1000);   // 100 ตัว × 60 วิ
});

test('ใบที่ทำไปบางส่วน — นับทั้งของที่กินไปแล้วและที่เหลือ', () => {
  const o = { matNo: 'A', qty: 100, qtyActual: 40 };
  assert.equal(producedOf(o), 40);
  assert.equal(remainingOf(o), 60);
  const r = forecastRunout(mk({ orders: [{ ...o, openedAt: '2026-08-31T01:00:00Z' }], wipOf: () => 1000 }));
  const x = r.parts.find(p => p.mat_no === 'X');
  assert.equal(x.consumedDone, 80);    // 40 × 2
  assert.equal(x.need, 120);           // 60 × 2
});

test('🔴 FG ไม่ตั้ง CT → no_ct ห้ามเดาเวลา และต้องรายงานว่าเป็นตัวไหน', () => {
  const r = forecastRunout(mk({
    orders: [{ matNo: 'A', qty: 100, openedAt: '2026-08-31T01:00:00Z' }],
    ctOf: () => 0,
    wipOf: () => 1000,
  }));
  assert.equal(r.parts[0].reason, 'no_ct');
  assert.equal(r.parts[0].runoutMs, null);
  assert.deepEqual(r.noCtMats, ['A']);
  assert.equal(r.horizonMs, null);
});

test('CT หายกลางทาง — ใบก่อนหน้ายังพลอตได้ ใบหลังไม่พลอตแต่ need ต้องนับ', () => {
  const r = forecastRunout(mk({
    orders: [
      { matNo: 'A', qty: 60, openedAt: '2026-08-31T01:00:00Z' },   // 1 ชม. กิน X 120
      { matNo: 'B', qty: 50, openedAt: '2026-08-31T03:00:00Z' },   // ไม่มี CT
    ],
    ctOf: (m) => (m === 'A' ? 60 : 0),
    wipOf: (m) => (m === 'X' ? 60 : 500),
  }));
  const x = r.parts.find(p => p.mat_no === 'X');
  const y = r.parts.find(p => p.mat_no === 'Y');
  assert.equal(x.reason, 'soon');
  assert.equal(x.runoutMs, T0 + HOUR / 2);   // 60 ชิ้น ÷ 2 ต่อชิ้น × 60 วิ = 30 นาที
  assert.equal(y.reason, 'no_ct');
  assert.equal(y.need, 50);                  // ยังนับความต้องการ ไม่ทิ้งเงียบ
});

test('🔴 ไลน์ไม่มีใบเปิด = idle ไม่ใช่ "ของพอ"', () => {
  const r = forecastRunout(mk({
    orders: [{ matNo: 'A', qty: 100, qtyOk: 100, confirmed: true, openedAt: '2026-08-31T01:00:00Z' }],
    wipOf: () => 1000,
  }));
  assert.equal(r.parts.length, 0);           // ไม่เหลือ need → ไม่มีอะไรต้องส่ง
  assert.equal(r.firstRunoutMs, null);
});

test('ใบไม่มีเวลาสแกน (kanban_targets) ไปท้ายคิว', () => {
  const r = forecastRunout(mk({
    orders: [
      { matNo: 'B', qty: 60, openedAt: null },                     // ไม่รู้เวลา → ท้ายสุด
      { matNo: 'A', qty: 60, openedAt: '2026-08-31T01:00:00Z' },
    ],
    wipOf: (m) => (m === 'X' ? 0 : 0),
  }));
  const x = r.parts.find(p => p.mat_no === 'X');
  const y = r.parts.find(p => p.mat_no === 'Y');
  assert.equal(x.runoutMs, T0);              // ใบ A ทำก่อน → X ขาดตั้งแต่ต้น
  assert.equal(y.runoutMs, T0 + HOUR);       // ใบ B ต่อจาก A (A ใช้ 1 ชม.)
});

test('byUrgency — ใครขาดก่อนไปก่อน · ไม่มีเวลาไปท้าย', () => {
  const rows = [
    { line: 'C', firstRunoutMs: null, counts: { unknown: 1 } },
    { line: 'A', firstRunoutMs: T0 + HOUR, counts: {} },
    { line: 'B', firstRunoutMs: T0, counts: {} },
  ].sort(byUrgency);
  assert.deepEqual(rows.map(r => r.line), ['B', 'A', 'C']);
});
