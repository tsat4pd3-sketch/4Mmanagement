import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflowDestOf, refStockOf, splitLevels, madeHereMats } from '../partRefStock.js';

const RULES = [
  { match_type: 'prefix', match_value: '1', dest_line_name: 'FG WAREHOUSE', is_active: true },
  { match_type: 'prefix', match_value: '2', dest_line_name: 'STORE', is_active: true },
  { match_type: 'mat', match_value: '20099999', dest_line_name: 'SUB APRON', is_active: true },
];
const PRODUCTS = [
  { mat_no: '10076603', line_name: 'LINE A ( 800 Ton )', is_active: true },
  { mat_no: '20059076', line_name: 'LINE A ( 800 Ton )', is_active: true },
  { mat_no: '20063136', line_name: 'LINE D ( 110&300 Ton )', is_active: true },
  { mat_no: '20099999', line_name: 'LINE A ( 800 Ton )', is_active: true },
  { mat_no: '20077777', line_name: 'LINE A ( 800 Ton )', is_active: true, is_operation: true },
];
const ctx = { lineName: 'LINE A ( 800 Ton )', products: PRODUCTS, rules: RULES };

test('กฎ MAT ชนะ prefix · ไม่มีกฎ = null', () => {
  assert.equal(inflowDestOf('10076603', RULES), 'FG WAREHOUSE');
  assert.equal(inflowDestOf('20099999', RULES), 'SUB APRON');
  assert.equal(inflowDestOf('50031625', RULES), null);
});

test('ไลน์ผลิตเอง → อ้างคลัง · ของที่ไลน์อื่นผลิต/ชั้น OP → อ้างหน้าไลน์เหมือนเดิม', () => {
  assert.deepEqual(refStockOf('10076603', ctx), { kind: 'produce', loc: 'FG WAREHOUSE' });
  assert.deepEqual(refStockOf('20059076', ctx), { kind: 'produce', loc: 'STORE' });
  assert.deepEqual(refStockOf('20063136', ctx), { kind: 'consume', loc: 'LINE A ( 800 Ton )' });
  assert.deepEqual(refStockOf('20077777', ctx), { kind: 'consume', loc: 'LINE A ( 800 Ton )' });
  assert.deepEqual(refStockOf('99999999', ctx), { kind: 'consume', loc: 'LINE A ( 800 Ton )' });
});

test('ของที่ผลิตเอง: ขั้นต่ำ/สูงสุดจาก Kanban ชุดเดียว (line_part_levels ไม่ถูกใช้) · ไม่มีใน Kanban = produceNoStd', () => {
  const stock = { 'FG WAREHOUSE|10076603': 1000, 'STORE|20059076': 4000 };
  const stds = new Map([
    ['10076603', { min_qty: 1200, max_qty: 2000 }],     // Kanban ต่างจาก line_part_levels (1700) → ใช้ Kanban
    ['20059076', { min_qty: 1500, max_qty: 3000 }],
    ['20099999', { min_qty: 400, max_qty: 800 }],
  ]);
  const r = splitLevels([
    { mat_no: '10076603', min_qty: 1700, max_qty: 1700 },
    { mat_no: '20063136', min_qty: 100 },
  ], { ...ctx, stds }, (loc, mat) => stock[`${loc}|${mat}`] ?? null);
  assert.deepEqual(r.produceDue.map(x => [x.mat_no, x.loc, x.have, x.min, x.suggestQty]), [['10076603', 'FG WAREHOUSE', 1000, 1200, 1000]]);
  assert.equal(r.produceOk, 1);
  assert.deepEqual(r.produceUnknown.map(x => [x.mat_no, x.loc]), [['20099999', 'SUB APRON']]);
  assert.deepEqual(r.produceNoStd, []);
  assert.deepEqual(r.consumeLevels.map(x => x.mat_no), ['20063136']);
  // ไม่มีใน Kanban → ไม่เดา ไม่ถอยไปใช้ line_part_levels
  const r2 = splitLevels([{ mat_no: '10076603', min_qty: 1700 }], { ...ctx, stds: new Map() }, () => 0);
  assert.equal(r2.produceDue.length, 0);
  assert.ok(r2.produceNoStd.some(x => x.mat_no === '10076603'));
});

test('madeHereMats ตัดชั้น OP / ไลน์อื่น', () => {
  assert.deepEqual(madeHereMats('LINE A ( 800 Ton )', PRODUCTS), ['10076603', '20059076', '20099999']);
});

/* 🔁 26/10 (คำสั่ง user) — พาร์ทโหมด 🔧 ปิดล็อต **เลิกเป็นข้อยกเว้น**
   เดิมอ้างยอดที่ชื่อไลน์ผลิต เพราะปุ่ม "รับของเข้าสโตร์" ลงสต็อกที่นั่น
   สโตร์แจ้งว่าปลายทางจริงคือสโตร์ ⇒ `advanceLot` ลงที่ `dest_line_name` ของกฎแล้ว
   ⇒ ที่นี่ต้องอ้างยอด "คลังปลายทาง" เหมือนพาร์ทผลิตเองตัวอื่นทุกประการ */
test('พาร์ทโหมดปิดล็อต อ้างยอดคลังปลายทางเหมือนของผลิตเองตัวอื่น (26/10)', () => {
  assert.deepEqual(refStockOf('20059076', ctx), { kind: 'produce', loc: 'STORE' });
  assert.deepEqual(refStockOf('20063136', ctx), { kind: 'consume', loc: 'LINE A ( 800 Ton )' });  // ไลน์อื่นผลิต = ไม่เกี่ยว
});

test('🔧 กฎโหมดปิดล็อต **ร่วมตัดสินคลังปลายทาง** — กฎ MAT ชนะ prefix (26/10 · เดิมถูกข้าม)', () => {
  const rules = [{ match_type: 'prefix', match_value: '2', dest_line_name: 'STORE' },
                 { match_type: 'mat', match_value: '20066660', dest_line_name: 'STORE X', mode: 'lot' }];
  assert.equal(inflowDestOf('20066660', rules), 'STORE X',
    'โหมดบอกแค่ "ยอดเข้าทางไหน" · dest_line_name บอก "เข้าคลังไหน" — คนละเรื่อง ห้ามเอามาปนกัน');
  assert.equal(inflowDestOf('20059999', rules), 'STORE', 'MAT อื่นยังถอยไปกฎ prefix เหมือนเดิม');
});
