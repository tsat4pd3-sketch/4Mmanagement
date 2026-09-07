/**
 * เทส src/utils/qaFmeForecast.js — คาดการณ์ "อีกกี่โมงต้องไปตรวจชิ้นสุดท้าย" (บอร์ดไทม์ไลน์ QA)
 *
 * ที่มา (2026-09-07): เอกสารอ้างว่าไฟล์นี้ "เทส 31 เคส" แต่ไม่เคยมีไฟล์เทสอยู่ในรีโปเลย
 * → เขียนของจริงให้ตรงกับกฎใน header ของ qaFmeForecast.js
 *
 * กติกาที่ห้าม regress:
 *   1. addWorkMinutes เดินเฉพาะเวลาทำงาน — ถึงเบรคต้องกระโดดข้าม · เริ่มในเบรคต้องเริ่มนับที่ท้ายเบรค
 *   2. ไม่มี CT = ไม่เดาเวลา → forecastEnd คืน { noCt: true } ห้ามคืน 0 / ห้ามคืน eta
 *   3. modelRuns ยุบ 2 ชั้นตามลำดับ OP → คู่ RH/LH (ลำดับเดียวกับ canon() ใน edge qa-fme-scan)
 *      ตัวแทนคู่ = mat ที่เรียงน้อยกว่า · เป้า/ผลิตของคู่ = max ไม่ใช่บวก (1 stroke = 1 คู่)
 *   4. ไฟล์นี้คาดการณ์เฉพาะ End — ไม่มี API สำหรับ Middle โดยตั้งใจ (กติกา Middle อยู่ใน edge แล้ว)
 *   · "วันงานกลิ้งตามเวลาจริง" เป็นพฤติกรรมของ QaFmeBoard (polling) ไม่ใช่ของ util นี้ — ไม่อยู่ในเทสนี้
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* qaFmeForecast.js import './pairTotals' แบบไม่มีนามสกุล (Vite resolve ให้ แต่ node ESM ไม่)
   → bundle ด้วย rolldown ก่อนเทส (pattern เดียวกับ permissions.test.mjs) — โค้ดที่เทสคือของจริงในรีโป */
let mod, addWorkMinutes, modelRuns, forecastEnd;
before(async () => {
  const { rolldown } = await import('rolldown');
  const bundle = await rolldown({ input: 'src/utils/qaFmeForecast.js' });
  const out = join(tmpdir(), `qaFmeForecast-under-test-${process.pid}.mjs`);
  await bundle.write({ format: 'esm', file: out });
  mod = await import(pathToFileURL(out).href);
  ({ addWorkMinutes, modelRuns, forecastEnd } = mod);
});

/* ── 1) addWorkMinutes ───────────────────────────────────────────────────── */
const LUNCH = { s: 720, e: 780 };          // 12:00–13:00
const TEA   = { s: 900, e: 915 };          // 15:00–15:15

test('addWorkMinutes: ไม่มีเบรค = บวกตรง · 0 หรือติดลบ = ไม่ขยับ', () => {
  assert.equal(addWorkMinutes(480, 60), 540);
  assert.equal(addWorkMinutes(480, 0, [LUNCH]), 480);
  assert.equal(addWorkMinutes(480, -30, [LUNCH]), 480);
});

test('addWorkMinutes: งานข้ามเบรค → ใช้เวลาก่อนเบรคก่อน แล้วกระโดดไปท้ายเบรค', () => {
  // 11:40 ทำ 40 นาที: 20 นาทีก่อนเที่ยง → ข้ามพัก → อีก 20 นาที = 13:20
  assert.equal(addWorkMinutes(700, 40, [LUNCH]), 800);
});

test('addWorkMinutes: เริ่มระหว่างเบรค = เริ่มนับที่ท้ายเบรค', () => {
  assert.equal(addWorkMinutes(730, 10, [LUNCH]), 790);
  assert.equal(addWorkMinutes(720, 10, [LUNCH]), 790);   // เริ่มตรงหัวเบรคพอดี
});

test('addWorkMinutes: จบพอดีหัวเบรค = ไม่กระโดด (เวลางานหมดก่อนถึงเบรค)', () => {
  assert.equal(addWorkMinutes(700, 20, [LUNCH]), 720);
});

test('addWorkMinutes: เบรคที่ผ่านไปแล้วไม่มีผล · หลายเบรคเรียงไม่เป็นระเบียบก็ข้ามครบ', () => {
  assert.equal(addWorkMinutes(800, 30, [LUNCH]), 830);
  // 11:50 ทำ 200 นาที: 10 ก่อนเที่ยง → ข้าม 60 → 120 ถึง 15:00 → ข้าม 15 → อีก 70 = 985 (16:25)
  assert.equal(addWorkMinutes(710, 200, [TEA, LUNCH]), 985);
});

/* ── 2) modelRuns ────────────────────────────────────────────────────────── */
const toMin = (iso) => (iso ? Number(iso) : null);   // เทสส่ง opened_at เป็นเลขนาทีตรงๆ

test('modelRuns: รวมใบงานของรุ่นเดียวกันในไลน์+กะเดียวกัน · เป้าใช้ qty_target ก่อน qty · startMin = ใบที่เปิดก่อน', () => {
  const runs = modelRuns({
    orders: [
      { line_name: 'L61', shift: 'day', mat_no: 'A', qty_target: 100, qty: 999, qty_actual: 30, opened_at: '500' },
      { line_name: 'L61', shift: 'day', mat_no: 'A', qty: 50, qty_actual: 10, opened_at: '490' },
      { line_name: 'L61', shift: 'night', mat_no: 'A', qty: 10, qty_actual: 0, opened_at: '1300' },
      { line_name: null, mat_no: 'A', qty: 10 },            // ไม่มีไลน์ = ทิ้ง
      { line_name: 'L61', shift: 'day', mat_no: null, qty: 10 }, // ไม่มี mat = ทิ้ง
    ], toMin,
  });
  assert.equal(runs.length, 2);
  const day = runs.find(r => r.shift === 'day');
  assert.deepEqual({ ...day }, { lineName: 'L61', shift: 'day', matNo: 'A', mats: ['A'], target: 150, produced: 40, remaining: 110, startMin: 490 });
  assert.equal(runs.find(r => r.shift === 'night').remaining, 10);
});

test('modelRuns: remaining ไม่ติดลบเมื่อผลิตเกินเป้า · ไม่มี opened_at = startMin null', () => {
  const [r] = modelRuns({ orders: [{ line_name: 'L', shift: 'day', mat_no: 'A', qty: 10, qty_actual: 15 }], toMin });
  assert.equal(r.remaining, 0);
  assert.equal(r.startMin, null);
});

test('modelRuns: คู่ RH/LH ยุบเป็นรุ่นเดียว — ตัวแทน = mat เรียงน้อยกว่า · เป้า/ผลิต = max ไม่ใช่บวก', () => {
  const pairOf = (m) => ({ R1: 'L1', L1: 'R1' })[m] || null;
  const runs = modelRuns({
    orders: [
      { line_name: 'L', shift: 'day', mat_no: 'R1', qty: 100, qty_actual: 40, opened_at: '500' },
      { line_name: 'L', shift: 'day', mat_no: 'L1', qty: 100, qty_actual: 35, opened_at: '480' },
    ], pairOf, toMin,
  });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].matNo, 'L1');
  assert.deepEqual([...runs[0].mats].sort(), ['L1', 'R1']);
  assert.equal(runs[0].target, 100);
  assert.equal(runs[0].produced, 40);
  assert.equal(runs[0].startMin, 480);
});

test('modelRuns: คู่ที่อีกข้างไม่ได้วิ่ง = นับเดี่ยวตามปกติ', () => {
  const runs = modelRuns({
    orders: [{ line_name: 'L', shift: 'day', mat_no: 'R1', qty: 100, qty_actual: 40 }],
    pairOf: (m) => (m === 'R1' ? 'L1' : null), toMin,
  });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].target, 100);
});

test('modelRuns: ชั้น OP — ใบของขั้นตอนยุบเข้าพาร์ทจริง (พาร์ทจริงถือยอด) · mats รวม OP · startMin เอาที่เร็วสุดข้าม OP', () => {
  const opMap = { 'P-M6': { parent: 'P' }, 'P-M8': { parent: 'P' } };
  const runs = modelRuns({
    orders: [
      { line_name: 'L', shift: 'day', mat_no: 'P', qty: 100, qty_actual: 20, opened_at: '600' },
      { line_name: 'L', shift: 'day', mat_no: 'P-M6', qty: 100, qty_actual: 60, opened_at: '480' },
      { line_name: 'L', shift: 'day', mat_no: 'P-M8', qty: 100, qty_actual: 40, opened_at: '520' },
    ], opMap, toMin,
  });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].matNo, 'P');
  assert.deepEqual([...runs[0].mats].sort(), ['P', 'P-M6', 'P-M8']);
  assert.equal(runs[0].target, 100);      // ไม่บวกซ้ำ 3 ขั้น
  assert.equal(runs[0].produced, 20);     // พาร์ทจริงถือยอด
  assert.equal(runs[0].startMin, 480);    // ขั้นแรกเปิดก่อน
});

test('modelRuns: OP ที่พาร์ทจริงไม่ได้วิ่ง = ยุบพี่น้องเหลือแถวเดียวใช้ max · opMap ว่าง = ไม่ยุบ', () => {
  const opMap = { 'P-M6': { parent: 'P' }, 'P-M8': { parent: 'P' } };
  const orders = [
    { line_name: 'L', shift: 'day', mat_no: 'P-M6', qty: 100, qty_actual: 60 },
    { line_name: 'L', shift: 'day', mat_no: 'P-M8', qty: 100, qty_actual: 40 },
  ];
  const collapsed = modelRuns({ orders, opMap, toMin });
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].matNo, 'P');
  assert.equal(collapsed[0].produced, 60);
  const plain = modelRuns({ orders, opMap: {}, toMin });
  assert.equal(plain.length, 2);
});

/* ── 3) forecastEnd ──────────────────────────────────────────────────────── */
const RUN = { lineName: 'L', shift: 'day', matNo: 'A', mats: ['A'], target: 100, produced: 40, remaining: 60, startMin: 480 };

test('forecastEnd: ไม่มี CT = { noCt: true } — ห้ามเดาเป็น 0 หรือคืน eta', () => {
  for (const ctOf of [() => 0, () => null, () => undefined, () => 'abc', () => -5]) {
    const r = forecastEnd(RUN, { ctOf, nowMin: 600 });
    assert.deepEqual(r, { noCt: true });
    assert.equal(r.etaMin, undefined);
  }
});

test('forecastEnd: eta = เวลานี้ + remaining×CT (นาที) เดินข้ามเบรค · คืน ct ที่ใช้จริง', () => {
  // 60 ชิ้น × 60 วิ = 60 นาที จาก 11:40 → ข้ามพักเที่ยง = 13:40 (820)
  const r = forecastEnd(RUN, { ctOf: () => 60, nowMin: 700, breaks: [LUNCH] });
  assert.deepEqual(r, { etaMin: 820, ct: 60 });
  assert.equal(forecastEnd(RUN, { ctOf: () => 30, nowMin: 600 }).etaMin, 630);
});

test('forecastEnd: CT ของตัวแทนไม่มี → ถอยไปใช้ของสมาชิกในกลุ่ม (คู่/OP)', () => {
  const run = { ...RUN, matNo: 'L1', mats: ['L1', 'R1'] };
  const ct = { R1: 45 };
  const r = forecastEnd(run, { ctOf: (m) => ct[m], nowMin: 600 });
  assert.equal(r.ct, 45);
  assert.equal(r.etaMin, 645);
});

test('forecastEnd: ผลิตครบแล้ว / ไม่มี run / ไม่รู้เวลาปัจจุบัน = null (ไม่มีอะไรให้คาด)', () => {
  assert.equal(forecastEnd({ ...RUN, remaining: 0 }, { ctOf: () => 60, nowMin: 600 }), null);
  assert.equal(forecastEnd(null, { ctOf: () => 60, nowMin: 600 }), null);
  assert.equal(forecastEnd(RUN, { ctOf: () => 60, nowMin: null }), null);
});

/* ── 4) ไม่มี API สำหรับ Middle โดยตั้งใจ ───────────────────────────────── */
test('ไฟล์นี้ export เฉพาะ addWorkMinutes / modelRuns / forecastEnd — ไม่มีตัวคาดการณ์ Middle (กติกาอยู่ใน edge)', () => {
  assert.deepEqual(Object.keys(mod).sort(), ['addWorkMinutes', 'forecastEnd', 'modelRuns']);
  assert.ok(!Object.keys(mod).some(k => /mid/i.test(k)));
});
