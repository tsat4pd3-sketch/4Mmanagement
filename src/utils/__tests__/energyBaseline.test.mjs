/* 🍱 Baseline ช่วงพัก (windowAvgKw / baselineCompare · 26/11) — ส่วนต่างเลขมิเตอร์ · ขาด = null ห้ามเดา */
import test from 'node:test';
import assert from 'node:assert/strict';
import { windowAvgKw, baselineCompare } from '../energy.js';

const DAY = Date.parse('2026-11-26T00:00:00+07:00');
const T = (h, m) => DAY + (h * 60 + m) * 60000;
const rows = (name, kw, fromMin, toMin, base = 1000) => {
  const out = [];
  for (let i = fromMin; i <= toMin; i++) out.push({ scope_name: name, bucket_at: new Date(DAY + i * 60000).toISOString(), kwh_total: base + (kw / 60) * (i - fromMin + 1) });
  return out;
};

test('ช่วง 12:00–12:50 จบแล้ว · 2 มิเตอร์ = ผลรวม kW', () => {
  const rd = [...rows('A', 300, 700, 800), ...rows('B', 150, 700, 800)];
  const r = windowAvgKw({ readings: rd, names: ['A', 'B'], startMs: T(12, 0), endMs: T(12, 50) });
  assert.ok(Math.abs(r.kw - 450) < 1e-6);
  assert.equal(r.minutes, 50);
  assert.equal(r.partial, false);
});

test('ช่วงยังไม่จบ = เฉลี่ยถึงนาทีล่าสุดที่ทุกมิเตอร์มี + partial', () => {
  const rd = [...rows('A', 300, 700, 740), ...rows('B', 150, 700, 735)];
  const r = windowAvgKw({ readings: rd, names: ['A', 'B'], startMs: T(12, 0), endMs: T(12, 50) });
  assert.equal(r.partial, true);
  assert.equal(r.minutes, 16);                   // 12:00..12:15 (B มีถึง 12:15)
  assert.ok(Math.abs(r.kw - 450) < 1e-6);
});

test('มิเตอร์ไม่มีข้อมูลในช่วง = null + บอกชื่อ · ขาดจุดก่อนเริ่ม = null', () => {
  const r1 = windowAvgKw({ readings: rows('A', 300, 700, 800), names: ['A', 'B'], startMs: T(12, 0), endMs: T(12, 50) });
  assert.equal(r1.kw, null);
  assert.deepEqual(r1.missing, ['B']);
  const r2 = windowAvgKw({ readings: rows('A', 300, 725, 800), names: ['A'], startMs: T(12, 0), endMs: T(12, 50) });
  assert.equal(r2.kw, null);
});

test('เทียบวันก่อน: เฉลี่ยเฉพาะวันที่คิดได้ · ไม่มีวันก่อน = null', () => {
  const c = baselineCompare(450, [400, null, 500]);
  assert.equal(c.avg, 450); assert.equal(c.n, 2); assert.equal(c.pct, 0);
  assert.equal(baselineCompare(450, [null]).pct, null);
});
