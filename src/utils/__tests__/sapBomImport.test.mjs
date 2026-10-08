import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSapBom, diffSapBom, missingInPartsMaster, sapDepth, sapNum, decodeSapExport, sniffLevelCol } from '../sapBomImport.js';

/* ตัวอย่างย่อจากไฟล์จริงที่ user ส่ง (01/10 · SUPT ASY RAD (FVL) 10101158)
   เว้นคอลัมน์ให้ตรงหัวจริง: ""·Plnt·SPT·Item·Level·""·Obj·desc·Qty·Un·CostRel·MS·SLoc·SLoc·Change·By·On·B */
const H = '\tPlnt\tSPT\tItem\tLevel\t\tObj\tObject description\tQuantity\tUn\tCostRel\tMS\tSLoc\tSLoc\tChange No.\tBy\tChanged on\tB';
const row = (item, lvl, mat, desc, qty, un, s1, s2) =>
  `\t2140\t\t${item}\t${lvl}\t\t${mat}\t${desc}\t${qty}\t${un}\tX\tZ2\t${s1}\t${s2}\t500000000034\tS214PN02\t28.02.2025\t`;
const FILE = [
  '01.10.2026\tDynamic List Display\t1', '',
  'Material\t\t\t\t\t10101158',
  'Plant/Usage/Alt.\t\t\t\t\t2140 / 1 / 01',
  'Description\t\t\t\t\tSUPT ASY RAD (FVL)',
  'Base Qty      (PC )\t\t\t\t\t1.000', '', H, '',
  row('0010', '.1',      '20067121', 'PACK SUPT ASY RAD-FVL', '  1.000', 'PC', '',     'S402'),
  row('0010', '..2',     '20071518', 'SUPT ASY RAD ก่อนแพ็ค',  '  1.000', 'PC', 'S410', ''),
  row('0010', '...3',    '20058495', 'SUPT ASY RAD หลังชุบ',   '  1.000', 'PC', '',     'S405'),
  row('0010', '....4',   '20058498', 'SUPT ASY RAD ก่อนชุบ',   '  1.000', 'PC', 'S403', ''),
  row('0010', '.....5',  '30044771', 'NUT WELD 6MM',          '  5.000', 'PC', '',     'P410'),
  row('0060', '.....5',  '20058483', 'PLT FRT S/M INR RH',    '  1.000', 'PC', 'S406', 'P410'),
  row('0010', '......6', '50027080', 'WSS-M1A365-A13 COIL',   '  0.038', 'KG', 'P405', ''),
  row('0070', '.....5',  '20058484', 'PLT FRT S/M INR LH',    '  1.000', 'PC', 'S406', 'P410'),
].join('\r\n');

test('แกะหัวใบ + จำนวนแถว + ไม่มี warning', () => {
  const r = parseSapBom(FILE);
  assert.equal(r.layout, 'multilevel');
  assert.equal(r.root.mat_no, '10101158');
  assert.equal(r.root.description, 'SUPT ASY RAD (FVL)');
  assert.equal(r.root.plant, '2140');
  assert.equal(r.rows.length, 8);
  assert.deepEqual(r.warnings, []);
});

test('🔴 ชั้นจากจุดนำหน้า → parent_mat (แถวก่อนหน้าที่ลึกน้อยกว่า 1)', () => {
  const by = Object.fromEntries(parseSapBom(FILE).rows.map(r => [r.mat_no, r]));
  assert.equal(by['20067121'].parent_mat, null);          // ชั้น 1 = ลูกของหัวใบ
  assert.equal(by['20067121'].depth, 1);
  assert.equal(by['20071518'].parent_mat, '20067121');
  assert.equal(by['20058498'].parent_mat, '20058495');
  assert.equal(by['30044771'].parent_mat, '20058498');
  assert.equal(by['50027080'].parent_mat, '20058483');    // ชั้น 6 เกาะ 20058483 ไม่ใช่ 20058498
});

test('🔴 stack ต้องตัดลูกของพี่คนก่อนทิ้ง — ไม่งั้นแถวถัดไปเกาะผิดตัว', () => {
  const by = Object.fromEntries(parseSapBom(FILE).rows.map(r => [r.mat_no, r]));
  // 20058484 (ชั้น 5) มาหลัง 50027080 (ชั้น 6) ⇒ ต้องกลับไปเกาะ 20058498 ไม่ใช่ค้างที่ชั้นลึก
  assert.equal(by['20058484'].parent_mat, '20058498');
});

test('🔴 Quantity ของ SAP = ต่อ 1 ตัวแม่ — เก็บตรงๆ ห้ามคูณสะสม', () => {
  const by = Object.fromEntries(parseSapBom(FILE).rows.map(r => [r.mat_no, r]));
  assert.equal(by['30044771'].qty_per_unit, 5);     // 5 ตัวต่อ 1 ชิ้นของ 20058498
  assert.equal(by['50027080'].qty_per_unit, 0.038); // KG ทศนิยมต้องไม่ถูกปัด
  assert.equal(by['50027080'].uom, 'KG');
});

test('🔴 SLoc 2 ช่องแยกกัน (Prod.SLoc ≠ Stor.Loc) ห้ามยุบเป็นช่องเดียว', () => {
  const by = Object.fromEntries(parseSapBom(FILE).rows.map(r => [r.mat_no, r]));
  assert.equal(by['20058483'].prod_sloc, 'S406');
  assert.equal(by['20058483'].storage_location, 'P410');
  assert.equal(by['30044771'].prod_sloc, null);       // ว่าง = null ไม่ใช่ ''
  assert.equal(by['30044771'].storage_location, 'P410');
});

test('ITEM เก็บเป็นเลข (0060 → 60) ไม่ใช่ string ที่มี 0 นำ', () => {
  const by = Object.fromEntries(parseSapBom(FILE).rows.map(r => [r.mat_no, r]));
  assert.equal(by['20058483'].item_no, 60);
});

test('ไฟล์ที่ไม่ใช่ BOM = คืน warning ไม่ throw', () => {
  const r = parseSapBom('อะไรก็ไม่รู้\nบรรทัดสอง');
  assert.equal(r.rows.length, 0);
  assert.match(r.warnings[0], /หาแถวหัวตาราง/);
});

test('decodeSapExport อ่าน UTF-16LE ที่มี BOM ได้ (ไฟล์ SAP จริงเป็นแบบนี้)', () => {
  const s = 'Material\t10101158';
  const u16 = new Uint8Array(2 + s.length * 2);
  u16[0] = 0xff; u16[1] = 0xfe;
  for (let i = 0; i < s.length; i++) { u16[2 + i * 2] = s.charCodeAt(i) & 0xff; u16[3 + i * 2] = s.charCodeAt(i) >> 8; }
  assert.equal(decodeSapExport(u16.buffer), s);
});

test('sapNum / sapDepth — ว่างต้องเป็น null ไม่ใช่ 0', () => {
  assert.equal(sapNum('  1.000'), 1);
  assert.equal(sapNum('1,234.5'), 1234.5);
  assert.equal(sapNum(''), null);
  assert.equal(sapNum('—'), null);
  assert.equal(sapDepth('.....5'), 5);
  assert.equal(sapDepth('5'), 5);
  assert.equal(sapDepth(''), null);
});

test('diffSapBom — แยก เพิ่ม/แก้/เหมือนเดิม ด้วยคีย์ (ตัวแม่, mat)', () => {
  const sap = parseSapBom(FILE).rows;
  const existing = [
    { id: 'a', parent_mat: null,       mat_no: '20067121', qty_per_unit: 1, uom: 'PC', item_no: 10, storage_location: 'S402' },
    { id: 'b', parent_mat: '20058498', mat_no: '30044771', qty_per_unit: 1, uom: 'EA', item_no: 50, storage_location: null },
    { id: 'c', parent_mat: null,       mat_no: '99999999', qty_per_unit: 1, uom: 'PC', item_no: 99, storage_location: null },
  ];
  const d = diffSapBom(sap, existing);
  assert.equal(d.same.length, 1);                       // 20067121 ตรงทุกช่อง
  assert.equal(d.update.length, 1);                     // 30044771 จำนวน/หน่วย/คลัง ต่าง
  assert.equal(d.update[0].mat_no, '30044771');
  assert.equal(d.update[0].id, 'b');
  assert.equal(d.update[0].diffs.length, 4);            // จำนวน · หน่วย · ITEM · คลัง
  assert.equal(d.add.length, 6);
  assert.deepEqual(d.extra.map(r => r.mat_no), ['99999999']);
});

test('🔴 extra = ของที่ ESM มีแต่ SAP ไม่มี — ชั้น OP ต้องไม่ถูกฟ้อง (หน้างานเพิ่มเอง)', () => {
  const existing = [{ id: 'z', parent_mat: null, mat_no: 'BENDING LWR BAR 306', qty_per_unit: 1, uom: 'PC' }];
  const d = diffSapBom(parseSapBom(FILE).rows, existing, { isOpMat: (m) => m === 'BENDING LWR BAR 306' });
  assert.deepEqual(d.extra, []);
});

test('missingInPartsMaster — ไม่ซ้ำ + ใช้ชื่อ/หน่วยจาก SAP', () => {
  const sap = parseSapBom(FILE).rows;
  const miss = missingInPartsMaster(sap, ['20067121', '20071518']);
  assert.equal(miss.length, 6);
  assert.equal(miss.filter(m => m.mat_no === '50027080').length, 1);   // โผล่ 1 ครั้งทั้งที่ไฟล์มี 1 แถว
  assert.equal(miss.find(m => m.mat_no === '50027080').uom, 'KG');
});

/* ── เคสจริง 01/10: ใบ 10105769 เข้าไม่ได้ ──────────────────────────────────────────
   อาการ: ทุกแถวขึ้น "อ่านชั้นไม่ออก — ตั้งเป็นชั้น 1" แล้วชน
   `duplicate key ... bom_items_product_item_uniq` เพราะ ITEM ซ้ำกันเมื่อแบนเป็นชั้นเดียว */

test('🔴 หัวคอลัมน์ถูกย่อ (Lev) ต้องยังอ่านชั้นได้ — ห้ามแบนทั้งใบ', () => {
  const r = parseSapBom(FILE.replace('\tLevel\t', '\tLev\t'));
  assert.equal(r.rows.length, 8);
  assert.equal(Math.max(...r.rows.map(x => x.depth)), 6);
  assert.equal(r.rows.find(x => x.mat_no === '50027080').parent_mat, '20058483');
});

test('🔴 ไฟล์ที่ผ่าน Excel มา (.1 กลายเป็น 0.1) ต้องยังอ่านชั้นได้', () => {
  const r = parseSapBom(FILE.split('\n').map(l => l.replace('\t.1\t', '\t0.1\t')).join('\n'));
  assert.equal(r.rows.length, 8);
  assert.equal(r.rows.find(x => x.mat_no === '20067121').depth, 1);
  assert.equal(Math.max(...r.rows.map(x => x.depth)), 6);
});

test('🔴 อ่านคอลัมน์ชั้นไม่ได้เลย = ไม่นำเข้า ห้ามเดาเป็นชั้น 1 ทั้งใบ', () => {
  // ตัดคอลัมน์ Level ทิ้ง — เดิมโค้ดแบนทุกแถวเป็นชั้น 1 เงียบๆ แล้วไปชน unique index ที่ปลายทาง
  const noLevel = FILE.split('\n').map(l => l.split('\t').filter((_, i) => i !== 4).join('\t')).join('\n');
  const r = parseSapBom(noLevel);
  assert.equal(r.rows.length, 0);
  assert.match(r.warnings[0], /ไม่นำเข้าให้/);
  assert.match(r.warnings.join(' '), /Excel/);     // บอกทางแก้ด้วย ไม่ใช่แค่บอกว่าพัง
});

test('sniffLevelCol — หาคอลัมน์ชั้นจากค่าจริง (ต้องเกินครึ่งของแถวที่มีค่า)', () => {
  assert.equal(sniffLevelCol([['a', '.1', '10'], ['b', '..2', '20'], ['c', '.1', '30']]), 1);
  assert.equal(sniffLevelCol([['a', '0.1', 'x'], ['b', '..2', 'y']]), 1);
  assert.equal(sniffLevelCol([['a', 'b', 'c'], ['d', 'e', 'f']]), null);   // ไม่มีคอลัมน์ไหนเข้ารูป
});

test('🔑 ITEM ซ้ำได้ข้ามตัวแม่ — ของจริง SAP นับเลขใหม่ทุกชั้น', () => {
  const r = parseSapBom(FILE);
  const byKey = new Map();
  r.rows.forEach(x => {
    const k = `${x.parent_mat || ''}|${x.item_no}`;
    assert.equal(byKey.has(k), false, `ซ้ำในตัวแม่เดียวกัน: ${k}`);
    byKey.set(k, x);
  });
  // ITEM 10 โผล่ทั้งชั้น 1 (30044771/20067121…) และชั้น 6 (50027080) = คนละตัวแม่ ⇒ ถูกต้อง
  const item10 = r.rows.filter(x => x.item_no === 10);
  assert.ok(item10.length > 1);
  assert.equal(new Set(item10.map(x => x.parent_mat)).size, item10.length);
});

test('🔴 "Object description" ต้องไม่ถูกตีเป็นคอลัมน์ MAT (บั๊กจริง 02/10 — ชื่อพาร์ทว่างทั้งใบ)', () => {
  const r = parseSapBom(FILE);
  // หัว `Obj` (เลข MAT) กับ `Object description` ขึ้นต้นเหมือนกัน ⇒ ต้องเลือกคีย์ที่เฉพาะเจาะจงกว่า
  assert.equal(r.rows[0].mat_no, '20067121');
  assert.equal(r.rows[0].part_name, 'PACK SUPT ASY RAD-FVL');
  assert.equal(r.rows.filter(x => !x.part_name).length, 0, 'ต้องไม่มีแถวไหนชื่อว่าง');
  // ชื่อต้องไม่ใช่เลข MAT ซ้ำ (อาการที่หน้างานเห็น)
  assert.equal(r.rows.filter(x => x.part_name === x.mat_no).length, 0);
});
