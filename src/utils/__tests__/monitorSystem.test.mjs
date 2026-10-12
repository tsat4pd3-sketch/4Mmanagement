import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sumByMatDate, firstByMat, makeSystemLookup,
  onHandAtRef, outAtRef, fgAnchorBalance, makeAnchorLookup,
  OUT_TXN_TYPES, IN_ORDER_STATUS, orderInQty, DEMAND_SKIP_STATUS,
} from '../monitorSystem.js';

test('sumByMatDate — รวมยอดต่อ (พาร์ท, วัน)', () => {
  const m = sumByMatDate([
    { mat_no: 'A', work_date: '2026-10-01', qty: 100 },
    { mat_no: 'A', work_date: '2026-10-01', qty: 50 },
    { mat_no: 'A', work_date: '2026-10-02', qty: 20 },
    { mat_no: 'B', work_date: '2026-10-01', qty: 7 },
  ]);
  assert.equal(m.get('A|2026-10-01'), 150);
  assert.equal(m.get('A|2026-10-02'), 20);
  assert.equal(m.get('B|2026-10-01'), 7);
  assert.equal(m.get('C|2026-10-01'), undefined, 'ไม่มีข้อมูล = undefined ห้ามเป็น 0');
});

test('sumByMatDate — ตัดเวลาออกจาก timestamp · ตัดช่องว่างรอบเลข MAT', () => {
  const m = sumByMatDate([{ mat_no: ' A ', work_date: '2026-10-01T23:30:00+07:00', qty: 5 }]);
  assert.equal(m.get('A|2026-10-01'), 5);
});

test('sumByMatDate — แถวที่ขาดเลข/วัน/จำนวน ถูกข้าม ไม่ทำให้ยอดเพี้ยน', () => {
  const m = sumByMatDate([
    { mat_no: '', work_date: '2026-10-01', qty: 999 },
    { mat_no: 'A', work_date: null, qty: 999 },
    { mat_no: 'A', work_date: '2026-10-01', qty: null },
    { mat_no: 'A', work_date: '2026-10-01', qty: 'ไม่ใช่เลข' },
    { mat_no: 'A', work_date: '2026-10-01', qty: 10 },
  ]);
  assert.equal(m.get('A|2026-10-01'), 10);
  assert.equal(m.size, 1);
});

test('sumByMatDate — keep กรองชนิดธุรกรรมได้', () => {
  const rows = [
    { mat_no: 'A', work_date: '2026-10-01', qty: 100, type: 'consume' },
    { mat_no: 'A', work_date: '2026-10-01', qty: 700, type: 'issue' },
    { mat_no: 'A', work_date: '2026-10-01', qty: 5, type: 'adjust' },
  ];
  const m = sumByMatDate(rows, { keep: (r) => OUT_TXN_TYPES.includes(r.type) });
  assert.equal(m.get('A|2026-10-01'), 100, 'adjust/issue ต้องไม่ถูกนับเป็นของออก');
});

test('adjust ไม่อยู่ในชนิด "ของออก" (วัดจริง: ติดลบ 155/249 แถว ต่ำสุด −312,120)', () => {
  assert.deepEqual(OUT_TXN_TYPES, ['consume', 'return']);
  assert.ok(!OUT_TXN_TYPES.includes('adjust'));
  /* 🔴 12/10: issue = ของเข้า (ปิดล็อตลงที่ไลน์ผลิต) — เคยนับเป็นของออก ⇒ ยอดผลิตหักกลับเท่ากัน */
  assert.ok(!OUT_TXN_TYPES.includes('issue'));
});

test('IN_ORDER_STATUS — นับเฉพาะใบที่คอนเฟิร์มยอดแล้ว (ระบบไม่มีสถานะ closed)', () => {
  assert.deepEqual(IN_ORDER_STATUS, ['confirmed']);
  for (const s of ['imported', 'open', 'cancelled', 'carry_over', 'closed']) {
    assert.ok(!IN_ORDER_STATUS.includes(s), `${s} ต้องไม่ถูกนับเป็นของผลิตเข้า`);
  }
});

test('orderInQty — qty_ok ก่อน · ไม่มีค่อยใช้ qty_actual · ห้ามถอยไป qty (= เป้า)', () => {
  assert.equal(orderInQty({ qty_ok: 90, qty_actual: 100, qty: 120 }), 90);
  assert.equal(orderInQty({ qty_ok: null, qty_actual: 100, qty: 120 }), 100);
  assert.equal(orderInQty({ qty_ok: null, qty_actual: null, qty: 120 }), null,
    'รู้แค่เป้า = ไม่รู้ว่าผลิตได้เท่าไหร่ ⇒ null ห้ามตอบเท่าเป้า');
  assert.equal(orderInQty({ qty_ok: 0 }), 0, 'ผลิตได้ 0 จริง ≠ ไม่รู้');
});

test('firstByMat — ค่าเดียวต่อพาร์ท · ตัวแรกชนะ · ค่าว่างไม่เข้า', () => {
  const m = firstByMat([
    { mat_no: 'A', min_qty: 1800 },
    { mat_no: 'A', min_qty: 999 },
    { mat_no: 'B', min_qty: null },
  ]);
  assert.equal(m.get('A'), 1800);
  assert.equal(m.get('B'), undefined, 'ไม่ตั้ง min = ไม่แจ้ง (ห้ามเดา 0)');
});

/* ── ตัวเชื่อมเข้า buildGrid ──────────────────────────────────────────────────────── */
const partMat = new Map([['p1', 'A'], ['p2', 'B']]);

test('makeSystemLookup — IN/OUT ตามวัน · MIN ลงเฉพาะช่องยอดยกมา', () => {
  const look = makeSystemLookup({
    partMat,
    inIdx: sumByMatDate([{ mat_no: 'A', work_date: '2026-10-02', qty: 4800 }]),
    outIdx: sumByMatDate([{ mat_no: 'A', work_date: '2026-10-02', qty: 400 }]),
    minByMat: firstByMat([{ mat_no: 'A', min_qty: 1800 }]),
    seedKey: '2026-10-01',
  });
  assert.equal(look('p1', 'in', '2026-10-02'), 4800);
  assert.equal(look('p1', 'out', '2026-10-02'), 400);
  assert.equal(look('p1', 'min', '2026-10-01'), 1800, 'MIN อยู่ช่องยอดยกมา');
  assert.equal(look('p1', 'min', '2026-10-02'), undefined, 'ช่องอื่นปล่อยให้สูตร carry พาไปเอง');
});

test('makeSystemLookup — ไม่รู้ = undefined ทุกทาง (ห้ามคืน 0)', () => {
  const look = makeSystemLookup({ partMat, inIdx: new Map(), outIdx: new Map(), minByMat: new Map(), seedKey: 'x' });
  assert.equal(look('p1', 'in', '2026-10-02'), undefined);
  assert.equal(look('p9', 'in', '2026-10-02'), undefined, 'พาร์ทที่ไม่รู้เลข MAT');
  assert.equal(look('p1', 'plan', '2026-10-02'), undefined, 'แถวที่ระบบไม่รู้จัก');
});

test('makeSystemLookup — พาร์ทที่ไม่มีเลข MAT ไม่ไปหยิบของพาร์ทอื่น', () => {
  const look = makeSystemLookup({
    partMat: new Map([['p1', '']]),
    inIdx: sumByMatDate([{ mat_no: 'A', work_date: '2026-10-02', qty: 1 }]),
  });
  assert.equal(look('p1', 'in', '2026-10-02'), undefined);
});

test('makeSystemLookup — ไม่ส่งดัชนีมา = ไม่พัง คืน undefined', () => {
  const look = makeSystemLookup({ partMat });
  assert.equal(look('p1', 'in', '2026-10-02'), undefined);
  assert.equal(makeSystemLookup()('p1', 'in', 'x'), undefined);
});

/* ── บอร์ด FG: ยอดลูกค้าสั่งจาก EDI 862/830 (06/10) ─────────────────────────── */
test('makeSystemLookup — แถว order อ่านจาก orderIdx · ไม่รู้ = undefined ห้ามเป็น 0', () => {
  const sys = makeSystemLookup({
    partMat: new Map([['p1', '10101001'], ['p2', '10101002']]),
    orderIdx: new Map([['10101001|2026-10-06', 1200]]),
    seedKey: '2026-10-06',
  });
  assert.equal(sys('p1', 'order', '2026-10-06'), 1200);
  // พาร์ทที่ลูกค้าไม่ได้สั่งวันนั้น ≠ "สั่ง 0 ชิ้น"
  assert.equal(sys('p1', 'order', '2026-10-07'), undefined);
  assert.equal(sys('p2', 'order', '2026-10-06'), undefined);
  // ไม่ส่ง orderIdx มา = ไม่รู้ ไม่ใช่ 0
  assert.equal(makeSystemLookup({ partMat: new Map([['p1', 'A']]) })('p1', 'order', '2026-10-06'), undefined);
});

test('DEMAND_SKIP_STATUS — ยกเลิกแล้วไม่นับ · ส่งแล้วยังนับ (ของออกไปแล้วต้องหายจากสต๊อก)', () => {
  assert.ok(DEMAND_SKIP_STATUS.includes('cancelled'));
  assert.ok(!DEMAND_SKIP_STATUS.includes('shipped'));
  assert.ok(!DEMAND_SKIP_STATUS.includes('pending'));
  const idx = sumByMatDate(
    [
      { mat_no: 'A', due_date: '2026-10-06', qty: 100, status: 'pending' },
      { mat_no: 'A', due_date: '2026-10-06', qty: 50, status: 'shipped' },
      { mat_no: 'A', due_date: '2026-10-06', qty: 999, status: 'cancelled' },
    ],
    { date: 'due_date', keep: (r) => !DEMAND_SKIP_STATUS.includes(r.status) },
  );
  assert.equal(idx.get('A|2026-10-06'), 150);
});

/* ── 🔗 SSOT ยอดสต็อก (12/10) — บอร์ดต้องยึดยอดคงเหลือจาก ledger ไม่ใช่สูตรของตัวเอง ── */
const locOf = (m) => ({ A: 'STORE', B: 'LINE D', C: 'FG WAREHOUSE' })[m] || null;

test('onHandAtRef — เอาเฉพาะแถวของคลังอ้างอิง · ไม่มีแถว = ไม่ใส่ (ไม่รู้ ≠ 0)', () => {
  const m = onHandAtRef([
    { line_name: 'STORE', mat_no: 'A', qty_on_hand: '120' },
    { line_name: 'LINE C', mat_no: 'A', qty_on_hand: -500 },     // ยอดที่ไลน์อื่น ห้ามปน
    { line_name: 'LINE D', mat_no: 'B', qty_on_hand: 0 },
    { line_name: 'STORE', mat_no: 'Z', qty_on_hand: 9 },         // ไม่รู้คลังอ้างอิง
  ], locOf);
  assert.equal(m.get('A'), 120);
  assert.equal(m.get('B'), 0, 'มีแถวแต่ 0 = รู้ว่าไม่มีของ');
  assert.equal(m.has('C'), false, 'ไม่มีแถวในคลัง = ไม่รู้');
  assert.equal(m.has('Z'), false);
});

test('outAtRef — consume/return ที่คลังอ้างอิงเท่านั้น · issue ไม่ใช่ของออก · pending ไม่นับ', () => {
  const m = outAtRef([
    { line_name: 'STORE', mat_no: 'A', work_date: '2026-10-10', qty: 30, type: 'consume', status: 'approved' },
    { line_name: 'STORE', mat_no: 'A', work_date: '2026-10-10', qty: 5, type: 'return', status: 'approved' },
    { line_name: 'STORE', mat_no: 'A', work_date: '2026-10-10', qty: 500, type: 'issue', status: 'approved' },
    { line_name: 'LINE C', mat_no: 'A', work_date: '2026-10-10', qty: 700, type: 'consume', status: 'approved' },
    { line_name: 'STORE', mat_no: 'A', work_date: '2026-10-10', qty: 9, type: 'consume', status: 'pending' },
  ], locOf);
  assert.equal(m.get('A|2026-10-10'), 35);
});

test('fgAnchorBalance — คลังตอนนี้ − ค้างส่งถึงกำหนด + ส่งล่วงหน้าที่ยังไม่ถึงกำหนด', () => {
  const m = fgAnchorBalance({
    onHand: new Map([['C', 1000]]),
    today: '2026-10-12',
    orders: [
      { mat_no: 'C', qty: 100, due_date: '2026-10-05', status: 'pending' },   // ค้างส่ง → หัก
      { mat_no: 'C', qty: 200, due_date: '2026-10-12', status: 'pending' },   // ถึงกำหนดวันนี้ → หัก
      { mat_no: 'C', qty: 300, due_date: '2026-10-11', status: 'shipped' },   // ส่งแล้ว อยู่ในคลังที่หักไปแล้ว → ไม่แตะ
      { mat_no: 'C', qty: 50, due_date: '2026-10-20', status: 'shipped' },    // ส่งล่วงหน้า → บวกกลับ (คอลัมน์ 20/10 จะหักอีกรอบ)
      { mat_no: 'C', qty: 999, due_date: '2026-10-01', status: 'cancelled' },
      { mat_no: 'C', qty: 400, due_date: '2026-10-15', status: 'pending' },   // อนาคต → สูตรหักเอง
      { mat_no: 'X', qty: 10, due_date: '2026-10-01', status: 'pending' },    // ไม่รู้คลัง → ไม่สร้างค่า
    ],
  });
  assert.equal(m.get('C'), 1000 - 100 - 200 + 50);
  assert.equal(m.has('X'), false);
});

test('makeAnchorLookup — ยึดเฉพาะ BALANCE คอลัมน์วันนี้ · ไม่รู้ = undefined', () => {
  const look = makeAnchorLookup({ partMat: new Map([['p1', 'A'], ['p2', 'Q']]), balByMat: new Map([['A', 42]]), anchorKey: '2026-10-12' });
  assert.equal(look('p1', 'balance', '2026-10-12'), 42);
  assert.equal(look('p1', 'balance', '2026-10-13'), undefined);
  assert.equal(look('p1', 'in', '2026-10-12'), undefined);
  assert.equal(look('p2', 'balance', '2026-10-12'), undefined);
  assert.equal(makeAnchorLookup({})('p1', 'balance', 'x'), undefined);
});
