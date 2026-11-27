/* ⏸️ ทำงาน/รอ + ชั่วโมงทำงาน (runStateOf / runMinutes · 27/11) — เกณฑ์ว่าง = ไม่ตัดสิน ห้ามเดา */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runStateOf, runMinutes, buildLiveBoard } from '../energy.js';

test('เกณฑ์ว่าง = null (จอโชว์ "ออนไลน์" ตามเดิม)', () => {
  assert.equal(runStateOf(50, null), null);
  assert.equal(runStateOf(50, undefined), null);
});
test('ต่ำกว่าเกณฑ์ = รอ · ถึงเกณฑ์ = ทำงาน', () => {
  assert.equal(runStateOf(4.9, 5), 'idle');
  assert.equal(runStateOf(5, 5), 'run');
  assert.equal(runStateOf(0, 5), 'idle');
});
test('ไม่ออนไลน์/ไม่มีค่า kW = ไม่ตัดสิน', () => {
  assert.equal(runStateOf(50, 5, 'offline'), null);
  assert.equal(runStateOf(null, 5), null);
});
test('runMinutes: นับนาทีที่ kW ≥ เกณฑ์ · ข้ามนาทีที่ไม่มีค่า', () => {
  const r = runMinutes([{ kw: 10 }, { kw: 2 }, { kw: null }, { kw: 5 }], 5);
  assert.deepEqual(r, { runMin: 2, dataMin: 3, pct: 2 / 3 });
  assert.equal(runMinutes([{ kw: 10 }], null), null);
  assert.equal(runMinutes([], 5).pct, null);
});
test('buildLiveBoard ส่ง idleKw/runState ต่อมิเตอร์', () => {
  const now = Date.parse('2026-11-27T10:00:00Z');
  const recv = new Date(now - 30000).toISOString();
  const b = buildLiveBoard({
    meters: [{ scope_kind: 'zone', scope_name: 'A', panel: 'P', idle_kw: 5 }, { scope_kind: 'zone', scope_name: 'B', panel: 'P' }],
    live: [{ scope_kind: 'zone', scope_name: 'A', field: 'kw', value: 3, received_at: recv }, { scope_kind: 'zone', scope_name: 'B', field: 'kw', value: 3, received_at: recv }],
    today: '2026-11-27', nowMs: now,
  });
  const A = b.meters.find(m => m.name === 'A'), B = b.meters.find(m => m.name === 'B');
  assert.equal(A.idleKw, 5); assert.equal(A.runState, 'idle');
  assert.equal(B.idleKw, null); assert.equal(B.runState, null);
});
