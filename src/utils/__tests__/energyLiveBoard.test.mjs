/* ⚡ บอร์ดค่าไฟสด (src/utils/energy.js — buildLiveBoard / liveSeries / meterStatus)
   invariant: ไม่รู้ = null ไม่ใช่ 0 · ค่าเก่าเกินเกณฑ์ไม่ตัดสินเกินลิมิต · ยอดตู้นับเฉพาะเครื่องที่ออนไลน์ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLiveBoard, liveSeries, meterStatus, METER_OFFLINE_MIN } from '../energy.js';

const NOW = Date.parse('2026-11-09T10:00:00Z');          // 17:00 ไทย — ตรึงไว้ (ด่านนาฬิกา +400 วัน)
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const M = (name, extra = {}) => ({ scope_kind: 'zone', scope_name: name, panel: 'MDB-03', limit_kw: 50, limit_a: 100, sort_order: 0, ...extra });
const L = (name, field, value, min = 0) => ({ scope_kind: 'zone', scope_name: name, field, value, received_at: ago(min) });

test('สถานะ: ไม่เคยได้รับ ≠ ขาดการติดต่อ ≠ ออนไลน์', () => {
  assert.equal(meterStatus(null, NOW), 'never');
  assert.equal(meterStatus(ago(1), NOW), 'online');
  assert.equal(meterStatus(ago(METER_OFFLINE_MIN + 1), NOW), 'offline');
});

test('ยอดตู้ = ผลรวมเฉพาะเครื่องที่ออนไลน์ + บอกว่าไม่ครบ', () => {
  const b = buildLiveBoard({
    meters: [M('A', { sort_order: 1 }), M('B', { sort_order: 2 }), M('C', { sort_order: 3 })],
    live: [L('A', 'kw', 30), L('B', 'kw', 20, 10)],          // B ค่าเก่า · C ไม่เคยส่ง
    today: '2026-11-09', nowMs: NOW,
  });
  const p = b.panels[0];
  assert.equal(p.kw, 30);
  assert.equal(p.online, 1);
  assert.equal(p.partial, true);
  assert.deepEqual(b.meters.map(m => m.status), ['online', 'offline', 'never']);
  assert.equal(b.totals.never, 1);
});

test('ไม่มีข้อมูลเลย = null ห้ามเป็น 0', () => {
  const b = buildLiveBoard({ meters: [M('A')], live: [], daily: [], today: '2026-11-09', nowMs: NOW });
  assert.equal(b.totals.kw, null);
  assert.equal(b.totals.todayKwh, null);
  assert.equal(b.totals.monthKwh, null);
  assert.equal(b.totals.avgPerDay, null);
  assert.equal(b.meters[0].kw, null);
  assert.equal(b.panels[0].kw, null);
});

test('เกินลิมิตตัดสินเฉพาะค่าที่ยังสด', () => {
  const b = buildLiveBoard({
    meters: [M('A'), M('B')],
    live: [L('A', 'kw', 60), L('A', 'a', 90), L('B', 'kw', 80, 30), L('B', 'a', 200, 30)],
    today: '2026-11-09', nowMs: NOW,
  });
  const [a, bb] = b.meters;
  assert.equal(a.overKw, true);
  assert.equal(a.overA, false);
  assert.equal(bb.overKw, false);     // ค่าเก่า 30 นาที — ไม่รู้ว่าตอนนี้เกินไหม
  assert.equal(b.totals.alerts.length, 1);
});

test('ยอดวันนี้/เดือนนี้มาจาก energy_daily · เฉลี่ยหารด้วยวันที่มีข้อมูลจริง', () => {
  const b = buildLiveBoard({
    meters: [M('A'), M('B')],
    live: [],
    daily: [
      { scope_kind: 'zone', scope_name: 'A', day: '2026-11-08', kwh: 100, resets: 0 },
      { scope_kind: 'zone', scope_name: 'A', day: '2026-11-09', kwh: 40, peak_kw: 55, resets: 1 },
      { scope_kind: 'zone', scope_name: 'B', day: '2026-11-09', kwh: 10, resets: 0 },
    ],
    today: '2026-11-09', nowMs: NOW,
  });
  assert.equal(b.meters[0].todayKwh, 40);
  assert.equal(b.meters[0].peakKw, 55);
  assert.equal(b.totals.todayKwh, 50);
  assert.equal(b.totals.monthKwh, 150);
  assert.equal(b.totals.monthDays, 2);
  assert.equal(b.totals.avgPerDay, 75);
  assert.equal(b.totals.resets, 1);
});

test('peak ตู้ คิดเฉพาะนาทีที่ทุกเครื่องส่งครบ', () => {
  const meters = [M('A'), M('B')];
  const R = (n, t, kw) => ({ scope_kind: 'zone', scope_name: n, bucket_at: t, kw });
  const { byScope, panelPeak } = liveSeries([
    R('A', '2026-11-09T09:00:00Z', 10), R('B', '2026-11-09T09:00:00Z', 5),
    R('A', '2026-11-09T09:01:00Z', 90),                                     // B ขาด → ห้ามนับเป็น peak
    R('A', '2026-11-09T09:02:00Z', 20), R('B', '2026-11-09T09:02:00Z', 8),
    R('A', '2026-11-09T09:03:00Z', null),
  ], meters);
  assert.equal(byScope.get('zone|A').length, 3);
  assert.deepEqual(panelPeak, { kw: 28, at: Date.parse('2026-11-09T09:02:00Z') });
});

test('ผังโรงงาน: ตู้ที่จ่ายหลายไลน์ → ไม่หารแบ่ง แต่บอกว่ารวมกับไลน์ไหน', async () => {
  const { liveForNames } = await import('../energy.js');
  const b = buildLiveBoard({
    meters: [M('DB-LASER'), M('DB-CNC'), M('DB-ROBOT')],
    live: [L('DB-LASER', 'kw', 120), L('DB-CNC', 'kw', 10), L('DB-ROBOT', 'kw', 30, 20)],   // ROBOT ค่าเก่า
    today: '2026-11-09', nowMs: NOW,
  });
  const ml = new Map([
    ['zone|DB-LASER', new Set(['LASER-345', 'LASER-789'])],
    ['zone|DB-CNC', new Set(['HDF1', 'HDF2'])],
    ['zone|DB-ROBOT', new Set(['HDF1', 'HDF2'])],
  ]);
  const l345 = liveForNames(['LASER-345'], b.meters, ml);
  assert.equal(l345.kw, 120);                           // ค่าเต็มของตู้ ไม่ใช่ 60
  assert.deepEqual(l345.sharedWith, ['LASER-789']);
  assert.equal(l345.over, true);
  const hdf1 = liveForNames(['HDF1'], b.meters, ml);
  assert.equal(hdf1.kw, 10);                            // ROBOT ขาดการติดต่อ → ไม่บวก
  assert.equal(hdf1.online, 1); assert.equal(hdf1.total, 2);
  const hydro = liveForNames(['HYDROFORM', 'HDF1', 'HDF2', 'LASER-345', 'LASER-789'], b.meters, ml);
  assert.equal(hydro.kw, 130);                          // แม่ = ตู้ละครั้ง ไม่นับซ้ำ
  assert.deepEqual(hydro.sharedWith, []);
  assert.equal(liveForNames(['Line 60'], b.meters, ml), null);
  // ทุกตู้ของกรอบไม่ออนไลน์ = null ไม่ใช่ 0
  const b2 = buildLiveBoard({ meters: [M('DB-CNC')], live: [], today: '2026-11-09', nowMs: NOW });
  assert.equal(liveForNames(['HDF1'], b2.meters, ml).kw, null);
});

test('ผังโหมดทบทวน: kWh ของวันจากมิเตอร์ · ตู้ละครั้ง · ไม่มียอด = null', async () => {
  const { dayForNames, meterLinesFrom } = await import('../energy.js');
  const ml = meterLinesFrom([
    { scope_kind: 'zone', scope_name: 'DB-CNC', machines: { line_name: 'HDF1' } },
    { scope_kind: 'zone', scope_name: 'DB-CNC', machines: { line_name: 'HDF2' } },
    { scope_kind: 'zone', scope_name: 'DB-ROBOT', machines: { line_name: 'HDF1' } },
    { scope_kind: 'zone', scope_name: 'DB-ROBOT', machines: { line_name: 'HDF2' } },
    { scope_kind: 'zone', scope_name: 'DB-LASER', machines: { line_name: 'LASER-345' } },
    { scope_kind: 'zone', scope_name: 'DB-LASER', machines: null },
  ]);
  const by = new Map([['zone|DB-CNC', { kwh: 40 }], ['zone|DB-ROBOT', { kwh: 300, resets: 1 }]]);
  const hdf1 = dayForNames(['HDF1'], by, ml);
  assert.equal(hdf1.kwh, 340);
  assert.deepEqual(hdf1.sharedWith, ['HDF2']);
  assert.equal(hdf1.resets, 1);
  const las = dayForNames(['LASER-345'], by, ml);
  assert.equal(las.kwh, null);                 // ตู้ผูกแล้วแต่ไม่มียอดวันนั้น ≠ 0
  assert.equal(las.total, 1);
  assert.equal(dayForNames(['Line 60'], by, ml), null);
});
