/* ⚡ 25/11 — หน้าประวัติ "N ชม. ล่าสุด" (energyHistory win) · ลิมิต A เทียบเฟสสูงสุด · PF บนบอร์ด · peak ใช้ kw_max */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveBoard, energyHistory } from '../energy.js';

const NOW = Date.parse('2026-11-25T06:00:00Z');          // 13:00 ไทย — ตรึงไว้
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const L = (name, field, value) => ({ scope_kind: 'zone', scope_name: name, field, value, received_at: ago(0) });
const M = { scope_kind: 'zone', scope_name: 'X', panel: 'P', limit_a: 100, sort_order: 0 };

test('ลิมิต A: มีรายเฟสครบ = เทียบเฟสที่สูงสุด (A เฉลี่ยไม่เกินก็ยังเตือน)', () => {
  const live = [L('X', 'a', 90), L('X', 'a1', 80), L('X', 'a2', 85), L('X', 'a3', 105)];
  const b = buildLiveBoard({ meters: [M], live, daily: [], today: '2026-11-25', nowMs: NOW });
  assert.equal(b.meters[0].overA, true);
});
test('ลิมิต A: ไม่มีรายเฟส = ใช้ A ที่ส่งมา (พฤติกรรมเดิม)', () => {
  const b = buildLiveBoard({ meters: [M], live: [L('X', 'a', 90)], daily: [], today: '2026-11-25', nowMs: NOW });
  assert.equal(b.meters[0].overA, false);
});
test('PF: ส่งมา = ค่า · ไม่ส่ง = null (ไม่ใช่ 0)', () => {
  const b1 = buildLiveBoard({ meters: [M], live: [L('X', 'pf', 0.92)], daily: [], today: '2026-11-25', nowMs: NOW });
  assert.equal(b1.meters[0].pf, 0.92);
  const b2 = buildLiveBoard({ meters: [M], live: [L('X', 'kw', 1)], daily: [], today: '2026-11-25', nowMs: NOW });
  assert.equal(b2.meters[0].pf, null);
});

const R = (min, kw, kwh, extra = {}) => ({ scope_name: 'X', bucket_at: ago(min), kw, kwh_total: kwh, ...extra });
test('win = 1 ชม.: ตัวเลขคิดเฉพาะในช่วง · นาทีแรกมีฐานจากจุดก่อนช่วง · แกนเหลือชั่วโมงในช่วง', () => {
  const readings = [R(62, 999, 99), R(61, 10, 100), R(60, 20, 101), R(59, 30, 103), R(58, 40, 106)];   // ทุก 1 นาที
  const win = { a: NOW - 3600000, b: NOW + 60000 };
  const h = energyHistory({ readings, daily: [], names: ['X'], scale: 'day', from: '2026-11-25', to: '2026-11-25', nowMs: NOW, win });
  assert.equal(h.totalKwh, 6);                     // 101-100 + 103-101 + 106-103 — นาที 61 อยู่นอกช่วงแต่ใช้เป็นฐาน
  assert.equal(h.kpi.peakKw, 40);                  // 999 / 10 อยู่นอกช่วง
  assert.ok(h.axis.every(x => x.key >= '2026-11-25 12' && x.key <= '2026-11-25 13'));
});
test('ไม่มี win = พฤติกรรมเดิม · peak ใช้ kw_max เมื่อมี', () => {
  const readings = [R(30, 30, 103, { kw_max: 55 }), R(1, 40, 106)];
  const h = energyHistory({ readings, daily: [], names: ['X'], scale: 'hour', from: '2026-11-25', to: '2026-11-25', nowMs: NOW });
  assert.equal(h.kpi.peakKw, 55);
  assert.equal(h.kpi.avgKw, 35);
});
