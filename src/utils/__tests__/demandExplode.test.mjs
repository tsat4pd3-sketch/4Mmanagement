/* ═══ เทสการระเบิดความต้องการลง BOM (แผนผลิตเห็นงานของไลน์ปั๊ม/เลเซอร์ด้วย) — 2026-09-22 ═══ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explodeDemand, explodeDemandByDate } from '../demandExplode.js';
import { buildBomIndex, explodeBom } from '../bomTree.js';

/* โครงตัวอย่างที่ล้อของจริง (10100335 · LINE C):
     FG 10100384 ── 20066660 ×1 ── 20066662 ×1 ── 50029976 ×0.450 KG
                 └─ 30042571 ×2 (ของซื้อ ใส่ที่ FG โดยตรง)
   product_id 'p-fg' = ใบ BOM ของ FG · 'p-mid' = ใบของ 20066660 */
const matOf = { 'p-fg': '10100384', 'p-mid': '20066660', 'p-mid2': '20066662' };
const ROWS = [
  { id: 1, product_id: 'p-fg', mat_no: '20066660', qty_per_unit: 1, uom: 'EA', item_no: 10 },
  { id: 2, product_id: 'p-fg', mat_no: '30042571', qty_per_unit: 2, uom: 'PC', item_no: 20 },
  { id: 3, product_id: 'p-mid', mat_no: '20066662', qty_per_unit: 1, uom: 'EA', item_no: 10 },
  { id: 4, product_id: 'p-mid2', mat_no: '50029976', qty_per_unit: 0.45, uom: 'KG', item_no: 10 },
];
const ix = () => buildBomIndex(ROWS, matOf);

test('ระเบิดหลายชั้น — จำนวนคูณสะสมตามชั้น (FG 100 ตัว)', () => {
  const { needByMat, rootsWithBom } = explodeDemand([{ mat_no: '10100384', qty: 100 }], ix(), explodeBom);
  assert.equal(rootsWithBom, 1);
  assert.equal(needByMat['20066660'].qty, 100);
  assert.equal(needByMat['20066662'].qty, 100);
  assert.equal(needByMat['30042571'].qty, 200);
  assert.equal(Math.round(needByMat['50029976'].qty * 100) / 100, 45);   // 100 × 1 × 1 × 0.45 KG
  assert.equal(needByMat['50029976'].uom, 'KG', 'หน่วยต้องติดมาด้วย (ห้ามเอา KG ไปหารกำลังต่อกะ)');
});

test('ความต้องการของ mat เดียวกันจากหลายใบ ต้องรวมกัน ไม่ใช่ทับกัน', () => {
  const { needByMat } = explodeDemand(
    [{ mat_no: '10100384', qty: 100 }, { mat_no: '10100384', qty: 50 }], ix(), explodeBom);
  assert.equal(needByMat['20066660'].qty, 150);
});

test('🔴 BOM แบนซ้ำ: หลานถูกใส่ที่ชั้น 1 ด้วย — ต่อโซ่แบบ SAP ต้องนับครั้งเดียว', () => {
  // เพิ่มแถวแบน: 50029976 โผล่ที่ชั้น 1 ของ FG ด้วย (ของจริงในฐานมีลักษณะนี้ 17 ตัวแม่)
  const flat = [...ROWS, { id: 9, product_id: 'p-fg', mat_no: '50029976', qty_per_unit: 0.45, uom: 'KG', item_no: 30 }];
  const ixFlat = buildBomIndex(flat, matOf);
  const chained = explodeDemand([{ mat_no: '10100384', qty: 100 }], ixFlat, explodeBom);
  assert.equal(Math.round(chained.needByMat['50029976'].qty * 100) / 100, 45, 'ต่อโซ่ = นับครั้งเดียว');
  assert.equal(chained.flatDupes.length, 1, 'ต้องรายงานเป็น worklist ให้คนไปแก้ข้อมูล');
  assert.equal(chained.flatDupes[0].mat_no, '50029976');
  assert.equal(chained.flatDupes[0].root, '10100384');

  // โหมดเทียบ (คง BOM แบน) = นับ 2 รอบ — มีไว้พิสูจน์ว่ากติกาต่างกันจริง ไม่ใช่ตัวเลือกใช้งาน
  const flatMode = explodeDemand([{ mat_no: '10100384', qty: 100 }], ixFlat, explodeBom, { chainMode: false });
  assert.equal(Math.round(flatMode.needByMat['50029976'].qty * 100) / 100, 90);
});

test('พาร์ทที่ไม่มี BOM ต้องถูกรายงาน ไม่ใช่หายเงียบ', () => {
  const { needByMat, rootsNoBom } = explodeDemand([{ mat_no: '99999999', qty: 10 }], ix(), explodeBom);
  assert.deepEqual(rootsNoBom, ['99999999']);
  assert.equal(Object.keys(needByMat).length, 0);
});

test('BOM วนลูป — ต้องไม่ค้าง และต้องรายงาน cycles ออกมา', () => {
  const loop = [
    { id: 1, product_id: 'p-a', mat_no: 'B', qty_per_unit: 1 },
    { id: 2, product_id: 'p-b', mat_no: 'A', qty_per_unit: 1 },
  ];
  const ixLoop = buildBomIndex(loop, { 'p-a': 'A', 'p-b': 'B' });
  const r = explodeDemand([{ mat_no: 'A', qty: 5 }], ixLoop, explodeBom);
  assert.ok(r.cycles.length > 0, 'ต้องบอกว่ามีวนลูป');
  assert.ok(Object.keys(r.needByMat).length < 50, 'ต้องไม่ระเบิดไม่รู้จบ');
});

test('หน่วยขัดกันระหว่างสองกิ่ง ต้องติดธงไว้ ไม่บวกมั่วเงียบ', () => {
  // X ถูกใช้ใน 2 กิ่งคนละใบ และหน่วยไม่ตรงกัน (คนละชั้น ไม่ใช่เคสแบนซ้ำ)
  const mixed = [
    { id: 1, product_id: 'p-fg', mat_no: '20066660', qty_per_unit: 1, uom: 'EA' },
    { id: 2, product_id: 'p-fg', mat_no: '20066662', qty_per_unit: 1, uom: 'EA' },
    { id: 3, product_id: 'p-mid', mat_no: 'X', qty_per_unit: 1, uom: 'PC' },
    { id: 4, product_id: 'p-mid2', mat_no: 'X', qty_per_unit: 1, uom: 'KG' },
  ];
  const r = explodeDemand([{ mat_no: '10100384', qty: 1 }], buildBomIndex(mixed, matOf), explodeBom);
  assert.equal(r.needByMat['X'].uomConflict, true);
  assert.equal(r.needByMat['X'].qty, 2, 'ยังบวกให้ แต่ต้องติดธงว่าหน่วยขัดกัน');
});

test('ข้อมูลไม่ครบ (ไม่มี ix / ไม่มีตัวระเบิด) ต้องคืนค่าว่าง ไม่โยน error', () => {
  assert.deepEqual(explodeDemand([{ mat_no: 'A', qty: 1 }], null, explodeBom).needByMat, {});
  assert.deepEqual(explodeDemand([{ mat_no: 'A', qty: 1 }], ix(), null).needByMat, {});
  assert.deepEqual(explodeDemand(null, ix(), explodeBom).needByMat, {});
});

test('qty ≤ 0 / mat ว่าง ต้องถูกข้าม', () => {
  const r = explodeDemand([{ mat_no: '10100384', qty: 0 }, { mat_no: '', qty: 10 }, { qty: 5 }], ix(), explodeBom);
  assert.equal(Object.keys(r.needByMat).length, 0);
});

/* ── รายวัน ─────────────────────────────────────────────────────────────── */
const addDays = (s, n) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(y, m - 1, d); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const explodeOne = (rows) => explodeDemand(rows, ix(), explodeBom).needByMat;

test('แตกความต้องการรายวัน — ของแต่ละวันแยกกัน และวันเดียวกันรวมกัน', () => {
  const out = explodeDemandByDate([
    { mat_no: '10100384', qty: 100, due_date: '2026-09-22' },
    { mat_no: '10100384', qty: 50, due_date: '2026-09-22' },
    { mat_no: '10100384', qty: 10, due_date: '2026-09-23' },
  ], explodeOne, 0, addDays);
  assert.equal(out['2026-09-22']['20066660'], 150);
  assert.equal(out['2026-09-23']['20066660'], 10);
});

test('offsetDays เลื่อนวันของลูกให้เร็วขึ้น (เผื่อวันหน้ามี lead time — เฟส 1 ใช้ 0)', () => {
  const out = explodeDemandByDate([{ mat_no: '10100384', qty: 10, due_date: '2026-09-22' }], explodeOne, 2, addDays);
  assert.ok(out['2026-09-20'], 'ต้องถูกวางไว้ก่อนดิวของแม่ 2 วัน');
  assert.equal(out['2026-09-22'], undefined);
});

test('แถวที่ไม่มีวันครบดิว ต้องถูกข้าม ไม่ทำให้ทั้งก้อนพัง', () => {
  const out = explodeDemandByDate([
    { mat_no: '10100384', qty: 10 },
    { mat_no: '10100384', qty: 5, due_date: '2026-09-22' },
  ], explodeOne, 0, addDays);
  assert.deepEqual(Object.keys(out), ['2026-09-22']);
  assert.equal(out['2026-09-22']['20066660'], 5);
});
