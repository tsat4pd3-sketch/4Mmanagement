/*
  เทสเป้า A/P/Q + ค่าเฉลี่ย OEE ข้ามเดือน/ไตรมาส (`src/utils/oee.js`)
  ใช้โดยเด็ค Monthly Review โหมด full data (เส้นเป้าบนกราฟ + OEE รายไตรมาส) — 2026-09-08
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_OEE_TARGET, targetOeeOf, normOeeTarget, weightedOeeOf, quarterOfMonthKey } from '../oee.js';

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

  const row = normOeeTarget({ target_a: 92, target_p: null, target_q: 99.5 });
  assert.equal(row.a, 92);
  assert.equal(row.p, 90, 'คอลัมน์ null ต้องถอยไปค่ามาตรฐาน ไม่ใช่ 0');
  assert.equal(row.q, 99.5);
  assert.equal(row.isDefault, false);
  assert.equal(row.oee, targetOeeOf({ a: 92, p: 90, q: 99.5 }));

  // ค่าที่แปลงเป็นตัวเลขไม่ได้ ต้องไม่กลายเป็น NaN ทั้งเป้า
  assert.equal(normOeeTarget({ target_a: '', target_p: 'x' }).a, 90);
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

test('weightedOeeOf + quarterOfMonthKey: กรองรายไตรมาสได้ตรง', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({
    monthKey: `2026-${String(i + 1).padStart(2, '0')}`, oee: 60 + i, loadHr: 100, nSess: 10,
  }));
  assert.equal(quarterOfMonthKey('2026-01'), 1);
  assert.equal(quarterOfMonthKey('2026-03'), 1);
  assert.equal(quarterOfMonthKey('2026-04'), 2);
  assert.equal(quarterOfMonthKey('2026-12'), 4);
  assert.equal(weightedOeeOf(rows, r => quarterOfMonthKey(r.monthKey) === 1), 61); // (60+61+62)/3
  assert.equal(weightedOeeOf(rows, r => quarterOfMonthKey(r.monthKey) === 4), 70); // (69+70+71)/3
  assert.equal(weightedOeeOf(rows), 65.5);                                          // ทั้งปี
  // ไตรมาสที่ยังไม่ถึง = null ไม่ใช่ 0
  assert.equal(weightedOeeOf(rows.slice(0, 3), r => quarterOfMonthKey(r.monthKey) === 3), null);
});
