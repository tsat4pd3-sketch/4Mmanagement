/*
  เทสเป้า A/P/Q + ค่าเฉลี่ย OEE ข้ามเดือน/ไตรมาส (`src/utils/oee.js`)
  ใช้โดยเด็ค Monthly Review โหมด full data (เส้นเป้าบนกราฟ + OEE รายไตรมาส) — 2026-09-08
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OEE_TARGET, targetOeeOf, normOeeTarget, avgOeeTarget, weightedOeeOf, weekOfMonth } from '../oee.js';

test('เป้า OEE = A × P × Q เสมอ (ห้ามอ่าน target_oee ที่เป็นคอลัมน์ vestigial)', () => {
  assert.equal(targetOeeOf({ a: 90, p: 90, q: 99 }), 80.2);
  assert.equal(targetOeeOf({ a: 100, p: 100, q: 100 }), 100);
  assert.equal(targetOeeOf({ a: 85, p: 95, q: 99.5 }), 80.3); // 80.34625 → ปัด 1 ตำแหน่ง
  // ค่าที่ไม่ได้ตั้ง = ใช้ค่ามาตรฐานทีละตัว
  assert.equal(targetOeeOf({ a: 100 }), targetOeeOf({ a: 100, p: DEFAULT_OEE_TARGET.p, q: DEFAULT_OEE_TARGET.q }));
  assert.equal(targetOeeOf({}), 80.2);
});

test('normOeeTarget: null/ค่าว่าง = ค่ามาตรฐาน + ติดธง isDefault', () => {
  const d = normOeeTarget(null);
  assert.deepEqual({ a: d.a, p: d.p, q: d.q }, DEFAULT_OEE_TARGET);
  assert.equal(d.oee, 80.2);
  assert.equal(d.isDefault, true);
  assert.deepEqual(d.missing, [], 'ไม่มีแถวเลย = isDefault ไม่ใช่ missing รายช่อง');

  const row = normOeeTarget({ target_a: 92, target_p: null, target_q: 99.5 });
  assert.equal(row.a, 92);
  assert.equal(row.p, 90, 'คอลัมน์ null ต้องถอยไปค่ามาตรฐาน ไม่ใช่ 0');
  assert.equal(row.q, 99.5);
  assert.equal(row.isDefault, false);
  assert.deepEqual(row.missing, ['p'], 'มีแถวแต่เว้น P ว่าง → ต้องบอกว่า P ถูกเติมด้วยค่ามาตรฐาน');
  assert.equal(row.oee, targetOeeOf({ a: 92, p: 90, q: 99.5 }));

  // ค่าที่แปลงเป็นตัวเลขไม่ได้ ต้องไม่กลายเป็น NaN ทั้งเป้า
  assert.equal(normOeeTarget({ target_a: '', target_p: 'x' }).a, 90);
  assert.deepEqual(normOeeTarget({ target_a: '', target_p: 'x', target_q: 99 }).missing, ['a', 'p']);
  assert.ok(Number.isFinite(normOeeTarget({ target_a: 'x', target_p: 'y', target_q: 'z' }).oee));
});

test('weightedOeeOf: ถ่วงเวลารับภาระ ไม่ใช่เฉลี่ยเปอร์เซ็นต์ตรงๆ', () => {
  const rows = [
    { monthKey: '2026-01', oee: 60, loadHr: 100, nSess: 10 },
    { monthKey: '2026-02', oee: 90, loadHr: 900, nSess: 10 },
  ];
  // mean ธรรมดา = 75 · ถ่วงน้ำหนัก = (60×100 + 90×900)/1000 = 87
  assert.equal(weightedOeeOf(rows), 87);
  assert.notEqual(weightedOeeOf(rows), 75);
});

test('weightedOeeOf: ข้ามเดือนที่ไม่มีกะปิด/OEE ว่าง · ไม่มีข้อมูลเลย = null (ไม่ใช่ 0)', () => {
  const rows = [
    { monthKey: '2026-01', oee: 80, loadHr: 100, nSess: 10 },
    { monthKey: '2026-02', nSess: 0 },                       // ไม่มีกะปิด
    { monthKey: '2026-03', oee: null, loadHr: 500, nSess: 5 }, // OEE ว่าง
  ];
  assert.equal(weightedOeeOf(rows), 80);
  assert.equal(weightedOeeOf([{ monthKey: '2026-01', nSess: 0 }]), null);
  assert.equal(weightedOeeOf([]), null);
  assert.equal(weightedOeeOf(null), null);
});

test('weightedOeeOf: ไม่มีน้ำหนักเลย → ถอยไปเฉลี่ยธรรมดา ดีกว่าคืน null ทั้งที่มีข้อมูล', () => {
  const rows = [{ oee: 70, nSess: 1 }, { oee: 80, nSess: 1 }];
  assert.equal(weightedOeeOf(rows), 75);
});

test('weekOfMonth: ซอยเดือนเป็น 4 ช่วง — W4 กลืนวันที่ 29-31 (ไม่ใช่ไตรมาสปฏิทิน)', () => {
  assert.equal(weekOfMonth('2026-08-01'), 1);
  assert.equal(weekOfMonth('2026-08-07'), 1);
  assert.equal(weekOfMonth('2026-08-08'), 2);
  assert.equal(weekOfMonth('2026-08-14'), 2);
  assert.equal(weekOfMonth('2026-08-15'), 3);
  assert.equal(weekOfMonth('2026-08-21'), 3);
  assert.equal(weekOfMonth('2026-08-22'), 4);
  assert.equal(weekOfMonth('2026-08-28'), 4);
  // วันที่ 29-31 ต้องอยู่ W4 ไม่ใช่ W5 — ให้ได้ 4 แท่งเท่าเด็คที่วิศวกรทำมือ
  assert.equal(weekOfMonth('2026-08-29'), 4);
  assert.equal(weekOfMonth('2026-08-31'), 4);
  assert.equal(weekOfMonth('2026-02-28'), 4);
  assert.equal(weekOfMonth(''), null);
  assert.equal(weekOfMonth(null), null);
});

test('weightedOeeOf + weekOfMonth: เฉลี่ยรายสัปดาห์ถ่วงเวลารับภาระได้ตรง', () => {
  const rows = [
    { d: '2026-08-03', oee: 70, loadHr: 100, nSess: 2 },
    { d: '2026-08-05', oee: 80, loadHr: 300, nSess: 2 },   // W1 → (70*100+80*300)/400 = 77.5
    { d: '2026-08-25', oee: 90, loadHr: 200, nSess: 2 },   // W4
  ];
  assert.equal(weightedOeeOf(rows, r => weekOfMonth(r.d) === 1), 77.5);
  assert.equal(weightedOeeOf(rows, r => weekOfMonth(r.d) === 4), 90);
  assert.equal(weightedOeeOf(rows, r => weekOfMonth(r.d) === 2), null, 'สัปดาห์ที่ไม่มีกะปิด = null ไม่ใช่ 0');
});

/* ── avgOeeTarget : เป้ารวมหลายกลุ่ม (section / ทั้งเด็ค) ──
   ย้ายสูตรออกจาก OEEAnalytics.targetOf มาที่ utils/oee.js 2026-09-10 เพื่อให้จอ OEE
   กับเด็ค .pptx รายเดือนใช้เลขชุดเดียวกัน — เทสล็อกกติกาที่พลาดง่าย 2 ข้อ */
test('avgOeeTarget — ไม่มีกลุ่มไหนตั้งเป้าเลย = ค่ามาตรฐาน 90/90/99 → 80.2 + configured false', () => {
  const t = avgOeeTarget([]);
  assert.deepEqual([t.a, t.p, t.q, t.oee], [90, 90, 99, 80.2]);
  assert.equal(t.configured, false);
  assert.deepEqual(t.missing, ['a', 'p', 'q']);
});

test('avgOeeTarget — A/P/Q เฉลี่ยเฉพาะกลุ่มที่ตั้งค่านั้นจริง (ค่ามาตรฐานห้ามถ่วงค่าเฉลี่ย)', () => {
  const t = avgOeeTarget([
    { target_a: 85, target_p: 88, target_q: 99 },
    { target_a: 95, target_p: null, target_q: 99 },   // P เว้นว่าง
  ]);
  assert.equal(t.a, 90);          // (85+95)/2
  assert.equal(t.p, 88);          // เฉพาะกลุ่มที่ตั้ง P ไว้ ไม่เอา 90 มาเฉลี่ยด้วย
  assert.equal(t.q, 99);
  assert.deepEqual(t.missing, []);
});

test('avgOeeTarget — OEE = เฉลี่ยของ (A×P×Q ต่อกลุ่ม) ไม่ใช่ a*p*q ของค่าเฉลี่ย', () => {
  const t = avgOeeTarget([
    { target_a: 85, target_p: 88, target_q: 99 },     // 74.052
    { target_a: 95, target_p: null, target_q: 99 },   // 95×90×99 = 84.645
  ]);
  assert.equal(t.oee, 79.3);                          // (74.052+84.645)/2 = 79.3485 → 79.3
  assert.notEqual(t.oee, targetOeeOf(t));             // a*p*q ของค่าเฉลี่ย = 78.4 คนละค่า — ห้าม "แก้" ให้เท่ากัน
});

test('avgOeeTarget — ปัดเศษครั้งเดียวตอนท้าย (ห้ามปัด OEE รายกลุ่มก่อนเฉลี่ย)', () => {
  // ปัดรายกลุ่มก่อนจะได้ 79.4 · ปัดครั้งเดียวได้ 79.3 — เลขบนจอ /oee-analytics คือ 79.3
  const t = avgOeeTarget([
    { target_a: 85, target_p: 88, target_q: 99 },
    { target_a: 95, target_p: 90, target_q: 99 },
  ]);
  assert.equal(t.oee, 79.3);
});

test('avgOeeTarget — กลุ่มเดียวต้องได้เท่ากับ normOeeTarget ของกลุ่มนั้น', () => {
  const row = { target_a: 85, target_p: null, target_q: 99 };
  assert.equal(avgOeeTarget([row]).oee, normOeeTarget(row).oee);
});

test('avgOeeTarget — null/undefined ในลิสต์ = กลุ่มที่ยังไม่ตั้งเป้า ไม่ throw', () => {
  const t = avgOeeTarget([null, { target_a: 95, target_p: 95, target_q: 100 }, undefined]);
  assert.equal(t.configured, true);
  assert.equal(t.a, 95);
  // 3 กลุ่ม: 80.2 + 90.25 + 80.2 → เฉลี่ย 83.5
  assert.equal(t.oee, 83.5);
});
