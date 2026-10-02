import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_TABS, BOARD_KINDS, ROW_PRESETS, BOARD_DEFAULTS, ROW_LABEL,
  rowDefs, balanceRowKey, minRowKey, boardPeriods, boardKeyOfSheet, SHEET_LINE_HINT,
} from '../monitorBoards.js';

test('ทุกชนิดบอร์ดมีชุดแถวตั้งต้น + ค่าตั้งต้นครบ', () => {
  for (const k of BOARD_KINDS) {
    assert.ok(ROW_PRESETS[k] || (k === 'line' && ROW_PRESETS.line_wip), `ขาด preset ของ ${k}`);
    assert.ok(BOARD_DEFAULTS[k], `ขาด defaults ของ ${k}`);
  }
  assert.equal(BOARD_TABS.length, BOARD_KINDS.length);
});

test('ทุกแถวใน preset มีป้ายไทย (จอ TV ต้องอ่านออก ไม่ใช่คีย์ดิบ)', () => {
  for (const rows of Object.values(ROW_PRESETS)) {
    for (const r of rows) assert.ok(ROW_LABEL[r.key], `ขาดป้ายของแถว ${r.key}`);
  }
});

test('rowDefs — อ่านชุดแถวจาก DB ก่อน ไม่ใช้ preset ถ้า DB มีค่า', () => {
  const d = rowDefs({ kind: 'line', rows: [{ key: 'plan', kind: 'input' }] });
  assert.equal(d.length, 1);
  assert.equal(d[0].key, 'plan');
});

test('rowDefs — DB ว่าง = ตกมาใช้ preset ของชนิดนั้น (จอต้องไม่ว่าง)', () => {
  assert.equal(rowDefs({ kind: 'line', rows: [] }).length, ROW_PRESETS.line.length);
  assert.equal(rowDefs({ kind: 'rack' }).length, ROW_PRESETS.rack.length);
});

test('rowDefs — kind ที่ไม่รู้จักตกเป็น input ห้ามทิ้งแถว (ตะกร้ารับท้ายลิสต์)', () => {
  const d = rowDefs({ kind: 'line', rows: [{ key: 'ของใหม่', kind: 'อะไรไม่รู้' }] });
  assert.equal(d.length, 1, 'แถวต้องไม่หายจากจอ');
  assert.equal(d[0].kind, 'input');
  assert.equal(d[0].label, 'ของใหม่', 'ไม่มีป้ายไทย = ใช้คีย์เป็นป้าย ห้ามว่าง');
});

test('rowDefs — แถวที่เป็นสตริงเปล่าๆ ก็รับได้', () => {
  const d = rowDefs({ kind: 'line', rows: ['plan', 'in'] });
  assert.deepEqual(d.map((r) => r.key), ['plan', 'in']);
  assert.equal(d[0].label, ROW_LABEL.plan);
});

test('rowDefs — สูตร recur ที่โค้ดไม่รู้จัก ยังเป็น recur + ติดธง unknownRecur (ห้ามแปลงเป็น input เงียบ)', () => {
  const d = rowDefs({ kind: 'line', rows: [{ key: 'x', kind: 'recur', recur: 'ยังไม่มีสูตรนี้' }] });
  assert.equal(d[0].kind, 'recur');
  assert.equal(d[0].unknownRecur, true);
  const ok = rowDefs({ kind: 'line', rows: [{ key: 'balance', kind: 'recur', recur: 'stock_run' }] });
  assert.equal(ok[0].unknownRecur, false);
});

test('rowDefs — แถวที่ไม่มี key ถูกตัด (กันแถวผี)', () => {
  assert.equal(rowDefs({ kind: 'line', rows: [{ label: 'ไม่มีคีย์' }, { key: 'plan' }] }).length, 1);
});

test('balanceRowKey / minRowKey — ไม่มีแถวนั้น = null (ไม่ตีสีของขาด ไม่เดา)', () => {
  assert.equal(balanceRowKey({ kind: 'line' }), 'balance');
  assert.equal(balanceRowKey({ kind: 'vendor' }), 'at_vendor');
  assert.equal(balanceRowKey({ kind: 'raw' }), null);
  assert.equal(minRowKey({ kind: 'line' }), 'min');
  assert.equal(minRowKey({ kind: 'raw' }), null);
});

/* ── คอลัมน์ ────────────────────────────────────────────────────────────────────── */
const NOW = new Date('2026-10-01T10:00:00');

test('boardPeriods — รายวันเริ่มที่ start_date', () => {
  const p = boardPeriods({ period_kind: 'day', period_count: 3, start_date: '2026-09-30' }, { now: NOW });
  assert.deepEqual(p.map((x) => x.date), ['2026-09-30', '2026-10-01', '2026-10-02']);
});

test('boardPeriods — ไม่ตั้ง start_date = ใช้วันทำงานปัจจุบัน (ก่อน 08:00 = วันก่อนหน้า)', () => {
  const a = boardPeriods({ period_kind: 'day', period_count: 1 }, { now: new Date('2026-10-01T10:00:00') });
  assert.equal(a[0].date, '2026-10-01');
  const b = boardPeriods({ period_kind: 'day', period_count: 1 }, { now: new Date('2026-10-01T03:00:00') });
  assert.equal(b[0].date, '2026-09-30', 'ตี 3 ยังเป็นกะดึกของวันก่อนหน้า');
});

test('boardPeriods — รายสัปดาห์ห่าง 7 วัน', () => {
  const p = boardPeriods({ period_kind: 'week', period_count: 3, start_date: '2026-10-05' }, { now: NOW });
  assert.deepEqual(p.map((x) => x.date), ['2026-10-05', '2026-10-12', '2026-10-19']);
});

test('boardPeriods — ตามวันที่สั่ง: เติมคอลัมน์ยอดยกมา (วันก่อนวันแรก) ให้สูตร deplete เริ่มได้', () => {
  const p = boardPeriods({ period_kind: 'date' }, { dates: ['2026-10-05', '2026-10-01', '2026-10-01'] });
  assert.deepEqual(p.map((x) => x.date), ['2026-09-30', '2026-10-01', '2026-10-05'],
    'ซ้ำถูกยุบ · เรียงเอง · มีคอลัมน์ยอดยกมานำหน้า');
});

test('boardPeriods — ไม่มีข้อมูลพอ = ไม่มีคอลัมน์ (ไม่ throw ไม่เดา)', () => {
  assert.deepEqual(boardPeriods({ period_kind: 'date' }, { dates: [] }), []);
  assert.deepEqual(boardPeriods({ period_kind: 'day', period_count: 0 }, { now: NOW }), []);
  assert.deepEqual(boardPeriods(null, { now: NOW }), []);
});

/* ── คีย์บอร์ด ──────────────────────────────────────────────────────────────────── */
test('boardKeyOfSheet — ชื่อชีทเดิมให้คีย์เดิมเสมอ (import ซ้ำลงบอร์ดเดิม ไม่สร้างซ้ำ)', () => {
  assert.equal(boardKeyOfSheet('line', '800T'), 'line-800t');
  assert.equal(boardKeyOfSheet('line', '800T'), boardKeyOfSheet('line', '800T'));
  assert.equal(boardKeyOfSheet('rack', 'TSESA+LA '), 'rack-tsesa-la');
  assert.equal(boardKeyOfSheet('vendor', '824-825'), 'vendor-824-825');
  assert.equal(boardKeyOfSheet('raw', 'mat'), 'raw-mat');
});

test('SHEET_LINE_HINT — 110T กับ 300T ชี้ไลน์เดียวกันอย่างตั้งใจ', () => {
  assert.equal(SHEET_LINE_HINT['110T'], SHEET_LINE_HINT['300T']);
  assert.equal(SHEET_LINE_HINT['800T'], 'LINE A ( 800 Ton )');
  assert.equal(Object.keys(SHEET_LINE_HINT).length, 5);
});
