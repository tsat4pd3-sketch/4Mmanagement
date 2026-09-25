import test from 'node:test';
import assert from 'node:assert/strict';
import { jphStandard, jphActual, jphRow, jphTable, jphSummary, GAP_ALERT } from '../jph.js';

test('jphStandard: 3600 ÷ CT', () => {
  assert.equal(jphStandard(60), 60);
  assert.equal(jphStandard(30), 120);
  assert.equal(jphStandard(7.2), 500);
});

test('jphStandard: ไม่มี CT = null ไม่ใช่ 0 (0 แปลว่า "ทำไม่ได้" ซึ่งไม่จริง)', () => {
  assert.equal(jphStandard(0), null);
  assert.equal(jphStandard(null), null);
  assert.equal(jphStandard('abc'), null);
  assert.equal(jphStandard(-5), null);
});

test('jphActual: ยอดต่อกะ ÷ ชั่วโมงสุทธิ (490 นาที = 8.1667 ชม.)', () => {
  assert.equal(Math.round(jphActual(490, 490)), 60);
  assert.equal(Math.round(jphActual(1000, 490) * 100) / 100, 122.45);
});

test('jphActual: ขาดค่าใดค่าหนึ่ง = null', () => {
  assert.equal(jphActual(0, 490), null);
  assert.equal(jphActual(500, 0), null);
  assert.equal(jphActual(null, 490), null);
});

/* ─── 🔴 กฎเหล็ก 1 — method='ct' ห้ามนับเป็นของจริง ────────────────────── */
test('jphRow: est.method="ct" ⇒ actual null + flag no_actual (กันเทียบตัวเองกับตัวเอง)', () => {
  const r = jphRow({ ctSec: 60, est: { perShift: 367, method: 'ct', n: 1 }, netMin: 490, oee: 0.75 });
  assert.equal(r.actual, null);
  assert.equal(r.flag, 'no_actual');
  assert.match(r.note, /CT×OEE/);
  assert.equal(r.ratio, null, 'ห้ามคิด ratio จากค่าที่มาจาก CT×OEE');
});

test('jphRow: est.method="actual" ⇒ ใช้เป็นของจริงได้', () => {
  const r = jphRow({ ctSec: 60, est: { perShift: 400, method: 'actual', n: 8 }, netMin: 490, oee: 0.8 });
  assert.equal(r.std, 60);
  assert.equal(Math.round(r.actual * 10) / 10, 49);
  assert.equal(r.expected, 48);
  assert.equal(r.flag, 'ok');
  assert.equal(r.n, 8);
});

test('jphRow: ไม่มี est เลย ⇒ no_actual พร้อมข้อความคนละแบบกับกรณี method=ct', () => {
  const a = jphRow({ ctSec: 60, est: null, netMin: 490, oee: 0.8 });
  const b = jphRow({ ctSec: 60, est: { perShift: 100, method: 'ct' }, netMin: 490, oee: 0.8 });
  assert.equal(a.flag, 'no_actual');
  assert.equal(b.flag, 'no_actual');
  assert.notEqual(a.note, b.note, 'สองสาเหตุนี้แก้คนละวิธี ข้อความต้องต่างกัน');
});

/* ─── 🔴 กฎเหล็ก 2 — ชิ้น ≠ shot: งานคู่ห้ามคูณ 2 ───────────────────────── */
test('jphRow: งานคู่ RH/LH — std ของพาร์ทนี้ไม่ถูกคูณ 2 (แค่ติดป้าย paired)', () => {
  const solo = jphRow({ ctSec: 30, est: null, netMin: 490, oee: 0.8, paired: false });
  const pair = jphRow({ ctSec: 30, est: null, netMin: 490, oee: 0.8, paired: true });
  assert.equal(solo.std, 120);
  assert.equal(pair.std, 120, 'คูณ 2 = JPH สูงเกินจริงเท่าตัว');
  assert.equal(pair.paired, true);
});

/* ─── 🔴 กฎเหล็ก 3 — actual > std = CT ผิด ─────────────────────────────── */
test('jphRow: ผลิตเร็วกว่าเพดานทฤษฎี ⇒ ct_suspect ไม่ใช่ "ไลน์เก่ง"', () => {
  const r = jphRow({ ctSec: 60, est: { perShift: 900, method: 'actual', n: 10 }, netMin: 490, oee: 0.8 });
  assert.ok(r.actual > r.std);
  assert.equal(r.flag, 'ct_suspect');
  assert.match(r.note, /CT/);
});

/* ─── 🔴 กฎเหล็ก 4 — ratio ควรใกล้ OEE ─────────────────────────────────── */
test('jphRow: ratio ห่างจาก OEE เกินเกณฑ์ ⇒ mismatch', () => {
  // std 60 · actual 18 ⇒ ratio 30% · OEE 80% ⇒ ห่าง 50 จุด
  const r = jphRow({ ctSec: 60, est: { perShift: 147, method: 'actual', n: 5 }, netMin: 490, oee: 0.8 });
  assert.equal(r.flag, 'mismatch');
  assert.match(r.note, /ห่างจาก OEE/);
});

test('jphRow: ratio ใกล้ OEE พอดีขอบเกณฑ์ ⇒ ยัง ok', () => {
  const std = 60, oee = 0.8;
  const targetRatio = oee - GAP_ALERT + 0.01;           // ห่าง 19 จุด < 20
  const perShift = Math.round(std * targetRatio * (490 / 60));
  assert.equal(jphRow({ ctSec: 60, est: { perShift, method: 'actual', n: 5 }, netMin: 490, oee }).flag, 'ok');
});

test('jphRow: ไม่มี OEE ⇒ expected null แต่ std/actual/ratio ยังคิดได้ (ห้ามเงียบทั้งแถว)', () => {
  const r = jphRow({ ctSec: 60, est: { perShift: 400, method: 'actual', n: 8 }, netMin: 490, oee: null });
  assert.equal(r.expected, null);
  assert.equal(r.std, 60);
  assert.ok(r.actual > 0);
  assert.ok(r.ratio > 0);
  assert.equal(r.flag, 'ok', 'ไม่มี OEE = เทียบ mismatch ไม่ได้ ไม่ใช่ผิด');
});

/* ─── jphTable ─────────────────────────────────────────────────────────── */
const MATS = ['A', 'B', 'C', 'D'];
const CT = { A: 60, B: 60, C: 0, D: 60 };
const EST = {
  A: { perShift: 400, method: 'actual', n: 8 },   // ok
  B: { perShift: 900, method: 'actual', n: 9 },   // ct_suspect
  C: { perShift: 100, method: 'actual', n: 4 },   // no_ct
  D: { perShift: 200, method: 'ct', n: 1 },       // no_actual
};
const QTY = { A: 1000, B: 500, C: 300, D: 100 };
const T = () => jphTable({
  mats: MATS, netMin: 490, oee: 0.8,
  ctOf: m => CT[m], estOf: m => EST[m], qtyOf: m => QTY[m],
  nameOf: m => `ชิ้น ${m}`, customerOf: m => (m === 'A' ? 'TSPK' : null), pairOf: () => null,
});

test('jphTable: เรียงตัวที่น่าสงสัยขึ้นก่อน (ct_suspect → mismatch → no_ct → no_actual → ok)', () => {
  assert.deepEqual(T().map(r => r.flag), ['ct_suspect', 'no_ct', 'no_actual', 'ok']);
});

test('jphTable: แถวที่คิดไม่ได้ต้องอยู่ในตารางด้วย ห้ามกรองทิ้ง', () => {
  assert.equal(T().length, MATS.length);
});

test('jphTable: พาชื่อ/ลูกค้า/ยอดชิ้นมาด้วย (จอต้องแยกลูกค้าได้)', () => {
  const a = T().find(r => r.mat_no === 'A');
  assert.equal(a.name, 'ชิ้น A');
  assert.equal(a.customer, 'TSPK');
  assert.equal(a.qty, 1000);
});

/* ─── jphSummary ───────────────────────────────────────────────────────── */
test('jphSummary: นับแยกทุกสาเหตุ + บอกว่าเทียบได้กี่พาร์ทจากทั้งหมด', () => {
  const s = jphSummary(T());
  assert.equal(s.total, 4);
  assert.equal(s.comparable, 1, 'เทียบได้แค่ A (ok) — B ct ผิด · C ไม่มี CT · D ไม่มีของจริง');
  assert.equal(s.ctSuspect, 1);
  assert.equal(s.noCt, 1);
  assert.equal(s.noActual, 1);
});

test('jphSummary: ค่าเฉลี่ยถ่วงน้ำหนักด้วยจำนวนชิ้น ไม่ใช่เฉลี่ยธรรมดา', () => {
  const rows = [
    { flag: 'ok', qty: 1000, std: 100, actual: 50, ratio: 0.5 },
    { flag: 'ok', qty: 10,   std: 100, actual: 90, ratio: 0.9 },
  ];
  const s = jphSummary(rows);
  // เฉลี่ยธรรมดา = 0.7 · ถ่วงน้ำหนัก = (0.5×1000 + 0.9×10) / 1010 ≈ 0.504
  assert.ok(Math.abs(s.avgRatio - 0.504) < 0.002, `ได้ ${s.avgRatio}`);
  assert.notEqual(Math.round(s.avgRatio * 10) / 10, 0.7);
});

test('jphSummary: ไม่มีแถวเทียบได้เลย ⇒ ค่าเฉลี่ยเป็น null ไม่ใช่ 0', () => {
  const s = jphSummary([{ flag: 'no_ct', qty: 100, std: null, actual: null, ratio: null }]);
  assert.equal(s.avgRatio, null);
  assert.equal(s.avgStd, null);
  assert.equal(s.comparable, 0);
});
