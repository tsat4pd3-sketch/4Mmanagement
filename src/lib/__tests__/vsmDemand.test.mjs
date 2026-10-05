/* VSM Order/year = 12 เดือนนับจากเดือนที่เลือก · EDI 830 ชนะ manual รายเดือน (QC 05/10)
   เดิมบวก forecast ทุกแถวที่เคยมี (ทุกปี + EDI ซ้อน manual) ⇒ Order/year พองหลายเท่า */
import test from 'node:test';
import assert from 'node:assert/strict';
import { demandOf } from '../vsmModel.js';

const fc = (mk, qty, source = 'manual') => ({ period_month: `${mk}-01`, qty, source });

test('นับแค่ 12 เดือนจากเดือนที่เลือก — forecast ปีก่อน/เกินปี ไม่ถูกบวก', () => {
  const rows = [fc('2025-10', 9999), fc('2027-10', 9999)];
  for (let i = 0; i < 12; i++) {
    const t = 2026 * 12 + 9 + i;
    rows.push(fc(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`, 100));
  }
  const d = demandOf({ forecasts: rows, monthKey: '2026-10', workingDays: 20 });
  assert.equal(d.perYear, 1200);
  assert.equal(d.yearMonths, 12);
  assert.equal(d.perMonth, 100);
  assert.equal(d.perDay, 5);
});

test('เดือนที่มีทั้ง EDI 830 และ manual → ใช้ EDI อย่างเดียว (ไม่บวกซ้อน)', () => {
  const rows = [fc('2026-10', 500, 'manual'), fc('2026-10', 300, 'edi_830'), fc('2026-11', 200, 'manual')];
  const d = demandOf({ forecasts: rows, monthKey: '2026-10', workingDays: 0 });
  assert.equal(d.perMonth, 300);
  // 2 เดือนที่มีข้อมูล (300 + 200) ⇒ ประมาณ (500/2)×12 และบอกว่าจาก 2 เดือน
  assert.equal(d.perYear, 3000);
  assert.equal(d.yearMonths, 2);
  assert.equal(d.perDay, null);
});

test('ข้ามปี (พ.ย. → ต.ค. ปีถัดไป)', () => {
  const rows = [fc('2026-11', 10), fc('2027-10', 10), fc('2027-11', 999)];
  const d = demandOf({ forecasts: rows, monthKey: '2026-11', workingDays: 1 });
  assert.equal(d.yearMonths, 2);
  assert.equal(d.perYear, 120);
});

test('ไม่มี forecast → ใช้ order × 12 · ไม่มีอะไรเลย = null ไม่ใช่ 0', () => {
  const d = demandOf({ forecasts: [], orders: [{ qty: 40 }], monthKey: '2026-10', workingDays: 20 });
  assert.equal(d.source, 'order');
  assert.equal(d.perYear, 480);
  const z = demandOf({ forecasts: [], orders: [], monthKey: '2026-10', workingDays: 20 });
  assert.equal(z.perYear, null);
  assert.equal(z.perMonth, null);
});
