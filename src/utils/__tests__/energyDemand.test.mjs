/* ⚡ Demand 15 นาที (demandWindows · 25/11) — ส่วนต่างเลขมิเตอร์ ÷ 0.25 ชม. · ขาดจุด = null ห้ามเดา */
import test from 'node:test';
import assert from 'node:assert/strict';
import { demandWindows, demandKwFromKwh } from '../energy.js';

const DAY = Date.parse('2026-11-25T00:00:00+07:00');
const T = (h, m) => DAY + (h * 60 + m) * 60000;
/** มิเตอร์ใช้ไฟคงที่ kw ต่อเนื่อง: เลขมิเตอร์ปลายนาที = kw/60 ต่อนาที */
const rows = (name, kw, fromMin, toMin, base = 1000) => {
  const out = [];
  for (let i = fromMin; i <= toMin; i++) out.push({ scope_name: name, bucket_at: new Date(DAY + i * 60000).toISOString(), kwh_total: base + (kw / 60) * (i - fromMin + 1) });
  return out;
};

test('โหลดคงที่ 2 มิเตอร์ = demand เท่าผลรวม kW · ช่วงปัจจุบันเฉลี่ย + คาดการณ์', () => {
  const rd = [...rows('A', 600, 0, 13 * 60 + 5), ...rows('B', 300, 0, 13 * 60 + 5)];
  const d = demandWindows({ readings: rd, names: ['A', 'B'], nowMs: T(13, 5) + 30000, dayStartMs: DAY, kwNow: 900 });
  assert.equal(d.current.start, T(13, 0));
  assert.equal(d.current.elapsedMin, 6);
  assert.ok(Math.abs(d.current.avgKw - 900) < 1e-6);
  assert.ok(Math.abs(d.current.projectedKw - 900) < 1e-6);
  assert.ok(Math.abs(d.prev.kw - 900) < 1e-6);
  assert.equal(d.prev.start, T(12, 45));
  assert.equal(d.windows[0].kw, null);                 // ช่วงแรกของวันไม่มีจุดก่อน 00:00 = null ไม่ใช่ 0
});

test('มิเตอร์หนึ่งขาดจุดขอบช่วง = ช่วงนั้น null · ไม่นับเป็นสูงสุดวันนี้', () => {
  const b = rows('B', 300, 0, 120).filter(r => Date.parse(r.bucket_at) < T(0, 50) || Date.parse(r.bucket_at) > T(1, 5));
  const d = demandWindows({ readings: [...rows('A', 600, 0, 120), ...b], names: ['A', 'B'], nowMs: T(2, 0), dayStartMs: DAY });
  const w = d.windows.find(x => x.start === T(1, 0));
  assert.equal(w.kw, null);
  assert.ok(Math.abs(d.todayMax.kw - 900) < 1e-6);
  assert.deepEqual(d.missing, []);
});

test('มิเตอร์ชั้นบนสุดไม่มีเลขมิเตอร์เลย = ทุกค่า null + บอกชื่อใน missing', () => {
  const d = demandWindows({ readings: rows('A', 600, 0, 30), names: ['A', 'B'], nowMs: T(0, 31), dayStartMs: DAY, kwNow: 600 });
  assert.deepEqual(d.missing, ['B']);
  assert.equal(d.current.avgKw, null);
});

test('ช่วงที่โหลดสูง = สูงสุดวันนี้ · ไม่มี kW ตอนนี้ = คาดการณ์ null (ห้ามเดา)', () => {
  const a = rows('A', 600, 0, 60).concat(rows('A', 1200, 61, 75, 1000 + 10 * 61)).concat(rows('A', 600, 76, 95, 1000 + 10 * 61 + 20 * 15));
  const d = demandWindows({ readings: a, names: ['A'], nowMs: T(1, 35) + 1000, dayStartMs: DAY, kwNow: null });
  assert.equal(d.todayMax.start, T(1, 0));
  assert.ok(d.todayMax.kw > 1100);
  assert.equal(d.current.projectedKw, null);
});

test('ไม่มีมิเตอร์ = null', () => {
  assert.equal(demandWindows({ readings: [], names: [], nowMs: T(1, 0), dayStartMs: DAY }), null);
});

test('kWh ของช่วง 15 นาที → kW เฉลี่ย (ใช้ร่วมกับค่าสูงสุดเดือนจาก DB) · ไม่รู้ = null', () => {
  assert.equal(demandKwFromKwh(309), 1236);
  assert.equal(demandKwFromKwh(null), null);
  assert.equal(demandKwFromKwh('x'), null);
});
