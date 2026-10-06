import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sumByMatDate, firstByMat, makeSystemLookup,
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
    { mat_no: 'A', work_date: '2026-10-01', qty: 100, type: 'issue' },
    { mat_no: 'A', work_date: '2026-10-01', qty: 5, type: 'adjust' },
  ];
  const m = sumByMatDate(rows, { keep: (r) => OUT_TXN_TYPES.includes(r.type) });
  assert.equal(m.get('A|2026-10-01'), 100, 'adjust ต้องไม่ถูกนับเป็นของออก');
});

test('adjust ไม่อยู่ในชนิด "ของออก" (วัดจริง: ติดลบ 155/249 แถว ต่ำสุด −312,120)', () => {
  assert.deepEqual(OUT_TXN_TYPES, ['issue', 'consume']);
  assert.ok(!OUT_TXN_TYPES.includes('adjust'));
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
