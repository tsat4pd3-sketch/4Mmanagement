/*
  เทส KPI ของห้อง OBEYA (`src/utils/obeyaKpi.js`) — 2026-09-15

  สิ่งที่ล็อกไว้ (เรียงตามความเสี่ยงที่จะพังเงียบ):
  ① **ข้อมูลไม่พอ ต้องคืน state ไม่ใช่ 0** — กฎเหล็ก "จอที่ยืนยันสิ่งที่ไม่จริง แย่กว่าจอที่ว่าง"
     ถ้าใครมาแก้ให้คืน 0 แทน null จอ Obeya จะโกหกทั้งห้องประชุมโดยไม่มีใครรู้
  ② **ค่าเฉลี่ยต้องถ่วงน้ำหนัก** — กะเล็กห้ามมีน้ำหนักเท่ากะใหญ่ (mean-of-percentages คือบั๊กเก่าของโปรเจค)
  ③ **periodRange/prevRange ห้ามพึ่งนาฬิกาเครื่อง** — รับ `today` เข้ามาเสมอ
     (กฎ "เทสระเบิดเวลา" — รอบ +400 วันของ run-tests.mjs ต้องผ่านด้วย)
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  statusOf, statusWhy, statusLabel, gapToTarget, axisOee, axisSafety, axisQuality, axisDelivery, axisCost, axisMan,
  actionBuckets, actionHealth, periodRange, prevRange, addDays, fillDays, bucketBy,
} from '../obeyaKpi.js';

const S = (o) => ({ shift_min: 570, plannedMin: 0, oee: 80, oee_a: 90, oee_p: 90, oee_q: 99, actual_qty: 100, qty_ng: 0, work_date: '2026-09-01', ...o });

test('statusOf: ทิศทางที่ดีต่างกัน ผลต่างกัน + เหลืองคือพลาดไม่เกิน 5%', () => {
  assert.equal(statusOf(85, 80, 'up'), 'good');
  assert.equal(statusOf(77, 80, 'up'), 'warn');    // 80*0.95 = 76 → 77 ยังเหลือง
  assert.equal(statusOf(75, 80, 'up'), 'bad');
  assert.equal(statusOf(75, 80, 'down'), 'good');
  assert.equal(statusOf(83, 80, 'down'), 'warn');  // 80*1.05 = 84
  assert.equal(statusOf(90, 80, 'down'), 'bad');
});

test('statusOf: เป้า 0 (อุบัติเหตุ) ไม่มีแถบเหลือง — เกิน 0 คือแดงทันที', () => {
  assert.equal(statusOf(0, 0, 'down'), 'good');
  assert.equal(statusOf(1, 0, 'down'), 'bad');
});

test('statusOf: ไม่มีค่า/ไม่มีเป้า = none (ห้ามเดาว่าเขียว)', () => {
  assert.equal(statusOf(null, 80, 'up'), 'none');
  assert.equal(statusOf(80, null, 'up'), 'none');
  assert.equal(statusOf(NaN, 80, 'up'), 'none');
});

test('gapToTarget: บวก = ดีกว่าเป้าเสมอ ไม่ว่าทิศทางไหน', () => {
  assert.equal(gapToTarget(85, 80, 'up'), 5);
  assert.equal(gapToTarget(75, 80, 'up'), -5);
  assert.equal(gapToTarget(75, 80, 'down'), 5);    // ต้นทุนต่ำกว่าเป้า = ดี
  assert.equal(gapToTarget(90, 80, 'down'), -10);
});

test('axisOee: ถ่วงน้ำหนักด้วยเวลารับภาระ ไม่ใช่เฉลี่ยเปอร์เซ็นต์ตรงๆ', () => {
  // กะใหญ่ 570 นาที OEE 50 · กะจิ๋ว 30 นาที OEE 100 → เฉลี่ยธรรมดาได้ 75 (ผิด)
  const r = axisOee({ sessions: [S({ oee: 50 }), S({ oee: 100, shift_min: 30 })] });
  assert.ok(r.value < 60, `ถ่วงน้ำหนักแล้วต้องใกล้ 50 ไม่ใช่ 75 (ได้ ${r.value})`);
  assert.equal(r.state, 'ok');
  assert.equal(r.shifts, 2);
});

test('axisOee: ไม่มีกะปิด = value null + state none (ห้ามเป็น 0%)', () => {
  const r = axisOee({ sessions: [] });
  assert.equal(r.value, null);
  assert.equal(r.state, 'none');
  assert.ok(r.note);
});

test('axisSafety: นับเฉพาะคนที่มาทำงาน + ต้องติดธงว่ายังไม่มีทะเบียนอุบัติเหตุ', () => {
  const logs = [
    { work_date: '2026-09-01', is_present: true,  has_helmet: true,  has_boots: true, has_gloves: true },
    { work_date: '2026-09-01', is_present: true,  has_helmet: false, has_boots: true, has_gloves: true },
    { work_date: '2026-09-01', is_present: false, has_helmet: false, has_boots: false, has_gloves: false }, // ลา — ห้ามนับ
  ];
  const r = axisSafety({ logs });
  assert.equal(r.value, 50);              // 1 ใน 2 คนที่มา ไม่ใช่ 1 ใน 3
  assert.equal(r.state, 'thin');
  assert.equal(r.hasIncidentRegistry, false);
  assert.match(r.note, /ทะเบียนอุบัติเหตุ/);
});

test('axisQuality: บันทึกของเสียน้อยผิดปกติ ต้องกำกับว่าอ่านแล้วอย่าเพิ่งเชื่อ', () => {
  const thin = axisQuality({ sessions: [S({ oee_q: 99.5 })], defects: [] });
  assert.equal(thin.state, 'thin');
  assert.match(thin.note, /ไม่ครบ/);
  const many = axisQuality({ sessions: [S({ oee_q: 99.5 })], defects: Array.from({ length: 500 }, () => ({ qty_ng: 1 })) });
  assert.equal(many.state, 'ok');
  assert.equal(many.note, null);
  assert.equal(many.ngQty, 500);
});

test('axisDelivery: ไม่มีเป้าในใบงาน = คิดไม่ได้ (null) ไม่ใช่ 0%', () => {
  assert.equal(axisDelivery({ target: 0, produced: 0 }).value, null);
  assert.equal(axisDelivery({ target: 0, produced: 0 }).state, 'none');
  assert.equal(axisDelivery({ target: 1000, produced: 950 }).value, 95);
});

test('axisCost: ขาดอัตราค่าแรง/ต้นทุน = ต้องบอก ห้ามแสดง 0 บาทเหมือนไม่เสียอะไร', () => {
  const miss = axisCost({ dtBaht: 0, ngBaht: 0, missingRate: 3 });
  assert.equal(miss.value, null);
  assert.equal(miss.state, 'thin');
  assert.match(miss.note, /อัตราค่าแรง/);
  const ok = axisCost({ dtBaht: 1200.4, ngBaht: 300.6 });
  assert.equal(ok.value, 1501);
  assert.equal(ok.better, 'down');
});

test('axisMan: อัตรามาทำงาน + แยกจำนวนมา/ขาด', () => {
  const logs = [
    { work_date: '2026-09-01', is_present: true },
    { work_date: '2026-09-01', is_present: true },
    { work_date: '2026-09-02', is_present: false },
  ];
  const r = axisMan({ logs });
  assert.equal(r.value, 66.7);
  assert.equal(r.present, 2);
  assert.equal(r.absent, 1);
  assert.equal(r.series.length, 2);
  assert.equal(r.series[0].v, 100);
  assert.equal(r.series[1].v, 0);
});

test('actionBuckets: "เกินกำหนด" คำนวณจาก due_date เทียบวันนี้ ไม่ใช่ status ดิบ', () => {
  const items = [
    { id: 1, status: 'open',  due_date: '2026-09-10' },   // เลยมาแล้ว
    { id: 2, status: 'doing', due_date: '2026-09-16' },   // ใกล้ครบ (ภายใน 2 วัน)
    { id: 3, status: 'open',  due_date: '2026-09-30' },
    { id: 4, status: 'done',  due_date: '2026-09-01' },
    { id: 5, status: 'cancelled', due_date: null },
  ];
  const b = actionBuckets(items, '2026-09-15');
  assert.deepEqual(b.overdue.map(x => x.id), [1]);
  assert.deepEqual(b.dueSoon.map(x => x.id), [2]);
  assert.deepEqual(b.open.map(x => x.id), [3]);
  assert.deepEqual(b.done.map(x => x.id), [4]);
});

test('actionHealth: 0 ใบ = empty (ไม่ใช่ "ไม่มีปัญหา") · closeRate ไม่นับใบที่ยกเลิก', () => {
  const none = actionHealth([], '2026-09-15');
  assert.equal(none.empty, true);
  assert.equal(none.closeRate, null);
  const h = actionHealth([
    { status: 'done' }, { status: 'done' }, { status: 'open', due_date: '2026-09-30' },
    { status: 'cancelled' },
  ], '2026-09-15');
  assert.equal(h.empty, false);
  assert.equal(h.closeRate, 66.7);
  assert.equal(h.liveCount, 1);
});

test('periodRange/prevRange: ตรึงวันที่ได้ ไม่พึ่งนาฬิกาเครื่อง (กันเทสระเบิดเวลา)', () => {
  assert.deepEqual(periodRange('day', '2026-09-15'), { from: '2026-09-15', to: '2026-09-15' });
  // 15/09/2026 = วันอังคาร → ต้นสัปดาห์คือจันทร์ 14
  assert.deepEqual(periodRange('week', '2026-09-15'), { from: '2026-09-14', to: '2026-09-15' });
  assert.deepEqual(periodRange('month', '2026-09-15'), { from: '2026-09-01', to: '2026-09-15' });
  assert.deepEqual(prevRange('day', '2026-09-15'), { from: '2026-09-14', to: '2026-09-14' });
  assert.deepEqual(prevRange('week', '2026-09-15'), { from: '2026-09-07', to: '2026-09-08' });
  assert.deepEqual(prevRange('month', '2026-09-15'), { from: '2026-08-01', to: '2026-08-15' });
  // สิ้นเดือนสั้นกว่า — 31/03 → ก.พ. ต้องหยุดที่ 28/29 ไม่ใช่วันที่ไม่มีจริง
  assert.equal(prevRange('month', '2026-03-31').to, '2026-02-28');
});

test('addDays / fillDays: ข้ามเดือนได้ + เติมวันที่ว่างให้ครบช่วง', () => {
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  const s = fillDays([{ k: '2026-09-03', v: 5 }], '2026-09-01', '2026-09-04');
  assert.equal(s.length, 4);
  assert.equal(s[2].v, 5);
  assert.equal(s[0].empty, true);
});

test('bucketBy: ทิ้งคีย์ว่าง + เรียงตามคีย์เสมอ', () => {
  const b = bucketBy(
    [{ d: '2026-09-02', n: 1 }, { d: '2026-09-01', n: 2 }, { d: null, n: 9 }],
    r => r.d, (a, r) => { a.sum += r.n; }, () => ({ sum: 0 }),
  );
  assert.deepEqual(b.map(x => x.k), ['2026-09-01', '2026-09-02']);
  assert.equal(b[0].sum, 2);
});

/* ── ไฟสถานะบนจอมอนิเตอร์ (2026-09-21) ────────────────────────────────────────────
   สิ่งที่ล็อก: **เทาต้องแยกได้ว่า "ยังไม่มีข้อมูล" หรือ "ไม่มีเป้า"**
   ถ้าใครมาย่อให้เหลือคำเดียว จอจะบอกไม่ได้ว่าที่ไม่ตัดสินเพราะงานยังไม่เกิด หรือเพราะไม่มีใครตั้งเป้า
   — ซึ่งเป็นคนละเรื่องกันสิ้นเชิงเวลายืนดูหน้าบอร์ด (อันแรกรอ อันหลังต้องไปตั้งเป้า) */
test('statusWhy: เทา 2 แบบต้องพูดคนละอย่าง + ต้องไม่เผลอเป็นเขียว', () => {
  const noData = statusWhy(null, 95, 'up', '%');
  assert.equal(noData.status, 'none');
  assert.match(noData.label, /ยังไม่มีข้อมูล/);

  const noTarget = statusWhy(83.3, null, 'up', '%');
  assert.equal(noTarget.status, 'none');
  assert.match(noTarget.label, /ไม่มีเป้า/);
  assert.notEqual(noTarget.label, noData.label, 'เทา 2 แบบห้ามใช้คำเดียวกัน');
  assert.match(noTarget.why, /83\.3 %/, 'มีค่าแล้วแต่ไม่มีเป้า — ต้องบอกค่าที่มีด้วย');

  // ค่าเป็น 0 คือ "มีข้อมูลและเป็นศูนย์" ไม่ใช่ "ยังไม่มีข้อมูล" (0 เป็น falsy — เคยพลาดคลาสนี้ประจำ)
  assert.equal(statusWhy(0, 0, 'down').status, 'good');
  assert.equal(statusWhy(0, 95, 'up').status, 'bad');
});

test('statusWhy: สีตรงกับ statusOf เสมอ และบอกระยะห่างเป้าถูกทิศ', () => {
  for (const [v, t, dir] of [[86, 85, 'up'], [84, 85, 'up'], [50, 85, 'up'], [3, 5, 'down'], [8, 5, 'down']]) {
    assert.equal(statusWhy(v, t, dir).status, statusOf(v, t, dir), `${v}/${t}/${dir}`);
  }
  assert.match(statusWhy(83.3, 95, 'up', '%').why, /ห่างเป้าอีก 11\.7/);
  assert.match(statusWhy(100, 95, 'up', '%').why, /ดีกว่าเป้า 5/);
  // ยิ่งน้อยยิ่งดี: ค่าต่ำกว่าเป้า = ดีกว่าเป้า (ห้ามอ่านกลับด้าน)
  assert.match(statusWhy(3, 5, 'down', 'ครั้ง').why, /ดีกว่าเป้า 2/);
});

test('statusLabel: ครบ 4 ระดับ และค่าแปลกๆ ตกเป็น "ตัดสินไม่ได้" ไม่ใช่เขียว', () => {
  assert.equal(statusLabel('good'), 'ตามเป้า');
  assert.equal(statusLabel('warn'), 'เฉียดเป้า');
  assert.equal(statusLabel('bad'), 'หลุดเป้า');
  assert.equal(statusLabel(undefined), 'ตัดสินไม่ได้');
  assert.equal(statusLabel('อะไรไม่รู้'), 'ตัดสินไม่ได้');
});
