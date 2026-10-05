/* เทสของ `src/utils/pmRunDay.js` — รอบ PM/AM ที่นับจากวันเดินเครื่อง (2026-10-02)
   ⏱️ ทุกเคสตรึง `todayStr` เอง (กฎ "เทสระเบิดเวลา" — รันรอบ +400 วันก็ต้องผ่าน) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CYCLE_BASIS, basisOf, runDaysOf, resolveRunDayDue, countsForCompliance,
  IDLE_STATUS, diffDays, runDayText, DEFAULT_MAX_IDLE_DAYS,
} from '../pmRunDay.js';

const TODAY = '2026-10-02';

test('basisOf — คอลัมน์ not null default ⇒ ค่าแปลก/ว่าง ต้องตกเป็น calendar ไม่ใช่ undefined', () => {
  assert.equal(basisOf(null), 'calendar');
  assert.equal(basisOf({}), 'calendar');
  assert.equal(basisOf({ cycle_basis: '' }), 'calendar');
  assert.equal(basisOf({ cycle_basis: 'เดา' }), 'calendar');
  assert.equal(basisOf({ cycle_basis: 'run_day' }), CYCLE_BASIS.RUN_DAY);
  assert.equal(basisOf({ cycle_basis: 'usage' }), CYCLE_BASIS.USAGE);
});

test('diffDays — ข้ามเดือน/ปี และวันเปลี่ยน DST ต้องได้จำนวนวันเต็ม', () => {
  assert.equal(diffDays('2026-10-01', '2026-10-02'), 1);
  assert.equal(diffDays('2026-09-30', '2026-10-02'), 2);
  assert.equal(diffDays('2025-12-31', '2026-01-01'), 1);
  assert.equal(diffDays('2026-10-02', '2026-10-02'), 0);
});

test('runDaysOf — กางครอบครัวไลน์ (เคสจริง PF-H101: ทะเบียนที่ HYDROFORM ใบผลิตที่ HDF1)', () => {
  const rows = [
    { line_name: 'HDF1', work_date: '2026-10-01', qty: 500 },
    { line_name: 'HDF2', work_date: '2026-10-01', qty: 300 },   // วันเดียวกัน ไม่นับซ้ำ
    { line_name: 'HDF1', work_date: '2026-09-29', qty: 100 },
    { line_name: 'TSRA-1', work_date: '2026-10-02', qty: 10 },  // คนละครอบครัว
  ];
  // เทียบชื่อตรงตัว = ไม่เจอเลย (บั๊กที่กับดักข้อ 2 เตือนไว้)
  assert.deepEqual(runDaysOf(rows, ['HYDROFORM']), []);
  // กางครอบครัวแล้วเจอ 2 วัน ไม่ซ้ำ เรียงจากน้อยไปมาก
  assert.deepEqual(runDaysOf(rows, ['HYDROFORM', 'HDF1', 'HDF2']), ['2026-09-29', '2026-10-01']);
});

test('runDaysOf — ชื่อไลน์ต่างตัวพิมพ์/เว้นวรรค ต้องนับเป็นไลน์เดียวกัน', () => {
  const rows = [{ line_name: ' hdf1 ', work_date: '2026-10-01', qty: 1 }];
  assert.deepEqual(runDaysOf(rows, ['HDF1']), ['2026-10-01']);
});

test('runDaysOf — ใบที่ปิดยอด 0 ยังนับว่า "เดิน" (เครื่องถูกเปิดใช้แล้ว)', () => {
  const rows = [{ line_name: 'HDF1', work_date: '2026-10-02', qty: 0, orders: 3 }];
  assert.deepEqual(runDaysOf(rows, ['HDF1']), ['2026-10-02']);
});

test('🔴 runDaysOf — ไม่ใช่ array (RPC ล่ม/ยังไม่โหลด) ต้องคืน null ห้ามคืน [] ', () => {
  assert.equal(runDaysOf(null, ['HDF1']), null);
  assert.equal(runDaysOf(undefined, ['HDF1']), null);
});

test('🔴 ไม่รู้ยอดผลิต = ถอยไปรอบปฏิทิน + ติดธง ห้ามเดาว่า "ไม่ได้ผลิต"', () => {
  const r = resolveRunDayDue({ intervalDays: 1, lastYmd: '2026-09-25', runDays: null, todayStr: TODAY });
  assert.equal(r.unknownUsage, true);
  assert.equal(r.status, 'overdue');          // 7 วันปฏิทิน > รอบ 1 วัน
  assert.equal(r.countsForKpi, true);         // ไม่รู้ = ยังต้องนับ ไม่ใช่ปล่อยผ่าน
  assert.match(runDayText(r), /ยังไม่รู้ยอดผลิต/);
});

test('ไม่ได้ผลิตวันนี้ = ไม่ต้องตรวจ (เทา) และไม่นับเข้า KPI', () => {
  const r = resolveRunDayDue({
    intervalDays: 1, lastYmd: '2026-09-20',
    runDays: ['2026-09-19', '2026-09-20'],    // ไม่มีวันไหนหลังวันตรวจ
    todayStr: TODAY, windowFromYmd: '2026-08-01',
  });
  assert.equal(r.status, IDLE_STATUS);
  assert.equal(r.countsForKpi, false);
  assert.equal(countsForCompliance(r.status), false);
  assert.equal(r.ranSince, 0);
  assert.equal(r.idleDays, 12);               // 20 ก.ย. → 2 ต.ค.
  assert.match(runDayText(r), /ไม่ได้ผลิต 12 วัน/);
});

test('เคสจริง RB-04 (TSRA-1 เดิน 4 วันใน 60) — ค้าง 56 วันปฏิทิน ต้องอ่านเป็น "ค้าง N วันเดิน"', () => {
  const runDays = ['2026-08-10', '2026-08-11', '2026-09-15', '2026-10-02'];
  const r = resolveRunDayDue({ intervalDays: 1, lastYmd: '2026-08-10', runDays, todayStr: TODAY });
  assert.equal(r.ranSince, 3);                // 11 ส.ค. · 15 ก.ย. · 2 ต.ค.
  assert.equal(r.status, 'overdue');
  assert.equal(r.overdueRunDays, 2);          // ไม่ใช่ 53 วันแบบปฏิทิน
  assert.equal(runDayText(r), 'ค้าง 2 วันเดินเครื่อง');
});

test('ตรวจแล้ววันนี้เดินด้วย แต่ยังไม่ครบรอบ = ตามกำหนด', () => {
  const r = resolveRunDayDue({
    intervalDays: 7, lastYmd: '2026-09-28',
    runDays: ['2026-09-29', '2026-10-02'], todayStr: TODAY,
  });
  assert.equal(r.ranSince, 2);
  assert.equal(r.ranToday, true);
  assert.equal(r.status, 'ok');
  assert.equal(runDayText(r), 'เดินมาแล้ว 2 วันตั้งแต่ตรวจล่าสุด');
});

test('เดินครบรอบพอดีวันนี้ = ถึงรอบตรวจวันนี้ (ยังไม่ใช่ค้าง)', () => {
  const r = resolveRunDayDue({
    intervalDays: 3, lastYmd: '2026-09-28',
    runDays: ['2026-09-29', '2026-09-30', '2026-10-02'], todayStr: TODAY,
  });
  assert.equal(r.ranSince, 3);
  assert.equal(r.overdueRunDays, 0);
  assert.equal(r.status, 'due_soon');
  assert.equal(runDayText(r), 'ถึงรอบตรวจวันนี้');
});

test('ครบรอบแล้วแต่วันนี้ไม่เดิน — ยังเป็นค้าง ไม่ถูกกลบด้วยสถานะเทา', () => {
  const r = resolveRunDayDue({
    intervalDays: 1, lastYmd: '2026-09-20',
    runDays: ['2026-09-25', '2026-09-26'], todayStr: TODAY,
  });
  assert.equal(r.ranToday, false);
  assert.equal(r.status, 'overdue');
  assert.equal(r.overdueRunDays, 1);
});

test('🔴 จอดนานเกินเพดาน แล้วกลับมาเดิน = ต้องตรวจก่อนเริ่ม แม้รอบยังไม่ครบ', () => {
  const r = resolveRunDayDue({
    intervalDays: 7, maxIdleDays: DEFAULT_MAX_IDLE_DAYS,
    lastYmd: '2026-06-01', runDays: ['2026-10-02'], todayStr: TODAY,
  });
  assert.equal(r.ranSince, 1);                 // รอบ 7 ยังไม่ครบ
  assert.equal(r.mustCheckBeforeRestart, true);
  assert.equal(r.status, 'due_soon');
  assert.match(runDayText(r), /ต้องตรวจก่อนเริ่ม/);
});

test('จอดนานแต่ "วันนี้ยังไม่เดิน" ต้องยังเป็นเทา — ห้ามเด้งค้างตั้งแต่ยังไม่กลับมาเดิน', () => {
  const r = resolveRunDayDue({
    intervalDays: 7, maxIdleDays: 30, lastYmd: '2026-06-01',
    runDays: ['2026-06-01'], todayStr: TODAY, windowFromYmd: '2026-05-01',
  });
  assert.equal(r.mustCheckBeforeRestart, true);
  assert.equal(r.status, IDLE_STATUS);
  assert.equal(r.countsForKpi, false);
});

test('ไม่เคยตรวจ + ไม่เคยเดิน = ยังไม่ถึงคิว (เทา) ไม่ใช่ค้างตั้งแต่เปิดระบบ', () => {
  const r = resolveRunDayDue({
    intervalDays: 1, lastYmd: null, runDays: [], todayStr: TODAY, windowFromYmd: '2026-06-04',
  });
  assert.equal(r.status, IDLE_STATUS);
  assert.equal(r.countsForKpi, false);
  assert.equal(r.idleAtLeast, true);
  assert.equal(r.idleDays, 120);
  assert.match(runDayText(r), /อย่างน้อย 120 วัน/);
});

test('ไม่เคยตรวจ แต่เดินมาแล้ว = "ยังไม่เคยตรวจ" และนับเข้า KPI', () => {
  const r = resolveRunDayDue({
    intervalDays: 1, lastYmd: null, runDays: ['2026-10-01', '2026-10-02'], todayStr: TODAY,
  });
  assert.equal(r.status, 'never');
  assert.equal(r.countsForKpi, true);
  assert.equal(runDayText(r), 'เดินมาแล้ว 2 วัน ยังไม่เคยตรวจ');
});

test('ยังไม่ตั้งรอบ = periodic · ไม่นับเข้า KPI · ไม่เดาวันครบกำหนด', () => {
  for (const iv of [null, 0, undefined, NaN]) {
    const r = resolveRunDayDue({ intervalDays: iv, runDays: [], todayStr: TODAY });
    assert.equal(r.status, 'periodic');
    assert.equal(r.countsForKpi, false);
    assert.equal(r.dueYmd, null);
  }
});

test('🔴 รอบ run_day ต้องไม่คืนวันครบกำหนดแบบปฏิทินเลย (จอต้องเขียนเป็นเงื่อนไข)', () => {
  const r = resolveRunDayDue({ intervalDays: 1, lastYmd: '2026-10-01', runDays: ['2026-10-02'], todayStr: TODAY });
  assert.equal(r.dueYmd, null);
});

test('วันเดินในอนาคต (ข้อมูลล่วงหน้า) ต้องไม่ถูกนับ', () => {
  const r = resolveRunDayDue({
    intervalDays: 1, lastYmd: '2026-10-01',
    runDays: ['2026-10-02', '2026-10-05'], todayStr: TODAY,
  });
  assert.equal(r.ranSince, 1);
  assert.equal(r.lastRunYmd, TODAY);
});

test('🔴 ถูกตรวจ "ระหว่างจอด" แล้ว = ไม่ต้องบังคับตรวจซ้ำตอนกลับมาเดิน', () => {
  const r = resolveRunDayDue({
    intervalDays: 7, maxIdleDays: 30,
    lastYmd: '2026-09-30',                    // ตรวจไปแล้วตอนเครื่องยังจอด
    runDays: ['2026-06-01', '2026-10-02'],    // จอดยาว มิ.ย. → ต.ค.
    todayStr: TODAY,
  });
  assert.equal(r.restartGapDays, 2);          // นับจากวันตรวจ ไม่ใช่วันเดินครั้งก่อน
  assert.equal(r.mustCheckBeforeRestart, false);
  assert.equal(r.status, 'ok');
});

test('เดินติดกันทุกวัน = ไม่มีช่วงจอด ⇒ ไม่เข้าเงื่อนไขตรวจก่อนเริ่มใหม่', () => {
  const r = resolveRunDayDue({
    intervalDays: 7, maxIdleDays: 30, lastYmd: '2026-09-30',
    runDays: ['2026-09-30', '2026-10-01', '2026-10-02'], todayStr: TODAY,
  });
  assert.equal(r.restartGapDays, 1);
  assert.equal(r.mustCheckBeforeRestart, false);
});

test('ไม่ตั้ง maxIdleDays = ไม่บังคับอะไรเลย (null/0 ต้องไม่กลายเป็นเพดาน 0 วัน)', () => {
  for (const m of [null, 0, undefined, '']) {
    const r = resolveRunDayDue({
      intervalDays: 7, maxIdleDays: m, lastYmd: '2026-01-01',
      runDays: ['2026-10-02'], todayStr: TODAY, windowFromYmd: '2026-06-04',
    });
    assert.equal(r.mustCheckBeforeRestart, false);
    assert.equal(r.status, 'ok');
  }
});
