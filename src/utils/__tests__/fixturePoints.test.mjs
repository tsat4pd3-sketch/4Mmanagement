import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shimStack, shotsFromPieces, pointDueStatus, toolLifeStatus,
  learnedToolLife, suggestMaxShim, suggestFixtureCandidates,
} from '../fixturePoints.js';

const DAY = 86400000;
const NOW = new Date('2026-09-01T08:00:00+07:00').getTime();
const ago = (d) => new Date(NOW - d * DAY).toISOString();

// ── shimStack — "ไม่รู้" ≠ 0 และไม่ตั้งเกณฑ์ = ไม่เตือน ─────────────────────
test('shimStack: ยังไม่เคยบันทึกชิม = unknown ไม่ใช่ 0', () => {
  const s = shimStack({ baseline_shim_mm: 0.5, max_shim_mm: 2 });
  assert.equal(s.current, null);
  assert.equal(s.level, 'unknown');
});

test('shimStack: ไม่ตั้ง max = no_limit ห้ามเตือน (0 คนละความหมายกับ null)', () => {
  assert.equal(shimStack({ current_shim_mm: 5, max_shim_mm: null }).level, 'no_limit');
  // max = 0 ก็ยังไม่เตือน (ถือว่ายังไม่ได้ตั้งเกณฑ์จริง)
  assert.equal(shimStack({ current_shim_mm: 5, max_shim_mm: 0 }).level, 'no_limit');
});

test('shimStack: added = ห่างจาก baseline · เกินเพดาน = over', () => {
  const s = shimStack({ current_shim_mm: 0.9, baseline_shim_mm: 0.5, max_shim_mm: 0.8 });
  assert.equal(s.added, 0.4);
  assert.equal(s.level, 'over');
  assert.equal(shimStack({ current_shim_mm: 0.7, baseline_shim_mm: 0.5, max_shim_mm: 0.8 }).level, 'warn');
  assert.equal(shimStack({ current_shim_mm: 0.5, baseline_shim_mm: 0.5, max_shim_mm: 1.0 }).level, 'ok');
});

// ── shot ───────────────────────────────────────────────────────────────────
test('shotsFromPieces: ไม่ตั้ง pieces_per_cycle = เดา 1 แต่ต้องบอกว่าเดา', () => {
  assert.deepEqual(shotsFromPieces(100, null), { shots: 100, assumed: true });
  assert.deepEqual(shotsFromPieces(100, 2),    { shots: 50,  assumed: false });
  assert.deepEqual(shotsFromPieces(null, 2),   { shots: null, assumed: false });
});

// ── ครบกำหนด 2 แกน ─────────────────────────────────────────────────────────
test('pointDueStatus: ไม่ตั้ง interval เลย = unset (ตามใบเหมือนเดิม) ห้ามบอกว่าเลยกำหนด', () => {
  const r = pointDueStatus({}, { nowMs: NOW });
  assert.equal(r.level, 'unset');
  assert.equal(r.due, false);
});

test('pointDueStatus: ตั้งแกนเวลา แต่ไม่เคยตรวจ = ถึงกำหนดแล้ว', () => {
  const r = pointDueStatus({ interval_days: 7 }, { nowMs: NOW });
  assert.equal(r.due, true);
});

test('pointDueStatus: แกนที่ถึงก่อนชนะ และต้องบอก driver', () => {
  // เวลาเหลือ 5 วัน · shot เหลือ 200 ที่อัตรา 100/วัน = 2 วัน → cycles ชนะ
  const r = pointDueStatus(
    { interval_days: 10, interval_cycles: 1000, last_check_at: ago(5), last_check_shot: 8800 },
    { nowMs: NOW, currentShot: 9600, shotPerDay: 100 },
  );
  assert.equal(r.driver, 'cycles');
  assert.equal(r.due, false);
  assert.equal(r.level, 'soon');
});

test('pointDueStatus: ตั้งแกน cycle แต่นับ shot ไม่ได้ = unknown_usage ตกไปใช้แกนเวลา', () => {
  const r = pointDueStatus(
    { interval_days: 30, interval_cycles: 5000, last_check_at: ago(1) },
    { nowMs: NOW, currentShot: null },
  );
  assert.equal(r.level, 'unknown_usage');
  assert.equal(r.due, false);
  assert.match(r.text, /นับ shot ไม่ได้/);
});

test('pointDueStatus: เลย shot แล้วแม้ยังไม่รู้อัตรา = ถึงกำหนด', () => {
  const r = pointDueStatus(
    { interval_days: 30, interval_cycles: 1000, last_check_at: ago(1), last_check_shot: 5000 },
    { nowMs: NOW, currentShot: 6500 },   // ไม่ส่ง shotPerDay
  );
  assert.equal(r.due, true);
  assert.equal(r.driver, 'cycles');
});

// ── tool life ──────────────────────────────────────────────────────────────
test('toolLifeStatus: ไม่ตั้ง life หรือนับ shot ไม่ได้ = unknown ห้ามคืน 0', () => {
  assert.equal(toolLifeStatus({ expected_life_cycles: null }, 9000).level, 'unknown');
  assert.equal(toolLifeStatus({ expected_life_cycles: 30000 }, null).level, 'unknown');
  assert.equal(toolLifeStatus({ expected_life_cycles: 30000 }, null).pct, null);
});

test('toolLifeStatus: นับต่อจากครั้งที่เปลี่ยนล่าสุด', () => {
  const r = toolLifeStatus({ expected_life_cycles: 10000, last_replaced_shot: 40000 }, 49000);
  assert.equal(r.used, 9000);
  assert.equal(r.level, 'warn');
  assert.equal(toolLifeStatus({ expected_life_cycles: 10000, last_replaced_shot: 40000 }, 51000).level, 'over');
});

test('learnedToolLife: ตัวอย่างน้อยกว่าเกณฑ์ = ไม่เสนอ (null ไม่ใช่เดา)', () => {
  const ev = [
    { action: 'part_replaced', shot_at_event: 10000 },
    { action: 'part_replaced', shot_at_event: 40000 },
  ];
  assert.equal(learnedToolLife(ev).suggested, null);
});

test('learnedToolLife: ใช้ median ของช่วง และไม่นับ event ชนิดอื่น', () => {
  const ev = [
    { action: 'part_replaced', shot_at_event: 0 },
    { action: 'add',           shot_at_event: 5000 },   // ต้องไม่ถูกนับ
    { action: 'part_replaced', shot_at_event: 30000 },
    { action: 'part_replaced', shot_at_event: 70000 },
    { action: 'part_replaced', shot_at_event: 105000 },
  ];
  const r = learnedToolLife(ev);
  assert.deepEqual(r.spans, [30000, 40000, 35000]);
  assert.equal(r.suggested, 35000);
});

test('suggestMaxShim: ข้อมูลน้อย = ไม่เสนอ', () => {
  assert.equal(suggestMaxShim([{ shim_after_mm: 0.5 }]).suggested, null);
  const ev = [0.4, 0.5, 0.6, 0.5, 0.8].map(v => ({ shim_after_mm: v }));
  assert.equal(suggestMaxShim(ev).suggested, 1.2);
});

// ── เสนอ fixture (เฟส 0) ───────────────────────────────────────────────────
test('suggestFixtureCandidates: เสนอเฉพาะที่ยังเป็น machine + เรียงตามคะแนน', () => {
  const rows = [
    { machine_no: 'JHYD06-10', machine_name: 'JIG SLIDE',  equipment_kind: 'machine', line_name: 'Line 61' },
    { machine_no: 'HDF-01',    machine_name: 'HYDROFORM',  equipment_kind: 'machine', line_name: 'HDF1' },
    { machine_no: 'JHYD07-01', machine_name: 'JIG LASER',  equipment_kind: 'jig',     line_name: 'LASER-345' },
    { machine_no: 'RB-128',    machine_name: 'Welding',    equipment_kind: 'machine', line_name: 'HDF1' },
  ];
  const out = suggestFixtureCandidates(rows, new Set(['JHYD06-10']));
  assert.equal(out.length, 1, 'HDF-01 กับ Welding เปล่าๆ ต้องไม่ถูกเสนอ · ตัวที่เป็น jig แล้วต้องไม่โผล่ซ้ำ');
  assert.equal(out[0].machine_no, 'JHYD06-10');
  assert.ok(out[0]._reasons.includes('วางอยู่บนผังไลน์แล้ว'));
});

test('suggestFixtureCandidates: ไม่เดาจากคำกำกวมอย่างเดียว', () => {
  const rows = [{ machine_no: 'SP-88', machine_name: 'Welding', equipment_kind: 'machine' }];
  assert.equal(suggestFixtureCandidates(rows, new Set()).length, 0);
});

// ── จับคู่ fixture ↔ พาร์ท (ข้อมูลจริงมี 3 ความต่าง: ขีด/ช่องว่าง · rev · RH-LH ช่องเดียว) ──
import { resolveFixtureParts } from '../fixturePoints.js';

const PRODUCTS = [
  { mat_no: '10100384', p_no: 'MB3B 16C274 CD', part_name: 'REINF RH (FTM)' },
  { mat_no: '10100385', p_no: 'MB3B 16C274 CD', part_name: 'REINF RH (AAT)' },
  { mat_no: '10100390', p_no: 'MB3B 16C275 CD', part_name: 'REINF LH' },
  { mat_no: '20058626', p_no: null,             part_name: 'CHILD' },
];

test('resolveFixtureParts: แตก RH/LH ที่คั่นด้วย / และเทียบ base เมื่อ rev ต่าง', () => {
  const r = resolveFixtureParts('MB3B-16C274-C/MB3B-16C275-C', PRODUCTS, {});
  assert.equal(r.status, 'ok');
  assert.equal(r.tokens.length, 2);
  assert.equal(r.tokens[0].via, 'base', 'rev ต่าง (-C vs CD) ต้องจับได้ด้วย base');
  // FG เดียวกันแตกหลาย MAT ตามลูกค้า → ต้องรวมทุกตัว (จิ๊กจับเหมือนกันทุกชิ้น)
  assert.deepEqual([...r.mats].sort(), ['10100384', '10100385', '10100390']);
});

test('resolveFixtureParts: ตรงตัวชนะ base', () => {
  const r = resolveFixtureParts('20058626', PRODUCTS, {});
  assert.equal(r.tokens[0].via, 'exact');
  assert.deepEqual(r.mats, ['20058626']);
});

test('resolveFixtureParts: จับคู่ไม่ได้ = none (ไม่เดา) · ว่าง = empty', () => {
  assert.equal(resolveFixtureParts('N1WB-17B861-A-PIA-01', PRODUCTS, {}).status, 'none');
  assert.equal(resolveFixtureParts('', PRODUCTS, {}).status, 'empty');
  assert.equal(resolveFixtureParts(null, PRODUCTS, {}).mats.length, 0);
});

test('resolveFixtureParts: จับได้บางตัว = partial (ต้องบอกผู้ใช้ ไม่ใช่เงียบ)', () => {
  const r = resolveFixtureParts('MB3B-16C274-C/ZZZZ-9999', PRODUCTS, {});
  assert.equal(r.status, 'partial');
  assert.equal(r.tokens[1].mats.length, 0);
});
