import test from 'node:test';
import assert from 'node:assert/strict';
import { countDelta, toAdjustTxns, countSummary, lastCountAt, pendingShipCuts, STOCK_BASELINE_AT,
  isPhysicalCount, lastPhysicalCountAt, countRoundRows,
  pendingAdjustMap, splitPendingBlocked, pendingKey } from '../stockCount.js';

/* ─── countDelta — "นับได้เท่าไหร่" ไม่ใช่ "เพิ่ม/ลดเท่าไหร่" ─────────────── */
test('countDelta: ช่องว่าง = ยังไม่นับ ไม่ใช่ศูนย์', () => {
  assert.equal(countDelta(100, ''), null);
  assert.equal(countDelta(100, null), null);
  assert.equal(countDelta(100, undefined), null);
});

test('countDelta: นับได้ 0 จริง = ลดทั้งหมด (ต่างจากช่องว่าง)', () => {
  assert.deepEqual(countDelta(100, 0), { counted: 0, delta: -100, dir: 'down', qty: 100 });
  assert.deepEqual(countDelta(100, '0'), { counted: 0, delta: -100, dir: 'down', qty: 100 });
});

test('countDelta: ตรงกันอยู่แล้ว = ไม่ต้องเขียน ledger', () => {
  assert.equal(countDelta(250, 250), null);
  assert.equal(countDelta(0, 0), null);
});

test('countDelta: เพิ่ม/ลด คิดจากยอดระบบ', () => {
  assert.deepEqual(countDelta(100, 130), { counted: 130, delta: 30, dir: 'up', qty: 30 });
  assert.deepEqual(countDelta(100, 70),  { counted: 70, delta: -30, dir: 'down', qty: 30 });
});

test('countDelta: รับเลขที่มีลูกน้ำ (คนก๊อปจาก Excel)', () => {
  assert.deepEqual(countDelta(1000, '1,250'), { counted: 1250, delta: 250, dir: 'up', qty: 250 });
});

test('countDelta: ค่าที่ไม่ใช่ตัวเลข/ติดลบ = ไม่ทำอะไร ห้ามตีเป็น 0', () => {
  assert.equal(countDelta(100, 'abc'), null);
  assert.equal(countDelta(100, '-5'), null);
});

test('countDelta: ยอดระบบติดลบอยู่ (เคยส่งเกินที่รับเข้า) นับได้ 0 = ปรับขึ้นให้เป็น 0', () => {
  assert.deepEqual(countDelta(-80, 0), { counted: 0, delta: 80, dir: 'up', qty: 80 });
});

/* ─── toAdjustTxns ────────────────────────────────────────────────────────── */
const ROWS = [
  { mat_no: 'A1', part_name: 'ชิ้น A', qty_on_hand: 100 },
  { mat_no: 'B2', part_name: 'ชิ้น B', qty_on_hand: 50 },
  { mat_no: 'C3', part_name: 'ชิ้น C', qty_on_hand: 10 },
];

test('toAdjustTxns: เขียนเฉพาะแถวที่นับแล้วและต่างจากระบบ', () => {
  const tx = toAdjustTxns({ rows: ROWS, lineName: 'FG WAREHOUSE', workDate: '2026-09-23', by: 'ผู้นับ',
    counts: { A1: '120', B2: '50', C3: '' } });
  assert.equal(tx.length, 1);
  assert.equal(tx[0].mat_no, 'A1');
});

test('toAdjustTxns: ปรับลดต้องเก็บ qty ติดลบ (view บวก adjust ตรงๆ)', () => {
  const [tx] = toAdjustTxns({ rows: ROWS, lineName: 'L', workDate: '2026-09-23', counts: { B2: 20 } });
  assert.equal(tx.qty, -30);
  assert.equal(tx.type, 'adjust');
});

test('toAdjustTxns: note บอกที่มาของตัวเลขทั้งก่อน-หลัง (สอบกลับได้)', () => {
  const [tx] = toAdjustTxns({ rows: ROWS, lineName: 'L', workDate: '2026-09-23', counts: { A1: 120 }, note: 'รอบเดือน ก.ย.' });
  assert.match(tx.note, /ระบบ 100/);
  assert.match(tx.note, /นับได้ 120/);
  assert.match(tx.note, /รอบเดือน ก\.ย\./);
});

test('toAdjustTxns: ไม่กำหนด status เอง (ผู้เรียกตัดสินตามสิทธิ์ pending/approved)', () => {
  const [tx] = toAdjustTxns({ rows: ROWS, lineName: 'L', workDate: '2026-09-23', counts: { A1: 120 } });
  assert.equal('status' in tx, false);
});

/* ─── countSummary ────────────────────────────────────────────────────────── */
test('countSummary: แยก "นับแล้วตรง" ออกจาก "ยังไม่นับ" — จอต้องบอกได้ว่านับไปกี่ตัว', () => {
  const s = countSummary({ rows: ROWS, counts: { A1: 120, B2: 50, C3: '' } });
  assert.deepEqual(s, { counted: 2, same: 1, up: 1, down: 0, upQty: 20, downQty: 0, changed: 1 });
});

test('countSummary: รวมยอดเพิ่ม/ลดแยกกัน ห้ามหักกลบ', () => {
  const s = countSummary({ rows: ROWS, counts: { A1: 150, B2: 10 } });
  assert.equal(s.upQty, 50);
  assert.equal(s.downQty, 40);
  assert.equal(s.changed, 2);
});

/* ─── lastCountAt ─────────────────────────────────────────────────────────── */
test('lastCountAt: เอารอบล่าสุดต่อ คลัง+mat · นับเฉพาะ adjust ที่อนุมัติแล้ว', () => {
  const m = lastCountAt([
    { type: 'adjust', status: 'approved', line_name: 'FG', mat_no: 'A1', created_at: '2026-09-01T00:00:00Z' },
    { type: 'adjust', status: 'approved', line_name: 'FG', mat_no: 'A1', created_at: '2026-09-23T05:00:00Z' },
    { type: 'adjust', status: 'pending',  line_name: 'FG', mat_no: 'B2', created_at: '2026-09-23T05:00:00Z' },
    { type: 'consume', status: 'approved', line_name: 'FG', mat_no: 'C3', created_at: '2026-09-23T05:00:00Z' },
  ]);
  assert.equal(m['FG\u0000A1'], '2026-09-23T05:00:00Z');
  assert.equal(m['FG\u0000B2'], undefined, 'adjust ที่ยังไม่อนุมัติ ยังไม่มีผลต่อยอด = ปิดใบส่งไม่ได้');
  assert.equal(m['FG\u0000C3'], undefined, 'consume ไม่ใช่การตรวจนับ');
});

/* ─── pendingShipCuts — กฎเหล็ก: ห้ามหักย้อนข้ามรอบตรวจนับ ─────────────── */
const ORDERS = [
  { id: 'o1', mat_no: 'A1', qty: 100, shipped_at: '2026-08-20T03:00:00Z' },  // ก่อนรอบนับ
  { id: 'o2', mat_no: 'A1', qty: 200, shipped_at: '2026-09-23T09:00:00Z' },  // หลังรอบนับ
  { id: 'o3', mat_no: 'B2', qty: 50,  shipped_at: '2026-09-10T03:00:00Z' },  // ไม่เคยนับ
  { id: 'o4', mat_no: 'ZZ', qty: 10,  shipped_at: '2026-09-10T03:00:00Z' },  // จับคู่ SAP ไม่ได้
];
const COUNTED = { 'FG\u0000A1': '2026-09-23T05:00:00Z' };
const SAP_OF = (m) => (m === 'ZZ' ? null : m);

test('pendingShipCuts: ใบที่ส่งก่อนรอบตรวจนับ ถือว่าปิดแล้ว ห้ามหักซ้ำ', () => {
  const r = pendingShipCuts({ orders: ORDERS, cutIds: new Set(), counted: COUNTED, fgLine: 'FG', sapOf: SAP_OF, baselineAt: null });
  assert.deepEqual(r.closedByCount.map(x => x.id), ['o1']);
});

test('pendingShipCuts: ใบที่ส่งหลังรอบตรวจนับ ยังต้องหัก', () => {
  const r = pendingShipCuts({ orders: ORDERS, cutIds: new Set(), counted: COUNTED, fgLine: 'FG', sapOf: SAP_OF, baselineAt: null });
  assert.deepEqual(r.open.map(x => x.id).sort(), ['o2', 'o3']);
});

test('pendingShipCuts: จับคู่เลข SAP ไม่ได้ = แยกไว้ ห้ามเดาแล้วหักมั่ว', () => {
  const r = pendingShipCuts({ orders: ORDERS, cutIds: new Set(), counted: COUNTED, fgLine: 'FG', sapOf: SAP_OF, baselineAt: null });
  assert.deepEqual(r.unresolved.map(x => x.id), ['o4']);
  assert.equal(r.unresolved[0].sap, null);
});

test('pendingShipCuts: ใบที่หักไปแล้ว หายจากทุกกอง (idempotent)', () => {
  const r = pendingShipCuts({ orders: ORDERS, cutIds: new Set(['o1', 'o2', 'o3', 'o4']), counted: COUNTED, fgLine: 'FG', sapOf: SAP_OF, baselineAt: null });
  assert.equal(r.open.length + r.closedByCount.length + r.unresolved.length, 0);
});

test('pendingShipCuts: ไม่มี shipped_at ให้ถอยไปใช้ due_date สิ้นวัน (ใบเก่าก่อนมีคอลัมน์)', () => {
  const r = pendingShipCuts({
    orders: [{ id: 'x', mat_no: 'A1', qty: 5, shipped_at: null, due_date: '2026-08-01' }],
    cutIds: new Set(), counted: COUNTED, fgLine: 'FG', sapOf: SAP_OF,
  });
  assert.deepEqual(r.closedByCount.map(x => x.id), ['x']);
});

test('pendingShipCuts: คลังคนละตัวไม่ปิดให้กัน (นับ FG ไม่ปิดใบของ STORE)', () => {
  const r = pendingShipCuts({ orders: [ORDERS[0]], cutIds: new Set(), counted: COUNTED, fgLine: 'STORE', sapOf: SAP_OF, baselineAt: null });
  assert.deepEqual(r.open.map(x => x.id), ['o1']);
});

/* ─── เส้นตั้งต้นยอดทั้งระบบ 01/10 = รอบนับของทุก MAT (เคสจริง 07/10 FG ติดลบ −24,344) ─── */
test('pendingShipCuts: ใบที่ส่งก่อนวันล้างยอดทั้งระบบ ปิดหมด แม้ MAT นั้นไม่เคยมีแถวนับ', () => {
  const orders = [
    { id: 'old', mat_no: 'N1', qty: 112, due_date: '2026-08-27' },
    { id: 'new', mat_no: 'N1', qty: 70, shipped_at: '2026-10-05T03:00:00Z' },
  ];
  const r = pendingShipCuts({ orders, cutIds: new Set(), counted: {}, fgLine: 'FG' });
  assert.deepEqual(r.closedByCount.map(x => x.id), ['old']);
  assert.deepEqual(r.open.map(x => x.id), ['new']);
  assert.equal(STOCK_BASELINE_AT < '2026-10-02', true);
});

test('pendingShipCuts: รอบนับรายพาร์ทที่ใหม่กว่าเส้นตั้งต้น ยังเป็นตัวตัดสิน', () => {
  const orders = [{ id: 'a', mat_no: 'A1', qty: 5, shipped_at: '2026-10-06T03:00:00Z' }];
  const counted = { 'FG\u0000A1': '2026-10-08T00:00:00Z' };
  const r = pendingShipCuts({ orders, cutIds: new Set(), counted, fgLine: 'FG' });
  assert.deepEqual(r.closedByCount.map(x => x.id), ['a']);
});

/* ─── 🧭 ขั้น ② รอบนับตั้งต้น — "ปรับยอด" ไม่ใช่ "นับของจริง" ────────────────
   เคสจริงที่ทำให้ต้องมีด่านนี้: LINE D ติดลบ −100,212 เพราะ "ตั้งยอดให้ตรงไฟล์ Monitoring"
   ทับกันหลายรอบ ถ้าจอเอา adjust ทุกแบบมาตอบ "นับล่าสุด" จะบอกว่านับแล้ว = จอโกหก */

test('isPhysicalCount: เฉพาะ note "ตรวจนับ:" เท่านั้นที่แปลว่าคนไปนับของจริง', () => {
  const base = { type: 'adjust', status: 'approved' };
  assert.equal(isPhysicalCount({ ...base, note: 'ตรวจนับ: ระบบ 100 → นับได้ 80' }), true);
  assert.equal(isPhysicalCount({ ...base, note: 'ตั้งยอดให้ตรงไฟล์ Monitoring 300T' }), false);
  assert.equal(isPhysicalCount({ ...base, note: 'ตั้งต้นใหม่ 01/10 — ยอดเดิมเชื่อถือไม่ได้' }), false);
  assert.equal(isPhysicalCount({ ...base, note: 'แก้ย้อนหลัง 25/11: ใบขอเติม' }), false);
  assert.equal(isPhysicalCount({ ...base, note: 'ย้ายยอดรับเข้าล็อตไป STORE' }), false);
  assert.equal(isPhysicalCount({ ...base, note: null }), false);
  /* ใบที่ยังรออนุมัติยังไม่มีผลกับยอด ⇒ ยังไม่ถือว่านับแล้ว (กติกาเดียวกับ lastCountAt) */
  assert.equal(isPhysicalCount({ type: 'adjust', status: 'pending', note: 'ตรวจนับ: x' }), false);
  /* ขาเข้า/ขาออกปกติไม่ใช่การนับ */
  assert.equal(isPhysicalCount({ type: 'consume', status: 'approved', note: 'ตรวจนับ: x' }), false);
});

test('lastPhysicalCountAt: ไม่เอาวันที่ของการตั้งยอดตามไฟล์มาเคลมว่านับแล้ว', () => {
  const txns = [
    { line_name: 'L1', mat_no: 'A', type: 'adjust', status: 'approved', note: 'ตรวจนับ: ระบบ 5 → นับได้ 4', created_at: '2026-10-06T01:00:00Z' },
    { line_name: 'L1', mat_no: 'A', type: 'adjust', status: 'approved', note: 'ตั้งยอดให้ตรงไฟล์ Monitoring', created_at: '2026-11-03T01:00:00Z' },
  ];
  assert.deepEqual(lastPhysicalCountAt(txns), { 'L1\u0000A': '2026-10-06T01:00:00Z' });
  /* ตัวเก่ายังตอบ "วันล่าสุดของ adjust ทุกแบบ" เหมือนเดิม — คนละคำถาม ห้ามยุบ */
  assert.equal(lastCountAt(txns)['L1\u0000A'], '2026-11-03T01:00:00Z');
});

test('countRoundRows: อ่าน ledger ไม่ได้ = null ห้ามคืนลิสต์ว่าง', () => {
  assert.equal(countRoundRows({ stock: null, txns: [] }), null);
  assert.equal(countRoundRows({ stock: [], txns: null }), null);
  assert.deepEqual(countRoundRows({ stock: [], txns: [] }), []);
});

test('countRoundRows: นับพาร์ทที่ทะเบียนตั้งไว้แต่ยังไม่มีแถว ด้วย (ของควรอยู่ที่นี่)', () => {
  const r = countRoundRows({
    stock: [{ line_name: 'L1', mat_no: 'A', qty_on_hand: -20 }],
    txns: [],
    levels: [{ line_name: 'L1', mat_no: 'A' }, { line_name: 'L1', mat_no: 'B' }],
  });
  assert.equal(r.length, 1);
  assert.equal(r[0].parts, 2);          // A (มีแถว) + B (ทะเบียนตั้งไว้)
  assert.equal(r[0].noRowParts, 1);     // B นับไม่ได้ถ้าไม่เติมเข้าใบนับ
  assert.equal(r[0].negParts, 1);
  assert.equal(r[0].negQty, -20);
  assert.equal(r[0].status, 'none');    // ยังไม่เคยนับทั้ง 2 ตัว
});

test('countRoundRows: สถานะ none → partial → done ตามจำนวนพาร์ทที่ถูกนับ', () => {
  const stock = [
    { line_name: 'L1', mat_no: 'A', qty_on_hand: 10 },
    { line_name: 'L1', mat_no: 'B', qty_on_hand: 0 },
  ];
  const cnt = (mat, at) => ({ line_name: 'L1', mat_no: mat, type: 'adjust', status: 'approved',
    note: 'ตรวจนับ: ระบบ 1 → นับได้ 2', created_at: at });
  assert.equal(countRoundRows({ stock, txns: [] })[0].status, 'none');
  assert.equal(countRoundRows({ stock, txns: [cnt('A', '2026-11-20T00:00:00Z')] })[0].status, 'partial');
  const done = countRoundRows({ stock, txns: [cnt('A', '2026-11-20T00:00:00Z'), cnt('B', '2026-11-21T00:00:00Z')] })[0];
  assert.equal(done.status, 'done');
  assert.equal(done.counted, 2);
  assert.equal(done.never, 0);
  assert.equal(done.lastAt, '2026-11-21T00:00:00Z');   // วันล่าสุดของไลน์
  assert.equal(done.zeroParts, 1);
});

test('countRoundRows: driftAfter = คนมาปรับยอดหลังนับแล้ว (สัญญาณว่าการนับไม่อยู่)', () => {
  const stock = [{ line_name: 'L1', mat_no: 'A', qty_on_hand: 100 }];
  const txns = [
    { line_name: 'L1', mat_no: 'A', type: 'adjust', status: 'approved', qty: -5,
      note: 'ตรวจนับ: ระบบ 105 → นับได้ 100', created_at: '2026-11-10T00:00:00Z' },
    /* ก่อนรอบนับ = ไม่นับเป็น drift (ยอดที่นับสะท้อนไปแล้ว) */
    { line_name: 'L1', mat_no: 'A', type: 'adjust', status: 'approved', qty: -900,
      note: 'ตั้งยอดให้ตรงไฟล์ Monitoring', created_at: '2026-11-01T00:00:00Z' },
    /* หลังรอบนับ = drift จริง · ติดลบก็คิดเป็นขนาด */
    { line_name: 'L1', mat_no: 'A', type: 'adjust', status: 'approved', qty: -300,
      note: 'ตั้งยอดให้ตรงไฟล์ Monitoring', created_at: '2026-11-20T00:00:00Z' },
  ];
  const r = countRoundRows({ stock, txns })[0];
  assert.equal(r.driftAfter, 300);
  assert.equal(r.status, 'done');
});

test('countRoundRows: เรียงงานมากก่อน — ติดลบหนักสุดขึ้นก่อน', () => {
  const stock = [
    { line_name: 'เบา',  mat_no: 'A', qty_on_hand: -10 },
    { line_name: 'หนัก', mat_no: 'A', qty_on_hand: -9000 },
    { line_name: 'ปกติ', mat_no: 'A', qty_on_hand: 50 },
  ];
  assert.deepEqual(countRoundRows({ stock, txns: [] }).map(r => r.line_name), ['หนัก', 'เบา', 'ปกติ']);
});

/* ─── ⏳ กันนับซ้ำเมื่อมีใบค้างรออนุมัติ (25/11 · user "ต่างคนต่างนับ ต่างคนต่างอัพยอด จะมั่วไหม") ──
   view line_stock_summary = `where status='approved'` ⇒ ใบ pending ไม่อยู่ใน qty_on_hand
   คนที่ 2 จึงเห็นยอดเดิม แล้วเขียนผลต่างซ้ำ = ของหายสองเท่าเงียบๆ */

test('pendingAdjustMap: รวมใบ adjust ที่ยัง pending ต่อ (คลัง, mat) — ทุกชนิด ไม่ใช่เฉพาะใบตรวจนับ', () => {
  const m = pendingAdjustMap([
    { line_name: 'L1', mat_no: 'A', type: 'adjust', status: 'pending', qty: -220, created_by: 'สมชาย', created_at: '2026-11-25T01:00:00Z', note: 'ตรวจนับ: x' },
    { line_name: 'L1', mat_no: 'A', type: 'adjust', status: 'pending', qty: -30,  created_by: 'สมหญิง', created_at: '2026-11-25T03:00:00Z', note: 'ปรับยอดมือ' },
    { line_name: 'L1', mat_no: 'B', type: 'adjust', status: 'approved', qty: -99, created_at: '2026-11-25T01:00:00Z', note: 'ตรวจนับ: y' },
    { line_name: 'L1', mat_no: 'C', type: 'consume', status: 'pending', qty: 5, created_at: '2026-11-25T01:00:00Z' },
  ]);
  assert.equal(m[pendingKey('L1', 'A')].n, 2);
  assert.equal(m[pendingKey('L1', 'A')].qty, -250);
  assert.equal(m[pendingKey('L1', 'A')].by, 'สมหญิง');          // ใบล่าสุด
  assert.equal(m[pendingKey('L1', 'B')], undefined);            // อนุมัติแล้ว = อยู่ในยอดแล้ว ไม่ต้องกัน
  assert.equal(m[pendingKey('L1', 'C')], undefined);            // ไม่ใช่ adjust
});

test('splitPendingBlocked: คู่ที่มีใบค้างต้องถูกกันไว้ ห้ามทิ้งเงียบ', () => {
  const pend = pendingAdjustMap([
    { line_name: 'L1', mat_no: 'A', type: 'adjust', status: 'pending', qty: -220, created_at: '2026-11-25T01:00:00Z' },
  ]);
  const { ok, blocked } = splitPendingBlocked([
    { line_name: 'L1', mat_no: 'A', qty: -220 },
    { line_name: 'L1', mat_no: 'B', qty: 10 },
  ], pend);
  assert.deepEqual(ok.map(t => t.mat_no), ['B']);
  assert.deepEqual(blocked.map(t => t.mat_no), ['A']);
  assert.equal(blocked[0].pending.n, 1);                        // จอต้องบอกได้ว่าค้างกี่ใบ
});

test('splitPendingBlocked: ไม่มีใบค้าง = ผ่านทั้งหมด (พฤติกรรมเดิมเป๊ะ)', () => {
  const r = splitPendingBlocked([{ line_name: 'L1', mat_no: 'A' }], {});
  assert.equal(r.ok.length, 1);
  assert.equal(r.blocked.length, 0);
});
