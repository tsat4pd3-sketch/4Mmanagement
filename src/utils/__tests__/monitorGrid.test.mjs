import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECUR, recurDef, buildDayPeriods, buildWeekPeriods, buildDatePeriods,
  buildGrid, valueAt, cellAt, slSummary, minBreaches, firstShortDate,
  gridSummary, rawPieces, rawKgNeeded, rawCoverage, rackCount,
} from '../monitorGrid.js';

/* ชุดแถวตามไฟล์จริง (800T = ไม่มี WIP · 110T = มี WIP) */
const PRESS = [
  { key: 'plan',    label: 'PLAN',    kind: 'input' },
  { key: 'in',      label: 'IN',      kind: 'system' },
  { key: 'unbound', label: 'UNBOUND', kind: 'recur', recur: 'plan_backlog' },
  { key: 'out',     label: 'OUT',     kind: 'system' },
  { key: 'balance', label: 'BALANCE', kind: 'recur', recur: 'stock_run' },
  { key: 'min',     label: 'MIN',     kind: 'const' },
];
const PRESS_WIP = [...PRESS.slice(0, 5), { key: 'wip', label: 'WIP', kind: 'input' }, PRESS[5]];

const mk = (map) => (pid, rk, pk) => {
  const v = map[`${pid}|${rk}|${pk}`];
  return v === undefined ? undefined : v;
};

/* ── ค่าจริงจาก 1.Monitoring-Oct.xlsx ชีท 800T พาร์ทที่ 1 (BHS07706/BHS08555 STEP 1) ──
   ตรึงไว้เพราะเป็น "คำตอบที่ถูก" ที่ทีมวางแผนใช้อยู่จริง — เพี้ยนจากนี้คือเราผิด ไม่ใช่เขาผิด */
test('800T พาร์ท 1 — ตรงกับไฟล์ Excel จริงทุกคอลัมน์', () => {
  const periods = buildDayPeriods('2026-09-30', 6);
  const manual = {
    'p|plan|2026-09-30': 2000, 'p|in|2026-09-30': 100, 'p|unbound|2026-09-30': -1700,
    'p|out|2026-09-30': 700, 'p|balance|2026-09-30': 200, 'p|min|2026-09-30': 1800,
    'p|out|2026-10-01': 700, 'p|out|2026-10-02': 800,
  };
  const g = buildGrid({ parts: [{ id: 'p' }], periods, rows: PRESS, manual: mk(manual) });
  const row = (rk) => periods.map((x) => valueAt(g, 'p', rk, x.key));
  assert.deepEqual(row('unbound'), [-1700, -1700, -1700, -1700, -1700, -1700]);
  assert.deepEqual(row('balance'), [200, -500, -1300, -1300, -1300, -1300]);
  assert.deepEqual(row('min'),     [1800, 1800, 1800, 1800, 1800, 1800]);
});

/* 110T พาร์ท 1 — แผนค้าง -2400 ถูกเคลียร์เป็น 0 เพราะวันถัดมาผลิต 4800 เทียบแผน 2400 */
test('110T พาร์ท 1 — ตรงกับไฟล์ Excel จริง (ผลิตเกินแผนเคลียร์ยอดค้าง)', () => {
  const periods = buildDayPeriods('2026-09-30', 5);
  const manual = {
    'p|unbound|2026-09-30': -2400, 'p|out|2026-09-30': 400,
    'p|balance|2026-09-30': 1600, 'p|min|2026-09-30': 4800,
    'p|plan|2026-10-01': 2400, 'p|in|2026-10-01': 4800,
  };
  const g = buildGrid({ parts: [{ id: 'p' }], periods, rows: PRESS_WIP, manual: mk(manual) });
  const row = (rk) => periods.map((x) => valueAt(g, 'p', rk, x.key));
  assert.deepEqual(row('unbound'), [-2400, 0, 0, 0, 0]);
  assert.deepEqual(row('balance'), [1600, 6400, 6400, 6400, 6400]);
  assert.deepEqual(row('min'),     [4800, 4800, 4800, 4800, 4800]);
  /* WIP ไม่มีสูตร = ว่างทั้งแถว ห้ามกลายเป็น 0 */
  assert.deepEqual(row('wip'), [null, null, null, null, null]);
});

/* ── กฎความซื่อสัตย์: ไม่ใส่ยอดยกมา = null ทั้งแถว ห้ามเดา 0 ─────────────────────── */
test('ไม่ใส่ยอดยกมา = ทั้งแถวเป็น null (ห้ามเดา 0)', () => {
  const periods = buildDayPeriods('2026-10-01', 4);
  const g = buildGrid({
    parts: [{ id: 'p' }], periods, rows: PRESS,
    manual: mk({ 'p|in|2026-10-02': 500, 'p|out|2026-10-03': 200 }),
  });
  for (const x of periods) {
    assert.equal(valueAt(g, 'p', 'balance', x.key), null, `balance ${x.key} ต้องเป็น null`);
    assert.equal(valueAt(g, 'p', 'unbound', x.key), null, `unbound ${x.key} ต้องเป็น null`);
    assert.equal(cellAt(g, 'p', 'balance', x.key).src, 'unknown');
  }
});

test('ช่องว่างกลางแถว = 0 ของวันนั้น (ไม่ใช่ไม่รู้) — สต๊อกต้องนิ่ง ไม่ใช่ null', () => {
  const periods = buildDayPeriods('2026-10-01', 4);
  const g = buildGrid({
    parts: [{ id: 'p' }], periods, rows: PRESS,
    manual: mk({ 'p|balance|2026-10-01': 1000, 'p|out|2026-10-03': 300 }),
  });
  assert.deepEqual(periods.map((x) => valueAt(g, 'p', 'balance', x.key)), [1000, 1000, 700, 700]);
});

test('ค่าที่คนกรอกชนะค่าที่ระบบรู้เสมอ', () => {
  const periods = buildDayPeriods('2026-10-01', 2);
  const g = buildGrid({
    parts: [{ id: 'p' }], periods, rows: PRESS,
    manual: mk({ 'p|balance|2026-10-01': 0, 'p|in|2026-10-02': 999 }),
    system: () => 111,
  });
  assert.equal(valueAt(g, 'p', 'in', '2026-10-02'), 999);
  assert.equal(cellAt(g, 'p', 'in', '2026-10-02').src, 'input');
  /* ช่องที่คนไม่กรอก ระบบเติมได้ และต้องติดป้ายว่ามาจากระบบ */
  assert.equal(cellAt(g, 'p', 'out', '2026-10-02').src, 'system');
});

test('แถว recur คนแก้ไม่ได้ (นอกจากคอลัมน์ยอดยกมา)', () => {
  const periods = buildDayPeriods('2026-10-01', 3);
  const g = buildGrid({ parts: [{ id: 'p' }], periods, rows: PRESS, manual: mk({ 'p|balance|2026-10-01': 5 }) });
  assert.equal(cellAt(g, 'p', 'balance', '2026-10-01').editable, true);
  assert.equal(cellAt(g, 'p', 'balance', '2026-10-02').editable, false);
});

test('สูตรที่ไม่รู้จัก = null ทั้งแถว ไม่ตกเงียบเป็น 0', () => {
  assert.equal(recurDef('ไม่มีสูตรนี้'), null);
  const periods = buildDayPeriods('2026-10-01', 3);
  const rows = [{ key: 'x', kind: 'recur', recur: 'nope' }];
  const g = buildGrid({ parts: [{ id: 'p' }], periods, rows, manual: mk({ 'p|x|2026-10-01': 10 }) });
  assert.equal(valueAt(g, 'p', 'x', '2026-10-01'), 10);
  assert.equal(valueAt(g, 'p', 'x', '2026-10-02'), null);
});

/* ── Total SL: 2 ชีทคิดคนละแถว — ต้องรองรับทั้งคู่ ───────────────────────────────── */
test('Total SL — 800T นับแถว OUT · 110T นับแถว IN + ยอดยกมา (คนละสูตรจริง)', () => {
  const periods = buildDayPeriods('2026-09-30', 4);
  const manual = {
    'p|balance|2026-09-30': 200, 'p|out|2026-09-30': 700,
    'p|out|2026-10-01': 700, 'p|out|2026-10-02': 800,
    'p|in|2026-10-01': 1000, 'p|in|2026-10-02': 500,
  };
  const g = buildGrid({ parts: [{ id: 'p' }], periods, rows: PRESS, manual: mk(manual) });
  /* 800T: Σ OUT ข้ามคอลัมน์ยอดยกมา = 700+800 = 1500 (ไม่นับ 700 ของวัน seed) */
  const a = slSummary({ grid: g, partId: 'p', fc: 11800, slRow: 'out' });
  assert.equal(a.totalSl, 1500);
  assert.equal(a.diffFc, 1500 - 11800);
  assert.ok(Math.abs(a.pctSl - 1500 / 11800) < 1e-12);
  /* 110T: Σ IN + BALANCE[seed] = 1500 + 200 = 1700 */
  const b = slSummary({ grid: g, partId: 'p', fc: 11800, slRow: 'in', includeSeed: true });
  assert.equal(b.totalSl, 1700);
});

test('ไม่มี FC = ไม่คืน %SL (ห้ามหารศูนย์ ห้ามคืน 0)', () => {
  const periods = buildDayPeriods('2026-10-01', 2);
  const g = buildGrid({ parts: [{ id: 'p' }], periods, rows: PRESS, manual: mk({ 'p|out|2026-10-02': 50 }) });
  assert.equal(slSummary({ grid: g, partId: 'p', fc: null }).pctSl, null);
  assert.equal(slSummary({ grid: g, partId: 'p', fc: 0 }).pctSl, null);
  assert.equal(slSummary({ grid: g, partId: 'p', fc: '' }).diffFc, null);
});

test('ไม่มีแถว SL เลย = totalSl null ไม่ใช่ 0', () => {
  const periods = buildDayPeriods('2026-10-01', 3);
  const g = buildGrid({ parts: [{ id: 'p' }], periods, rows: PRESS, manual: mk({}) });
  assert.equal(slSummary({ grid: g, partId: 'p', fc: 100 }).totalSl, null);
});

/* ── MIN / ของขาด ──────────────────────────────────────────────────────────────── */
test('ไม่รู้ MIN = ไม่เตือน (ห้ามเดา min ให้ — หลักเดียวกับ line_part_levels)', () => {
  const periods = buildDayPeriods('2026-10-01', 2);
  const parts = [{ id: 'p', mat_no: 'M1' }];
  const g = buildGrid({ parts, periods, rows: PRESS, manual: mk({ 'p|balance|2026-10-01': 10 }) });
  assert.deepEqual(minBreaches({ grid: g, parts }), []);
});

test('BALANCE ต่ำกว่า MIN = แจ้ง พร้อมบอกขาดกี่ชิ้น', () => {
  const periods = buildDayPeriods('2026-10-01', 3);
  const parts = [{ id: 'p', mat_no: 'M1' }];
  const g = buildGrid({
    parts, periods, rows: PRESS,
    manual: mk({ 'p|balance|2026-10-01': 2000, 'p|min|2026-10-01': 1800, 'p|out|2026-10-02': 500 }),
  });
  const b = minBreaches({ grid: g, parts });
  assert.equal(b.length, 2);
  assert.equal(b[0].date, '2026-10-02');
  assert.equal(b[0].balance, 1500);
  assert.equal(b[0].short, 300);
});

test('firstShortDate = วันแรกที่สต๊อกติดลบ · ไม่ติดลบ = null', () => {
  const periods = buildDayPeriods('2026-09-30', 4);
  const g = buildGrid({
    parts: [{ id: 'p' }], periods, rows: PRESS,
    manual: mk({ 'p|balance|2026-09-30': 200, 'p|out|2026-10-01': 700 }),
  });
  assert.equal(firstShortDate({ grid: g, partId: 'p' }), '2026-10-01');
  const g2 = buildGrid({ parts: [{ id: 'q' }], periods, rows: PRESS, manual: mk({ 'q|balance|2026-09-30': 9000 }) });
  assert.equal(firstShortDate({ grid: g2, partId: 'q' }), null);
});

/* ── สรุปความซื่อสัตย์ ──────────────────────────────────────────────────────────── */
test('gridSummary บอกว่าพาร์ทไหนยังไม่ใส่ยอดยกมา', () => {
  const periods = buildDayPeriods('2026-10-01', 3);
  const parts = [{ id: 'a', mat_no: 'A' }, { id: 'b', mat_no: 'B' }];
  const g = buildGrid({
    parts, periods, rows: PRESS,
    manual: mk({ 'a|balance|2026-10-01': 100, 'a|unbound|2026-10-01': 0 }),
  });
  const s = gridSummary({ grid: g, parts, rows: PRESS });
  assert.equal(s.seedMissingCount, 1);
  assert.equal(s.seedMissing[0].mat_no, 'B');
  assert.deepEqual(s.seedMissing[0].rows.sort(), ['balance', 'unbound']);
  assert.equal(s.partial, true);
  assert.equal(s.periods, 3);
});

test('ใส่ยอดยกมาครบ = ไม่ partial', () => {
  const periods = buildDayPeriods('2026-10-01', 2);
  const parts = [{ id: 'a', mat_no: 'A' }];
  const g = buildGrid({
    parts, periods, rows: PRESS,
    manual: mk({ 'a|balance|2026-10-01': 1, 'a|unbound|2026-10-01': 2 }),
  });
  assert.equal(gridSummary({ grid: g, parts, rows: PRESS }).partial, false);
});

/* ── ช่วงเวลา ──────────────────────────────────────────────────────────────────── */
test('คอลัมน์รายวันนับทุกวันปฏิทิน (เสาร์-อาทิตย์ก็มี เหมือนไฟล์จริง)', () => {
  const p = buildDayPeriods('2026-10-02', 4);
  assert.deepEqual(p.map((x) => x.date), ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
});
test('คอลัมน์รายสัปดาห์ห่างกัน 7 วัน', () => {
  assert.deepEqual(buildWeekPeriods('2026-10-05', 3).map((x) => x.date), ['2026-10-05', '2026-10-12', '2026-10-19']);
});
test('คอลัมน์ตามวันที่ที่ระบุ — เรียงเอง ตัดค่าว่าง ตัดเวลา', () => {
  const p = buildDatePeriods(['2026-10-09', '', null, '2026-10-01T00:00:00', '2026-10-05']);
  assert.deepEqual(p.map((x) => x.date), ['2026-10-01', '2026-10-05', '2026-10-09']);
});
test('ไม่มีคอลัมน์ = กริดว่าง ไม่ throw', () => {
  assert.deepEqual(buildDayPeriods('2026-10-01', 0), []);
  const g = buildGrid({ parts: [{ id: 'p' }], periods: [], rows: PRESS, manual: mk({}) });
  assert.equal(g.seedKey, null);
  assert.equal(g.cells.size, 0);
});

/* ── สูตรอื่นในไฟล์ (TSPK/Argen/RA) ─────────────────────────────────────────────── */
test('deplete — TSPK: FG ตั้งต้นแล้วหักออเดอร์สะสม', () => {
  const periods = buildDatePeriods(['2026-10-01', '2026-10-02', '2026-10-03']);
  const rows = [
    { key: 'order',   kind: 'input' },
    { key: 'balance', kind: 'recur', recur: 'deplete' },
  ];
  const g = buildGrid({
    parts: [{ id: 'p' }], periods, rows,
    manual: mk({ 'p|balance|2026-10-01': 100, 'p|order|2026-10-02': 700, 'p|order|2026-10-03': 800 }),
  });
  assert.deepEqual(periods.map((x) => valueAt(g, 'p', 'balance', x.key)), [100, -600, -1400]);
});

test('stock_send — Argen: รับเข้า W/H แล้วส่งเกรท', () => {
  const periods = buildWeekPeriods('2026-10-05', 3);
  const rows = [
    { key: 'in',      kind: 'input' },
    { key: 'send',    kind: 'input' },
    { key: 'balance', kind: 'recur', recur: 'stock_send' },
  ];
  const g = buildGrid({
    parts: [{ id: 'p' }], periods, rows,
    manual: mk({
      'p|balance|2026-10-05': 2253,
      'p|in|2026-10-12': 2400, 'p|send|2026-10-12': 800,
      'p|send|2026-10-19': 1200,
    }),
  });
  assert.deepEqual(periods.map((x) => valueAt(g, 'p', 'balance', x.key)), [2253, 3853, 2653]);
});

test('vendor_wip — RA/824-825: ของค้างที่ร้านชุบ', () => {
  const periods = buildDayPeriods('2026-10-01', 3);
  const rows = [
    { key: 'to_vendor',   kind: 'input' },
    { key: 'from_vendor', kind: 'input' },
    { key: 'at_vendor',   kind: 'recur', recur: 'vendor_wip' },
  ];
  const g = buildGrid({
    parts: [{ id: 'p' }], periods, rows,
    manual: mk({
      'p|at_vendor|2026-10-01': 849,
      'p|to_vendor|2026-10-02': 398, 'p|from_vendor|2026-10-02': 150,
      'p|from_vendor|2026-10-03': 200,
    }),
  });
  assert.deepEqual(periods.map((x) => valueAt(g, 'p', 'at_vendor', x.key)), [849, 1097, 897]);
});

test('ทุกสูตรใน RECUR ประกาศ label + needs + calc ครบ', () => {
  for (const [k, d] of Object.entries(RECUR)) {
    assert.equal(typeof d.label, 'string', `${k} ต้องมี label`);
    assert.ok(Array.isArray(d.needs), `${k} ต้องมี needs`);
    assert.equal(typeof d.calc, 'function', `${k} ต้องมี calc`);
    assert.equal(d.calc(null, {}), null, `${k}: ไม่รู้ค่าก่อนหน้า ต้องคืน null ไม่ใช่ 0`);
  }
});

/* ── mat (R402) วัตถุดิบม้วน ⇄ ชิ้น ──────────────────────────────────────────────── */
test('rawPieces — คงเหลือ(กก.) ÷ อัตรา = จำนวนชิ้น (ตรงไฟล์ mat r3)', () => {
  /* Excel r3: H3=699 กก. · G3=0.148 กก./ชิ้น → I3 = 4722.97 ชิ้น */
  const v = rawPieces({ onHandKg: 699, kgPerPiece: 0.148 });
  assert.ok(Math.abs(v - 4722.972972972973) < 1e-9);
});
test('rawPieces — งานคู่ (ปั๊มทีเดียวได้ 2 ชิ้น) คูณจำนวนชิ้นต่อจังหวะ (ตรงไฟล์ mat r4)', () => {
  /* Excel r4: =H4/G4*2 → 1135 / 0.341 * 2 = 6656.89 */
  const v = rawPieces({ onHandKg: 1135, kgPerPiece: 0.341, pieces: 2 });
  assert.ok(Math.abs(v - 6656.891495601172) < 1e-9);
});
test('rawKgNeeded — งานท้ายไลน์(ชิ้น) × อัตรา ÷ ชิ้นต่อจังหวะ', () => {
  assert.ok(Math.abs(rawKgNeeded({ queuePieces: 2446, kgPerPiece: 0.148 }) - 362.008) < 1e-9);
  assert.ok(Math.abs(rawKgNeeded({ queuePieces: 100, kgPerPiece: 0.341, pieces: 2 }) - 17.05) < 1e-9);
});
test('อัตราไม่รู้/เป็น 0 = null ห้ามหาร ห้ามตอบ "พอ"', () => {
  assert.equal(rawPieces({ onHandKg: 100, kgPerPiece: 0 }), null);
  assert.equal(rawPieces({ onHandKg: 100, kgPerPiece: null }), null);
  assert.equal(rawPieces({ onHandKg: null, kgPerPiece: 1 }), null);
  const c = rawCoverage({ onHandKg: null, queuePieces: 10, kgPerPiece: 1 });
  assert.equal(c.enough, null);
  assert.equal(c.diff, null);
});
test('rawCoverage — เหล็กพอ/ไม่พอทำงานท้ายไลน์', () => {
  const ok = rawCoverage({ onHandKg: 699, queuePieces: 2446, kgPerPiece: 0.148 });
  assert.equal(ok.enough, true);
  assert.ok(Math.abs(ok.diff - (699 - 362.008)) < 1e-9);
  assert.equal(rawCoverage({ onHandKg: 10, queuePieces: 2446, kgPerPiece: 0.148 }).enough, false);
});

/* ── TSPK: จำนวนแร็ค ─────────────────────────────────────────────────────────────── */
test('rackCount — ของ ÷ packing std (ตรงไฟล์ TSPK G3 = L3/F3)', () => {
  assert.equal(rackCount({ qty: 100, packStd: 100 }), 1);
  assert.equal(rackCount({ qty: 1260, packStd: 140 }), 9);
  assert.equal(rackCount({ qty: 100, packStd: 0 }), null);
  assert.equal(rackCount({ qty: null, packStd: 100 }), null);
});
