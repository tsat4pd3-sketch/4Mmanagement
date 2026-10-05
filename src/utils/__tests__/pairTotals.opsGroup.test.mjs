/* ── ชั้น OP ต้องยุบเข้า "สินค้า" ไม่ใช่ "MAT ตัวเดียว" (2026-10-05 · คำสั่ง user) ──────────
   user: *"มันต่างแค่ลูกค้าไง แต่ product มันคือตัวเดียวกันเลย แค่ต้องแยกเพราะเวลาขาย
   จะต้องแยกบิล แยกรหัส และแยก mat SAP"*

   เคสจริงในฐาน DR (05/10): สินค้า "REINF ASY FRT FNDR INR BDY RH" = `p_no RB3B-16E060-BA`
   แตกเป็น 5 MAT ตามลูกค้า (10100384 FTM · 10100385 AAT · 10104955 FVL เลิกใช้ ·
   10106790 FVL · 20066636 FORD ชุบดำ) · ขั้นตอน `90031603` (ตัดเลเซอร์ LS345) ผูก
   `op_parent_mat = 10100385` ตัวเดียว ⇒ กะที่ Line 60 รัน FTM/FVL/FORD แทน AAT
   ขั้นตอนไม่ยุบ แล้วยอดถูกนับ 2 ครั้ง — วัดจริง 27 กะ · 18,659 ชิ้น · OP 5 ตัว           */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collapseOps, pairAwareOpTotal } from '../pairTotals.js';
import { partCoreOf } from '../partGroup.js';

/* กลุ่ม RH Line 60 ตามฐานจริง */
const RH = ['10100384', '10100385', '10104955', '10106790', '20066636'];
const LH = ['10100335', '10100401', '10106791', '20066622'];
const altsOf = (parent, group) => group.filter(x => x !== parent);

const OPMAP = {
  '90031603': { parent: '10100385', seq: 20, alts: altsOf('10100385', RH) },   // LASER-345 RH
  '90031604': { parent: '10100335', seq: 20, alts: altsOf('10100335', LH) },   // LASER-345 LH
  '90031601': { parent: '10100385', seq: 10, alts: altsOf('10100385', RH) },   // HYDROFORM RH
};

test('ขั้นตอนต้องยุบเมื่อ "ลูกค้าอื่นของสินค้าเดียวกัน" ถือยอดอยู่ (เคส 18,659 ชิ้น)', () => {
  // กะที่ Line 60 รัน FTM (10100384) ไม่ใช่ AAT (10100385) ที่ op_parent_mat ชี้ไว้
  const rows = [
    { mat_no: '10100384', target: 400, produced: 372 },   // พาร์ทจริง — ลูกค้า FTM
    { mat_no: '90031603', target: 400, produced: 372 },   // ขั้นตัดเลเซอร์ของชิ้นเดียวกัน
  ];
  const out = collapseOps(rows, OPMAP);
  assert.deepEqual(out, [{ mat_no: '10100384', target: 400, produced: 372 }]);
  assert.equal(pairAwareOpTotal(rows, () => null, OPMAP).produced, 372);  // ไม่ใช่ 744
});

test('ทุกลูกค้าในกลุ่มต้องยุบได้เหมือนกัน — ห้ามยุบได้แค่ตัวที่ op_parent_mat ชี้', () => {
  for (const mat of RH) {
    const out = collapseOps([
      { mat_no: mat, target: 100, produced: 90 },
      { mat_no: '90031603', target: 100, produced: 90 },
    ], OPMAP);
    assert.equal(out.length, 1, `${mat} ยังไม่ยุบ`);
    assert.equal(out[0].mat_no, mat);
  }
});

test('ขั้นตอนของคนละสินค้า (RH vs LH) ห้ามยุบข้ามกลุ่ม', () => {
  // Line 61 รัน LH แต่ในชุดมีขั้นของ RH → RH ต้องไม่ถูกตัด (คนละสินค้า)
  const out = collapseOps([
    { mat_no: '10100401', target: 100, produced: 95 },   // LH AAT
    { mat_no: '90031603', target: 100, produced: 95 },   // ขั้น RH
  ], OPMAP);
  assert.equal(out.length, 2);
  assert.equal(out.find(r => r.mat_no === '10100385')?.produced, 95);  // ยุบเข้า parent RH ของตัวเอง
});

test('ไม่มีพาร์ทจริงของกลุ่มเลย = ยุบ 2 ขั้นเข้ากลุ่มเดียว ห้ามแตกเป็น 2 แถว', () => {
  // HYDROFORM (ขั้น 10) + LASER-345 (ขั้น 20) ชิ้นเดียวกัน · Assy ยังไม่เดินในชุดนี้
  const out = collapseOps([
    { mat_no: '90031601', target: 500, produced: 480 },
    { mat_no: '90031603', target: 500, produced: 470 },
  ], OPMAP);
  assert.equal(out.length, 1);
  assert.equal(out[0].produced, 480);               // max ของขั้น (ทุกขั้นทำชิ้นเดียวกัน)
  assert.deepEqual(out[0]._ops.sort(), ['90031601', '90031603']);
});

test('ขั้นที่ชี้คนละลูกค้าของสินค้าเดียวกัน + ไม่มีตัวจริง = กลุ่มเดียว (กันนับซ้ำรอบที่ 2)', () => {
  const opMap = {
    'OP-A': { parent: '10100384', alts: altsOf('10100384', RH) },
    'OP-B': { parent: '10100385', alts: altsOf('10100385', RH) },
  };
  const out = collapseOps([
    { mat_no: 'OP-A', target: 300, produced: 300 },
    { mat_no: 'OP-B', target: 300, produced: 290 },
  ], opMap);
  assert.equal(out.length, 1, 'ต้องเหลือแถวเดียว — สินค้าตัวเดียวกัน');
  assert.equal(out[0].produced, 300);
});

test('ไม่มี `alts` = พฤติกรรมเดิมเป๊ะ (backward-compatible)', () => {
  const legacy = { '90031603': { parent: '10100385', seq: 20 } };
  const rows = [
    { mat_no: '10100384', target: 400, produced: 372 },
    { mat_no: '90031603', target: 400, produced: 372 },
  ];
  const out = collapseOps(rows, legacy);
  assert.equal(out.length, 2);                      // ไม่ยุบ = เท่าเดิมก่อนแก้
});

test('alts ว่าง/parent null = ไม่ยุบ ห้าม throw', () => {
  const rows = [{ mat_no: 'OP-X', target: 10, produced: 10 }];
  assert.deepEqual(collapseOps(rows, { 'OP-X': { parent: null, alts: [] } }), rows);
  assert.deepEqual(collapseOps(rows, { 'OP-X': { parent: null } }), rows);
});

/* ── แกน p_no คือคีย์ ⇒ พิมพ์ผิดตัวเดียวหลุดกลุ่มทันที (เคส 20066622 · 05/10) ── */
test('p_no ที่พิมพ์ผิด ทำให้ MAT หลุดกลุ่มสินค้า — เหตุผลที่ต้องแก้ 20066622', () => {
  assert.equal(partCoreOf('RB3B-16E061-BA'), '16E061');
  assert.notEqual(partCoreOf('RB3B-166061-BA'), '16E061');   // 6 แทน E = คนละกลุ่ม
  assert.equal(partCoreOf('RB3B-16E060-BA'), '16E060');      // ฝั่ง RH ของ 20066636 ถูกต้อง
});
