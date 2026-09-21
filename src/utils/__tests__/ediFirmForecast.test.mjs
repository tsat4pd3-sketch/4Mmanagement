/* แถว 862 ที่ "ไม่มีเวลาส่ง + เกิน horizon" ต้องไม่กลายเป็นใบส่งของ (2026-09-21)
   บั๊กจริง: ชีตที่ช่อง Forecast Time ว่าง ทอดยาวถึง ก.ย. 2027 ไหลเข้าเป็น
   customer_shipping_orders 1,361 ใบ / 2.0 ล้านชิ้น → ทยอยกลายเป็นสีแดงวันต่อวัน
   ⏱️ ทุกเคสตรึง `today` เป็นพารามิเตอร์ — ห้ามอ่านนาฬิกาจริง (กันเทสระเบิดเวลา) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitFirmVsForecast, FIRM_HORIZON_DAYS, addDays } from '../ediMerge.js';
import { forecastSpreadDays, dedupeForecastRows, demandByDay, demandOf } from '../demandSupply.js';

const TODAY = '2026-09-21';
const rec = (date, time, extra = {}) => ({ shipTo: 'GBJWC', mat_no: '10100385', date, time, qty: 100, ...extra });

test('มีเวลาส่ง = ใบส่งของเสมอ ต่อให้ไกลแค่ไหน (เที่ยวที่ยืนยันแล้ว)', () => {
  const { firm, forecast } = splitFirmVsForecast([rec('2027-09-13', '08:00')], TODAY);
  assert.equal(firm.length, 1);
  assert.equal(forecast.length, 0);
});

test('ไม่มีเวลาส่ง แต่อยู่ใน horizon = ยังเป็นใบส่งของ (ของใกล้ส่ง หน้างานต้องเห็น)', () => {
  const inHorizon = addDays(TODAY, FIRM_HORIZON_DAYS);       // วันสุดท้ายที่ยังนับเป็น firm
  const { firm, forecast } = splitFirmVsForecast([rec(inHorizon, '')], TODAY);
  assert.equal(firm.length, 1, 'ขอบเขตต้องเป็น "เกิน" ไม่ใช่ "ตั้งแต่"');
  assert.equal(forecast.length, 0);
});

test('ไม่มีเวลาส่ง + เกิน horizon = แผนระยะยาว', () => {
  const beyond = addDays(TODAY, FIRM_HORIZON_DAYS + 1);
  const { firm, forecast } = splitFirmVsForecast([rec(beyond, '')], TODAY);
  assert.equal(firm.length, 0);
  assert.equal(forecast.length, 1);
});

test('time เป็นช่องว่าง/undefined/null ถือว่าไม่มีเวลาเหมือนกัน', () => {
  const beyond = addDays(TODAY, 90);
  const { forecast } = splitFirmVsForecast(
    [rec(beyond, '   '), rec(beyond, undefined), rec(beyond, null)], TODAY);
  assert.equal(forecast.length, 3);
});

test('ไฟล์ปนกันทุกแบบ — แยกครบ ไม่มีแถวหาย', () => {
  const recs = [
    rec('2026-09-22', '08:00'), rec('2026-09-22', ''),
    rec('2027-01-05', ''), rec('2027-01-05', '13:00'), rec('2026-12-31', ''),
  ];
  const { firm, forecast } = splitFirmVsForecast(recs, TODAY);
  assert.equal(firm.length + forecast.length, recs.length, 'ห้ามมีแถวหายระหว่างแยก');
  assert.equal(forecast.length, 2);
});

test('records ว่าง/undefined ต้องไม่ throw', () => {
  assert.deepEqual(splitFirmVsForecast([], TODAY), { firm: [], forecast: [] });
  assert.deepEqual(splitFirmVsForecast(undefined, TODAY), { firm: [], forecast: [] });
});

test('แถวไม่มีวันที่ = ไม่เดา ปล่อยเป็นใบส่งของตามเดิม', () => {
  const { firm, forecast } = splitFirmVsForecast([rec(null, '')], TODAY);
  assert.equal(firm.length, 1);
  assert.equal(forecast.length, 0);
});

test('addDays ข้ามเดือน/ปี และไม่เพี้ยนเพราะ UTC', () => {
  assert.equal(addDays('2026-12-25', 10), '2027-01-04');
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(addDays('2026-09-21', 0), '2026-09-21');
});

/* ── ฝั่งบริโภค: grain ของ forecast ต้องถูก ไม่งั้น demand เพี้ยน ── */

test('edi_862 = ราย 1 วัน · edi_830 = ราย 7 วัน · manual = ทั้งเดือน', () => {
  assert.equal(forecastSpreadDays({ source: 'edi_862', period_month: '2026-11-10' }), 1);
  assert.equal(forecastSpreadDays({ source: 'edi_830', period_month: '2026-11-10' }), 7);
  assert.equal(forecastSpreadDays({ source: 'manual', period_month: '2026-11-01' }), 30);
});

test('เกลี่ย edi_862 ลงวันเดียว ไม่ใช่ทั้งเดือน (เกลี่ยผิด = simulate บอก "ของพอ" ผิด)', () => {
  const { byDay } = demandByDay([], [{ source: 'edi_862', mat_no: 'M1', period_month: '2026-11-10', qty: 300 }]);
  assert.equal(Math.round(demandOf(byDay['2026-11-10'])), 300);
  assert.equal(byDay['2026-11-11'], undefined, 'ห้ามล้นไปวันถัดไป');
});

test('830 ยังชนะ 862 ใน dedupe — mat×เดือนเดียวกันต้องไม่นับซ้ำ', () => {
  const rows = [
    { source: 'edi_830', mat_no: 'M1', period_month: '2026-11-02', qty: 700 },
    { source: 'edi_862', mat_no: 'M1', period_month: '2026-11-10', qty: 300 },
    { source: 'edi_862', mat_no: 'M2', period_month: '2026-11-10', qty: 50 },
  ];
  const kept = dedupeForecastRows(rows);
  assert.equal(kept.length, 2);
  assert.ok(kept.every(r => !(r.source === 'edi_862' && r.mat_no === 'M1')), '862 ของ M1 ต้องถูกทิ้ง');
  assert.ok(kept.some(r => r.mat_no === 'M2'), 'MAT ที่ไม่มี 830 ต้องไม่หาย');
});
