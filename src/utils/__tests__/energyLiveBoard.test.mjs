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

test('กราฟจิ๋วบนผัง: เฉลี่ยราย 15 นาที · รวมตู้ · ช่วงที่ตู้ขาดไม่นับ', async () => {
  const { bucketByMeter, sparkForNames, meterLinesFrom } = await import('../energy.js');
  const R = (n, t, kw) => ({ scope_kind: 'zone', scope_name: n, bucket_at: t, kw });
  const b = bucketByMeter([
    R('A', '2026-11-10T00:00:00Z', 10), R('A', '2026-11-10T00:05:00Z', 20),   // ช่วง 00:00 เฉลี่ย 15
    R('B', '2026-11-10T00:01:00Z', 5),
    R('A', '2026-11-10T00:15:00Z', 30),                                       // ช่วง 00:15 B ขาด → ไม่นับ
    R('A', '2026-11-10T00:30:00Z', 40), R('B', '2026-11-10T00:31:00Z', 6),
    R('A', '2026-11-10T00:45:00Z', null),
  ]);
  const ml = meterLinesFrom([
    { scope_kind: 'zone', scope_name: 'A', machines: { line_name: 'HDF1' } },
    { scope_kind: 'zone', scope_name: 'B', machines: { line_name: 'HDF2' } },
  ]);
  assert.deepEqual(sparkForNames(['HDF1', 'HDF2'], b, ml), [20, 46]);
  assert.deepEqual(sparkForNames(['HDF1'], b, ml), [15, 30, 40]);
  assert.deepEqual(sparkForNames(['Line 60'], b, ml), []);
});

test('🌳 ผังหลายชั้น: ยอดตู้/ยอดรวมนับชั้นบนสุด (ไม่นับซ้ำ) · ไฟไม่มีมิเตอร์วัด = แม่ − ลูก', async () => {
  const b = buildLiveBoard({
    meters: [
      M('MDB', { panel: 'MDB' }), M('MDB-07', { panel: 'X', parent_name: 'MDB' }), M('AIR', { panel: 'Y', parent_name: 'MDB-07' }),
      M('AC-06', { parent_name: 'AIR' }), M('AC-07', { parent_name: 'AIR' }), M('DB-CNC'),
    ],
    live: [L('MDB', 'kw', 900), L('MDB-07', 'kw', 60), L('AIR', 'kw', 56), L('AC-06', 'kw', 20), L('AC-07', 'kw', 30), L('DB-CNC', 'kw', 10)],
    daily: [{ scope_kind: 'zone', scope_name: 'MDB', day: '2026-11-09', kwh: 100 }, { scope_kind: 'zone', scope_name: 'AC-06', day: '2026-11-09', kwh: 40 }],
    today: '2026-11-09', nowMs: NOW,
  });
  assert.equal(b.totals.kw, 910);                          // MDB + DB-CNC (ลูกอยู่ในยอด MDB แล้ว)
  assert.equal(b.totals.todayKwh, 100);
  const mdb = b.panels.find(p => p.panel === 'MDB');
  assert.equal(mdb.kw, 900); assert.equal(mdb.total, 1); assert.equal(mdb.nested, true);
  assert.equal(mdb.meters.length, 5);                       // ลูกตามรากมาอยู่ตู้ MDB แม้ panel ของลูกเขียนอื่น
  const by = Object.fromEntries(b.meters.map(m => [m.name, m]));
  assert.equal(by['AC-06'].depth, 3);
  assert.deepEqual(by.AIR.unmetered, { kw: 6, state: 'ok' });
  assert.equal(by.MDB.unmetered.kw, 840);
  assert.equal(by['DB-CNC'].unmetered, null);
  assert.equal(b.panels.find(p => p.panel === 'MDB-03').nested, false);   // ตู้เดิมไม่ตั้งแม่ = เหมือนเดิม
});

test('🌳 แม่หาย/วน = ถือเป็นชั้นบนสุด + เตือน · ลูกออฟไลน์ = ไม่รู้ไฟที่ไม่มีมิเตอร์ (ห้ามเดา) · ลูกเกินแม่ = negative', () => {
  const b = buildLiveBoard({
    meters: [M('P'), M('C1', { parent_name: 'P' }), M('C2', { parent_name: 'P' }), M('O', { parent_name: 'NOPE' }), M('X', { parent_name: 'Y' }), M('Y', { parent_name: 'X' })],
    live: [L('P', 'kw', 10), L('C1', 'kw', 8), L('C2', 'kw', 1, 10)],
    today: '2026-11-09', nowMs: NOW,
  });
  assert.deepEqual(b.warnings.orphans, [{ name: 'O', parent: 'NOPE' }]);
  assert.ok(b.warnings.cycles.length >= 1);
  assert.equal(b.meters.find(m => m.name === 'P').unmetered.state, 'unknown');
  const b2 = buildLiveBoard({ meters: [M('P'), M('C1', { parent_name: 'P' })], live: [L('P', 'kw', 10), L('C1', 'kw', 20)], today: '2026-11-09', nowMs: NOW });
  assert.equal(b2.meters.find(m => m.name === 'P').unmetered.state, 'negative');
});

test('🌳 liveForNames: แม่กับลูกอยู่กรอบเดียวกัน = นับแม่ตัวเดียว', async () => {
  const { liveForNames } = await import('../energy.js');
  const b = buildLiveBoard({ meters: [M('P'), M('C', { parent_name: 'P' })], live: [L('P', 'kw', 10), L('C', 'kw', 4)], today: '2026-11-09', nowMs: NOW });
  const ml = new Map([['zone|P', new Set(['L1'])], ['zone|C', new Set(['L1'])]]);
  assert.equal(liveForNames(['L1'], b.meters, ml).kw, 10);
});

test('🔌 รายเฟส: ไม่สมดุล = เบี่ยงมากสุด/เฉลี่ย · kW รายเฟสประมาณจากสัดส่วนกระแส · ไม่มีค่า = null', async () => {
  const { phaseInfo, loadShare } = await import('../energy.js');
  const p = phaseInfo([392, 391, 393], [58.6, 45.7, 45.4], 28.21);
  assert.ok(Math.abs(p.imbalancePct - 17.5) < 0.2);                     // จอ Node-RED "ไม่สมดุล 17.5%" (ค่าในภาพปัดทศนิยมแล้ว ⇒ 17.4)
  assert.equal(Math.round(p.kwEst[0] * 100) / 100, 11.04);                // L1 11.04 kW (Node-RED)
  assert.equal(phaseInfo([null, null, null], [null, null, null], 10), null);
  const part = phaseInfo([392, null, null], [10, null, 12], 5);
  assert.equal(part.imbalancePct, null); assert.deepEqual(part.kwEst, [null, null, null]);
  const b = buildLiveBoard({
    meters: [M('A'), M('B'), M('C', { parent_name: 'A' })],
    live: [L('A', 'kw', 30), L('B', 'kw', 10), L('C', 'kw', 20), L('A', 'a1', 10), L('A', 'a2', 10), L('A', 'a3', 10)],
    today: '2026-11-09', nowMs: NOW,
  });
  assert.equal(b.meters.find(m => m.name === 'A').phase.imbalancePct, 0);
  assert.equal(b.meters.find(m => m.name === 'B').phase, null);
  const sh = loadShare(b.meters);
  assert.equal(sh.total, 40); assert.equal(sh.rows.length, 2);            // ลูก C ไม่นับซ้ำ
});

test('📈 ประวัติ: kWh ต่อชั่วโมงจากส่วนต่างเลขมิเตอร์ (reset ไม่นับ) · ต่อวันจาก energy_daily · ไม่มีข้อมูล = null · ความครบ', async () => {
  const { energyHistory, minuteKwh } = await import('../energy.js');
  const at = (hm) => new Date(Date.parse(`2026-11-20T${hm}:00+07:00`)).toISOString();
  const R = (hm, k, kw = 10) => ({ scope_name: 'A', bucket_at: at(hm), kwh_total: k, kw, v: 395, a: 40 });
  const readings = [R('09:00', 100), R('09:01', 101), R('09:02', 103, 30), R('09:03', 50), R('09:04', 51), R('10:00', 60)];
  const mk = minuteKwh(readings);
  assert.deepEqual(mk.map(x => x.kwh), [1, 2, 1]);                       // ถอยหลัง (reset) และห่าง > 5 นาที = ข้าม
  const h = energyHistory({ readings, names: ['A'], scale: 'hour', from: '2026-11-20', to: '2026-11-20', nowMs: Date.parse(at('10:00')) });
  assert.equal(h.kwh.A['2026-11-20 09'], 4);
  assert.equal(h.kwh.A['2026-11-20 10'], null);                           // ไม่มีส่วนต่าง = null ไม่ใช่ 0
  assert.equal(h.totalKwh, 4);
  assert.equal(h.kpi.peakKw, 30); assert.equal(h.kpi.aMax, 40);
  assert.ok(h.kpi.coverage > 0 && h.kpi.coverage < 0.1);                 // 6 นาทีจาก 120 นาที
  const d = energyHistory({ daily: [{ scope_name: 'A', day: '2026-11-18', kwh: 400, peak_kw: 70, peak_at: at('13:00') }, { scope_name: 'A', day: '2026-11-19', kwh: 500 }],
    names: ['A'], scale: 'month', from: '2026-11-01', to: '2026-11-20', nowMs: Date.parse(at('10:00')) });
  assert.equal(d.kwh.A['2026-11'], 900); assert.equal(d.kpi.peakKw, 70); assert.equal(d.kpi.coverage, null);
});
