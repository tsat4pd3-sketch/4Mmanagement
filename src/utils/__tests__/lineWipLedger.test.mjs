import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLineWip, producedOf, TXN_SIGN, WIP_STATUS } from '../lineWipLedger.js';

/* FG "A" ใช้ลูก X 2 ชิ้น/ตัว · FG "B" ใช้ลูก X 1 + Y 3 */
const BOM = {
  A: [{ mat_no: 'X', qty_per_unit: 2 }],
  B: [{ mat_no: 'X', qty_per_unit: 1 }, { mat_no: 'Y', qty_per_unit: 3 }],
};
const bomOf = (m) => BOM[m] || [];
const tx = (mat, type, qty, work_date = '2026-09-01') => ({ mat_no: mat, type, qty, work_date });
const ord = (matNo, made, workDate = '2026-09-01') =>
  ({ matNo, qty: made, qtyOk: made, confirmed: true, workDate });
const pick = (r, mat) => r.parts.find(p => p.mat_no === mat);

test('producedOf — สูตรบังคับ: ปิดแล้วใช้ qty_ok · ยังเปิดใช้ qty_actual', () => {
  assert.equal(producedOf({ confirmed: true, qtyOk: 40, qty: 50 }), 40);
  assert.equal(producedOf({ confirmed: true, qty: 50 }), 50);            // ไม่มี qty_ok → qty
  assert.equal(producedOf({ confirmed: false, qty: 50, qtyActual: 12 }), 12);
  assert.equal(producedOf({ confirmed: false, qty: 50 }), 0);            // ยังไม่กรอกยอด = 0
});

test('🔴 ทิศของ txn ต้องตรงกับ view line_stock_summary เป๊ะ', () => {
  assert.deepEqual(TXN_SIGN, { issue: 1, adjust: 1, consume: -1, return: -1 });
});

test('สโตร์ส่งมา ยังไม่ได้ใช้ → ค้างเต็มจำนวน · สถานะ idle (ไม่ใช่ "ปกติ")', () => {
  const r = buildLineWip({ txns: [tx('X', 'issue', 500)], orders: [], bomOf });
  const x = pick(r, 'X');
  assert.equal(x.received, 500);
  assert.equal(x.usedCalc, 0);
  assert.equal(x.shouldRemain, 500);
  assert.equal(x.status, 'idle');
});

test('ส่งมา 500 · ผลิต A 100 ตัว (×2) → ใช้ 200 ค้าง 300', () => {
  const r = buildLineWip({ txns: [tx('X', 'issue', 500)], orders: [ord('A', 100)], bomOf });
  const x = pick(r, 'X');
  assert.equal(x.usedCalc, 200);
  assert.equal(x.shouldRemain, 300);
  assert.equal(x.status, 'ok');
  assert.deepEqual(x.fgSources, { A: 200 });
});

test('🔴 ไม่มีบันทึกรับเข้าเลยแต่ไลน์ใช้ไปแล้ว = never_issued ห้ามเป็น negative/ของหมด', () => {
  const r = buildLineWip({ txns: [], orders: [ord('A', 100)], bomOf });
  const x = pick(r, 'X');
  assert.equal(x.status, 'never_issued');   // ช่องว่างการลงข้อมูล ไม่ใช่ของขาด
  assert.equal(x.received, 0);
  assert.equal(x.shouldRemain, -200);       // ตัวเลขจริงยังต้องเห็น
  assert.equal(r.totals.neverIssued, 1);
});

test('🔴 ใช้เกินที่รับเข้า → ติดลบพร้อมสถานะ negative ห้ามปัดเป็น 0', () => {
  const r = buildLineWip({ txns: [tx('X', 'issue', 100)], orders: [ord('A', 100)], bomOf });
  const x = pick(r, 'X');
  assert.equal(x.shouldRemain, -100);
  assert.equal(x.status, 'negative');
  assert.equal(r.totals.negative, 1);
});

test('adjust / return เข้าทิศเดียวกับ view', () => {
  const r = buildLineWip({
    txns: [tx('X', 'issue', 500), tx('X', 'adjust', 20), tx('X', 'return', 30)],
    orders: [], bomOf,
  });
  const x = pick(r, 'X');
  assert.equal(x.received, 490);            // 500 + 20 − 30
  assert.equal(x.onHandLedger, 490);
});

test('🔴 gap = ที่ใช้จริง − consume ที่ ledger บันทึก (ยอดที่ backflush ยังไม่หัก)', () => {
  const r = buildLineWip({
    txns: [tx('X', 'issue', 500), tx('X', 'consume', 50)],
    orders: [ord('A', 100)], bomOf,                      // ใช้จริง 200
  });
  const x = pick(r, 'X');
  assert.equal(x.usedCalc, 200);
  assert.equal(x.outLedger, 50);
  assert.equal(x.gap, 150);                              // 150 ที่ยังไม่ถูกหักในระบบ
  assert.equal(x.onHandLedger, 450);                     // ยอดในระบบ (สูงกว่าจริง)
  assert.equal(x.shouldRemain, 300);                     // ยอดที่ควรเหลือจริง
  assert.equal(x.onHandLedger - x.shouldRemain, x.gap);  // ความสัมพันธ์ต้องตรงเสมอ
});

test('backflush ทำงานครบ → gap = 0 และยอดในระบบตรงกับที่ควรเหลือ', () => {
  const r = buildLineWip({
    txns: [tx('X', 'issue', 500), tx('X', 'consume', 200)],
    orders: [ord('A', 100)], bomOf,
  });
  const x = pick(r, 'X');
  assert.equal(x.gap, 0);
  assert.equal(x.onHandLedger, x.shouldRemain);
});

test('ช่วงที่เลือก — นับเฉพาะในช่วง แต่ยอดสะสมยังนับทั้งหมด', () => {
  const r = buildLineWip({
    txns: [tx('X', 'issue', 300, '2026-08-20'), tx('X', 'issue', 200, '2026-09-01')],
    orders: [ord('A', 50, '2026-08-20'), ord('A', 20, '2026-09-01')],
    bomOf, from: '2026-09-01', to: '2026-09-01',
  });
  const x = pick(r, 'X');
  assert.equal(x.inQty, 500);        // สะสม
  assert.equal(x.inPeriod, 200);     // ในช่วง
  assert.equal(x.usedCalc, 140);     // (50+20) × 2
  assert.equal(x.usedPeriod, 40);    // 20 × 2
});

test('หลาย FG กินลูกตัวเดียวกัน — รวมยอดและแยกที่มาได้', () => {
  const r = buildLineWip({
    txns: [tx('X', 'issue', 1000), tx('Y', 'issue', 1000)],
    orders: [ord('A', 100), ord('B', 50)], bomOf,
  });
  const x = pick(r, 'X');
  assert.equal(x.usedCalc, 250);                       // A 100×2 + B 50×1
  assert.deepEqual(x.fgSources, { A: 200, B: 50 });
  assert.equal(pick(r, 'Y').usedCalc, 150);            // B 50×3
});

test('🔴 BOM ซ้อนชั้น (ลูกถูกนับทั้งทางตรงและผ่านขั้นกลาง) ต้องติดธง ห้ามแก้ตัวเลขให้เอง', () => {
  // FG "C" มีลูก = ขั้นกลาง "M" และลูกจริง "X" · แต่ "M" ก็มี "X" เป็นลูกอีกที ⇒ X ถูกนับ 2 รอบ
  const chained = (m) => ({ C: [{ mat_no: 'M', qty_per_unit: 1 }, { mat_no: 'X', qty_per_unit: 2 }],
                            M: [{ mat_no: 'X', qty_per_unit: 2 }] }[m] || []);
  const r = buildLineWip({ txns: [tx('X', 'issue', 1000)], orders: [ord('C', 100)], bomOf: chained });
  assert.deepEqual(r.chainMats, ['X']);
  assert.equal(pick(r, 'X').chainWarn, true);
  assert.equal(pick(r, 'X').usedCalc, 200);   // ตัวเลขคงไว้ตามสูตร ไม่หักลบให้เอง
  assert.equal(pick(r, 'M').chainWarn, false);
  assert.equal(r.totals.chainWarn, 1);
});

test('เรียงลำดับ: ปัญหาขึ้นก่อน (ใช้เกิน → ไม่มีบันทึกรับเข้า → ปกติ → ยังไม่ใช้)', () => {
  const r = buildLineWip({
    txns: [tx('X', 'issue', 1000), tx('Y', 'issue', 100), tx('Z', 'issue', 50)],
    orders: [ord('A', 100), ord('B', 100)], bomOf,
  });
  // X: รับ 1000 ใช้ 300 = ok · Y: รับ 100 ใช้ 300 = negative · Z: ไม่ถูกใช้ = idle
  assert.deepEqual(r.parts.map(p => p.status), ['negative', 'ok', 'idle']);
});

test('totals — ยอดรวมต้องเท่ากับผลรวมรายแถว', () => {
  const r = buildLineWip({
    txns: [tx('X', 'issue', 500), tx('Y', 'issue', 400)],
    orders: [ord('A', 100), ord('B', 50)], bomOf,
  });
  assert.equal(r.totals.received, 900);
  assert.equal(r.totals.usedCalc, 400);        // X 250 + Y 150
  assert.equal(r.totals.shouldRemain, 500);
  assert.equal(r.totals.parts, 2);
});

test('แถวที่ไม่มีทั้งรับเข้าและการใช้ = ไม่มีข้อมูล ตัดทิ้ง (แต่ "รับเข้าแล้วยังไม่ใช้" ต้องอยู่)', () => {
  const r = buildLineWip({
    txns: [tx('X', 'issue', 500), tx('Q', 'issue', 0), { mat_no: 'W', type: 'อื่นๆ', qty: 9 }],
    orders: [], bomOf,
  });
  assert.deepEqual(r.parts.map(p => p.mat_no), ['X']);   // Q qty 0 · W type ไม่รู้จัก → ตัด
});

test('ทุกสถานะที่ util คืน ต้องมีนิยามใน WIP_STATUS (ไม่งั้นจอวาดไม่ออก)', () => {
  const r = buildLineWip({
    txns: [tx('X', 'issue', 100), tx('Z', 'issue', 10)],
    orders: [ord('A', 100), ord('B', 1)], bomOf,
  });
  r.parts.forEach(p => assert.ok(WIP_STATUS[p.status], `ไม่รู้จักสถานะ ${p.status}`));
});
