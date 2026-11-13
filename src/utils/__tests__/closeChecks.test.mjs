/* ══ 🛡️ poka-yoke หน้าปิดกะ (utils/closeChecks.js · 2026-11-11 · คำสั่ง user) ══════════════
   "จับตอนคนยังอยู่หน้าเครื่อง" — ล็อกไว้ว่า **ไม่รู้ = ไม่เตือน** และเกณฑ์ไม่หลวมจนไม่จับเคสจริง */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkQtyFit, qtyFitMessage, buildCloseChecks, confirmChecks, QTY_FIT_MIN_OVER } from '../closeChecks.js';

/* ── ① ด่านตอนลงยอด ───────────────────────────────────────────────────────────── */

test('🔴 เคสจริง HYDROFORM 25/06 — 800 ชิ้น CT 50 วิ บนเครื่องที่เดินจริง 70 นาที ต้องจับได้', () => {
  const fit = checkQtyFit({ qty: 800, ctSec: 50, winMin: 70 });
  assert.ok(fit, 'ต้องเตือน');
  assert.equal(fit.needMin, 667);
  assert.equal(fit.haveMin, 70);
  assert.equal(fit.overMin, 597);
  assert.match(qtyFitMessage(fit, { matNo: 'M1', qty: 800, ctSec: 50 }), /667 นาที/);
  assert.match(qtyFitMessage(fit, { matNo: 'M1', qty: 800, ctSec: 50 }), /ตรวจก่อนบันทึก/);
});

test('🔴 ไม่รู้ = ไม่เตือน (ไม่มี CT · ไม่รู้ช่วงเวลา · ยอด 0)', () => {
  assert.equal(checkQtyFit({ qty: 800, ctSec: 0,    winMin: 70 }), null);
  assert.equal(checkQtyFit({ qty: 800, ctSec: null, winMin: 70 }), null);
  assert.equal(checkQtyFit({ qty: 800, ctSec: 50,   winMin: 0 }), null);
  assert.equal(checkQtyFit({ qty: 800, ctSec: 50,   winMin: null }), null);
  assert.equal(checkQtyFit({ qty: 0,   ctSec: 50,   winMin: 70 }), null);
  assert.equal(checkQtyFit({}), null);
  assert.equal(qtyFitMessage(null), '');
});

test('🔴 CT = ค่ามาตรฐาน เดินเร็วกว่าได้ ⇒ เกินเล็กน้อยห้ามเตือน', () => {
  // ต้องใช้ 100 นาที มีให้ 95 → เกิน 5 นาที (ต่ำกว่าเกณฑ์) = เงียบ
  assert.equal(checkQtyFit({ qty: 120, ctSec: 50, winMin: 95 }), null);
  // เร็วกว่ามาตรฐาน 10% = เงียบ
  assert.equal(checkQtyFit({ qty: 100, ctSec: 60, winMin: 92 }), null);
});

test('🔴 เกินเกณฑ์นาทีขั้นต่ำเท่านั้นถึงเตือน', () => {
  const near = checkQtyFit({ qty: 100, ctSec: 60, winMin: 86 });   // need 100 · over 14 น.
  assert.equal(near, null, `เกิน ${QTY_FIT_MIN_OVER} นาทีขึ้นไปจึงเตือน`);
  assert.ok(checkQtyFit({ qty: 100, ctSec: 60, winMin: 80 }));     // over 20 น.
});

test('🔀 ไลน์ขนาน — หารเลนก่อนเทียบ (ไม่งั้นเตือนผิดทุกใบ)', () => {
  assert.ok(checkQtyFit({ qty: 800, ctSec: 50, winMin: 70, parallelN: 1 }));
  assert.equal(checkQtyFit({ qty: 800, ctSec: 50, winMin: 70, parallelN: 10 }), null, '10 เลน = 67 นาที พอดี');
});

test('👯 ชิ้น ≠ shot — piecesPerShot 2 ต้องหารก่อน (งานคู่ gang die)', () => {
  const one = checkQtyFit({ qty: 200, ctSec: 60, winMin: 100 });
  assert.ok(one, 'ชิ้นต่อ shot = 1 ⇒ 200 นาที > 100');
  assert.equal(checkQtyFit({ qty: 200, ctSec: 60, winMin: 100, piecesPerShot: 2 }), null, 'ปั๊มทีเดียว 2 ชิ้น = 100 นาที พอดี');
});

test('⏱️ downtime ในช่วงนั้นถูกหักออกจาก "เวลาที่มี"', () => {
  assert.equal(checkQtyFit({ qty: 100, ctSec: 60, winMin: 180 }), null);
  const fit = checkQtyFit({ qty: 100, ctSec: 60, winMin: 180, dtMin: 100 });
  assert.ok(fit, 'หยุด 100 นาที ⇒ เหลือ 80 นาที ทำ 100 นาทีไม่ทัน');
  assert.equal(fit.haveMin, 80);
});

/* ── ② ด่านรีเช็คก่อนปิดกะ ─────────────────────────────────────────────────────── */

const oeeOk = { shiftMin: 570, runMin: 500, stdMin: 480, loggedDtMin: 40, totalProduced: 900,
  pOver: false, pRawPct: 96, dtOverstateMin: null, unknownQty: 0, ngNoMatP: 0 };

test('🔴 กะที่ข้อมูลตรงกัน = ไม่มีอะไรให้ติ๊ก (ห้ามกวนทุกกะ)', () => {
  const checks = buildCloseChecks({ oee: oeeOk, session: { shift: 'day' }, dtRowCount: 3 });
  assert.deepEqual(confirmChecks(checks), []);
});

test('🔴 งานเกินเวลาที่เครื่องมี (%P ทะลุ 100) = ต้องติ๊กยืนยัน', () => {
  const checks = buildCloseChecks({
    oee: { ...oeeOk, pOver: true, pRawPct: 950, dtOverstateMin: 597, stdMin: 667, runMin: 70 },
    session: { shift: 'day' }, dtRowCount: 2,
  });
  const c = checks.find(x => x.key === 'work_over_time');
  assert.ok(c, 'ต้องมีข้อนี้');
  assert.equal(c.level, 'confirm');
  assert.match(c.title, /597 นาที/);
  assert.match(c.hint, /ลืมลง Downtime/);
});

test('🔴 %P ทะลุแค่เศษนาที = ไม่กวน', () => {
  const checks = buildCloseChecks({ oee: { ...oeeOk, pOver: true, pRawPct: 101, dtOverstateMin: 5 }, session: {} });
  assert.equal(checks.find(c => c.key === 'work_over_time'), undefined);
});

test('🔴 เวลาหยุดรวมมากกว่าเวลากะ = เป็นไปไม่ได้ ต้องติ๊ก', () => {
  const checks = buildCloseChecks({ oee: { ...oeeOk, loggedDtMin: 700 }, session: {}, dtRowCount: 5 });
  assert.equal(checks.find(c => c.key === 'dt_over_shift')?.level, 'confirm');
  // เท่าๆ กันไม่ต้องเตือน (ปัดเศษ)
  assert.equal(buildCloseChecks({ oee: { ...oeeOk, loggedDtMin: 575 }, session: {} }).find(c => c.key === 'dt_over_shift'), undefined);
});

test('🔴 กะยาวแต่ไม่มีทั้งยอดและ downtime = ลืมลงข้อมูล ต้องติ๊ก', () => {
  const checks = buildCloseChecks({ oee: { ...oeeOk, totalProduced: 0 }, session: {}, dtRowCount: 0 });
  assert.equal(checks.find(c => c.key === 'no_data')?.level, 'confirm');
  // มี downtime รองรับแล้ว (ลง "ไม่มีแผนผลิต") = ไม่เตือน
  assert.equal(buildCloseChecks({ oee: { ...oeeOk, totalProduced: 0 }, session: {}, dtRowCount: 1 })
    .find(c => c.key === 'no_data'), undefined);
});

test('🔴 เวลาปิดกะล้ำหน้าโดยไม่มีใบรองรับ = ต้องติ๊ก · ตรวจไม่ได้ (null) = ปล่อยผ่าน', () => {
  const warn = { ok: false, aheadMin: 120, coveredMin: 0, unaccountedMin: 120, nowHHmm: '16:05' };
  const c = buildCloseChecks({ oee: oeeOk, session: {}, endTimeWarn: warn }).find(x => x.key === 'end_time_far');
  assert.equal(c?.level, 'confirm');
  assert.match(c.hint, /16:05/);
  assert.equal(buildCloseChecks({ oee: oeeOk, session: {}, endTimeWarn: null })
    .find(x => x.key === 'end_time_far'), undefined);
  assert.equal(buildCloseChecks({ oee: oeeOk, session: {}, endTimeWarn: { ok: true } })
    .find(x => x.key === 'end_time_far'), undefined);
});

test('ℹ️ เรื่องที่คนลงข้อมูลแก้เองไม่ได้ = info ห้ามบังคับติ๊ก', () => {
  const checks = buildCloseChecks({
    oee: { ...oeeOk, unknownQty: 120, ngNoMatP: 8 }, session: {}, dtRowCount: 1, suspectPending: 30,
  });
  assert.deepEqual(confirmChecks(checks), []);
  for (const k of ['qty_no_ct', 'ng_no_mat', 'suspect_pending']) {
    assert.equal(checks.find(c => c.key === k)?.level, 'info', k);
  }
});

test('🔴 ไม่มีผล OEE = ไม่มีด่าน (ห้ามพังหรือเดา)', () => {
  assert.deepEqual(buildCloseChecks({}), []);
  assert.deepEqual(buildCloseChecks({ oee: null }), []);
});

/* 🔍 ใบนอกแผนที่ปิดตรงเวลาเลิกกะ (13/11 · คำสั่ง user "ถ้านานจริง ผลิตก็ต้องรับผิดชอบ")
   ที่มา: ไล่ใบ ต.ค. 6 ใบที่ซ่อมเสร็จแล้วปิดช้าสุด → ทั้ง 6 ใบปิดตรงเวลาเลิกกะเป๊ะ */
test('ปิดกะ — ใบนอกแผนที่ปิดตรงเวลาเลิกกะ ต้องขึ้นด่านให้ติ๊ก (confirm ไม่ใช่ block)', () => {
  const oee = { shiftMin: 600, totalProduced: 100, loggedDtMin: 60, pOver: false };
  const r = buildCloseChecks({ oee, dtRowCount: 3, dtClosedAtShiftEnd: 2 });
  const f = r.find(x => x.key === 'dt_closed_at_shift_end');
  assert.ok(f, 'ต้องมีด่านนี้');
  assert.equal(f.level, 'confirm', 'เตือนให้ติ๊ก ห้ามบล็อก — หยุดยาวถึงเลิกกะจริงก็มี');
  assert.match(f.title, /2 ใบ/);
  assert.match(f.detail, /%A/, 'ต้องบอกผลที่ตามมาทั้ง 2 ขา');
  assert.match(f.detail, /%P/);
  assert.ok(f.hint.length > 20, 'ต้องบอกว่าไปแก้ที่ไหน');
});

test('🔴 ไม่มีใบปิดตรงเลิกกะ = ไม่ขึ้นด่าน (ห้ามรบกวนทุกกะ)', () => {
  const oee = { shiftMin: 600, totalProduced: 100, loggedDtMin: 60, pOver: false };
  for (const v of [0, null, undefined, '']) {
    assert.equal(buildCloseChecks({ oee, dtRowCount: 3, dtClosedAtShiftEnd: v })
      .some(x => x.key === 'dt_closed_at_shift_end'), false, `ค่า ${v} ต้องไม่ขึ้นด่าน`);
  }
  /* ไม่ส่งพารามิเตอร์มาเลย = ของเดิมทำงานเหมือนเดิมเป๊ะ */
  assert.equal(buildCloseChecks({ oee, dtRowCount: 3 }).some(x => x.key === 'dt_closed_at_shift_end'), false);
});
