/* 🧩 ของเสียระดับ "พาร์ทลูก" (2026-11-16 · user: "จาก daily report การลงของเสีย ต้องเลือก
   child part ได้ บางทีไม่เสียทั้ง FG")

   เทสนี้ล็อก 2 เรื่องที่ห้ามหลุด:
   ① ลิสต์ลูกมาจาก BOM ตามกฎ "ใบเดียว" (ห้ามรวมหลายใบ = นับซ้ำ) · ยุบ mat ซ้ำเหลือชั้นตื้นสุด
   ② 🔴🔴 **เลือกพาร์ทลูกแล้ว %Q/%P ต้องไม่ขยับแม้แต่ตัวเดียว** — ของเสียยังนับเข้า MAT แม่ 1:1
      (คำถาม "ลูกเสีย N ชิ้น = FG เสียกี่ชิ้น" ยังรอ user เคาะ · ห้ามเดา)
   pure ทั้งไฟล์ — ไม่มีการพึ่งเวลาปัจจุบัน (รอบเทส "นาฬิกา +400 วัน" ต้องได้ผลเท่ากัน) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBomIndex, bomChildCandidates } from '../bomTree.js';
import { bomChildOptions } from '../pickerOptions.js';
import { childPartPatch, childPartText, defectPartOf, hasChildPart } from '../defectPart.js';
import { yellowRowFromDefect } from '../qualityBin.js';
import {
  defectQty, defectQtyAll, sumDefectQty, splitDefectQty, ngByMatFrom,
  suspectPendingQty, sumSuspectPending, QBIN_EMBED,
} from '../oee.js';

/* ── ฐานทดสอบ: FG 10100817 มีลูก 3 ตัว · 50028183 ถูกย้ายไปใต้ 20067039 (ชั้น 2) ── */
const FG_SHEET = 'p-10100817';
const SUB_SHEET = 'p-20067039';
const MAT_OF = { [FG_SHEET]: '10100817', [SUB_SHEET]: '20067039' };
const ROWS = [
  { id: 'b1', product_id: FG_SHEET, mat_no: '20067039', part_name: 'SUB ASSY', part_no: 'MB3B-1', qty_per_unit: 1, uom: 'PC' },
  { id: 'b2', product_id: FG_SHEET, mat_no: '30046428', part_name: 'BOLT', qty_per_unit: 2, uom: 'pcs' },
  { id: 'b3', product_id: FG_SHEET, mat_no: '50028183', part_name: 'COIL', part_no: 'เหล็กม้วนสำหรับงานปั๊มชิ้นใน', qty_per_unit: 0.5, uom: 'KG', parent_mat: '20067039' },
];
const ixOf = (rows = ROWS, matOf = MAT_OF) => buildBomIndex(rows, matOf);

test('ลูกของ FG = ใบของตัวเอง · ชั้น 2 ตาม parent_mat (ไม่ใช่แค่ชั้น 1)', () => {
  const c = bomChildCandidates('10100817', ixOf());
  assert.deepEqual(c.rows.map(r => r.mat_no), ['20067039', '30046428', '50028183']);
  assert.deepEqual(c.rows.map(r => r.level), [1, 1, 2]);
  assert.equal(c.rows.find(r => r.mat_no === '50028183').parent, '20067039');
  // qtyPerRoot = สะสมถึง FG (0.5 × 1) — ตัวที่เอาไปบันทึกเป็นอัตราต่อ 1 FG
  assert.equal(c.rows.find(r => r.mat_no === '50028183').qtyPerRoot, 0.5);
  assert.equal(c.rows.find(r => r.mat_no === '30046428').qtyPerRoot, 2);
});

test('ตัว root ไม่อยู่ในลิสต์ (เลือกตัวเองเป็นลูกไม่ได้)', () => {
  const c = bomChildCandidates('10100817', ixOf());
  assert.equal(c.rows.some(r => r.mat_no === '10100817'), false);
});

test('mat ซ้ำ 2 ชั้น (แถวแบนจาก SAP) = เหลือตัวเดียว ชั้นตื้นสุด + ติดธง flatDupe', () => {
  const rows = [...ROWS, { id: 'b4', product_id: FG_SHEET, mat_no: '50028183', part_name: 'COIL', qty_per_unit: 0.5, uom: 'KG' }];
  const c = bomChildCandidates('10100817', ixOf(rows));
  const hits = c.rows.filter(r => r.mat_no === '50028183');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].level, 1);            // ชั้นตื้นสุดชนะ (คำตอบคงที่ ไม่ขึ้นกับลำดับ DFS)
  assert.equal(hits[0].flatDupe, true);      // ⇒ จออัตรา/badge ต้องเตือน ห้ามบันทึกอัตรา
});

test('"ใบนี้ว่าง ≠ พาร์ทไม่มีลูก" — ลูกที่ถูกกรอกไว้ในใบอื่นต้องเจอ', () => {
  // 20067039 ไม่มีใบของตัวเอง แต่ใบของ FG กรอกลูกของมันไว้ (parent_mat)
  const ix = buildBomIndex(ROWS, { [FG_SHEET]: '10100817' });
  const c = bomChildCandidates('20067039', ix);
  assert.deepEqual(c.rows.map(r => r.mat_no), ['50028183']);
  assert.equal(c.sheets.length, 1);
});

test('ลูกถูกกรอกไว้หลายใบ = คืน sheets ทุกใบให้จอเตือน แต่กางใบเดียว (ห้ามรวม = นับซ้ำ)', () => {
  const rows = [
    ...ROWS,
    { id: 'b9', product_id: SUB_SHEET, mat_no: '50099999', part_name: 'OTHER COIL', qty_per_unit: 1, uom: 'KG' },
  ];
  const c = bomChildCandidates('20067039', ixOf(rows));
  assert.equal(c.sheets.length, 2);
  // ใบของตัวเองชนะ ⇒ ได้ชุดของ SUB_SHEET ใบเดียว ไม่ใช่ 2 ตัวรวมกัน
  assert.deepEqual(c.rows.map(r => r.mat_no), ['50099999']);
});

test('แถวที่วนกลับหาตัวเอง (ข้อมูลพัง) ห้ามอยู่ในลิสต์ให้เลือก', () => {
  const rows = [{ id: 'c1', product_id: FG_SHEET, mat_no: '10100817', qty_per_unit: 1, uom: 'PC' }];
  const c = bomChildCandidates('10100817', ixOf(rows));
  assert.deepEqual(c.rows, []);
});

test('ไม่มี BOM = ลิสต์ว่าง (ไม่ throw) — จอต้องยังลงของเสียระดับ MAT แม่ได้', () => {
  const c = bomChildCandidates('99999999', ixOf());
  assert.deepEqual(c.rows, []);
  assert.deepEqual(bomChildCandidates('', ixOf()).rows, []);
  assert.deepEqual(bomChildCandidates('10100817', null).rows, []);
});

/* ── option ของช่องเลือก ───────────────────────────────────────────────────── */

test('option: ชั้น 1 / ชั้นลึก แยกกลุ่ม · อัตราต่อ FG อยู่บรรทัดรอง', () => {
  const opts = bomChildOptions(bomChildCandidates('10100817', ixOf()).rows);
  assert.equal(opts.length, 3);
  assert.equal(opts[0].label, '20067039');
  assert.equal(opts[0].group, '🧩 พาร์ทลูกชั้น 1');
  assert.equal(opts[2].group, '🔧 ชั้นลึก (ลูกของลูก)');
  assert.match(opts[2].sub, /ชั้น 2 · ใต้ 20067039/);
  assert.match(opts[1].sub, /ใช้ 2 PC\/FG/);          // pcs → PC (uomLabel) · ห้ามยุบ KG
  assert.match(opts[2].sub, /ใช้ 0\.5 KG\/FG/);
});

test('option: part_no ที่เป็น "คำบรรยาย" ห้ามขึ้นหัว แต่ห้ามทิ้ง (กฎ <MatLabel>)', () => {
  const opts = bomChildOptions(bomChildCandidates('10100817', ixOf()).rows);
  const coil = opts.find(o => o.label === '50028183');
  assert.equal(coil.lead, null);                               // ไม่ขึ้นหัว
  assert.match(coil.sub, /เหล็กม้วนสำหรับงานปั๊มชิ้นใน/);          // แต่ยังเห็น
  assert.equal(opts.find(o => o.label === '20067039').lead, 'MB3B-1');   // เลขพาร์ทจริง = ขึ้นหัว
});

test('option: ค่าเดิมในใบที่ไม่อยู่ใน BOM แล้ว ต้องไม่หายจากช่อง (ไม่งั้นถูกล้างทิ้งเงียบ)', () => {
  const opts = bomChildOptions(bomChildCandidates('10100817', ixOf()).rows, { current: '20099999' });
  const off = opts.find(o => o.label === '20099999');
  assert.ok(off, 'ค่าเดิมต้องยังเป็นตัวเลือก');
  assert.equal(off.offList, true);
  assert.equal(off.badge, '⚠ นอกลิสต์');
});

/* ── payload ที่เขียนลง defect_logs ───────────────────────────────────────── */

test('childPartPatch: ไม่เลือกลูก = null ทั้งชุด (พฤติกรรมเดิมเป๊ะ)', () => {
  assert.deepEqual(childPartPatch(null),
    { child_mat_no: null, child_part_name: null, child_qty_per_fg: null });
  assert.deepEqual(childPartPatch({ mat_no: '  ' }),
    { child_mat_no: null, child_part_name: null, child_qty_per_fg: null });
});

test('childPartPatch: เก็บอัตราเฉพาะที่เชื่อได้ — แถวซ้ำ 2 ชั้น = null ห้ามเดา', () => {
  assert.deepEqual(childPartPatch({ mat_no: '50028183', part_name: 'COIL', qtyPerRoot: 0.5 }),
    { child_mat_no: '50028183', child_part_name: 'COIL', child_qty_per_fg: 0.5 });
  assert.equal(childPartPatch({ mat_no: '50028183', qtyPerRoot: 0.5, flatDupe: true }).child_qty_per_fg, null);
  assert.equal(childPartPatch({ mat_no: '50028183', qtyPerRoot: 0 }).child_qty_per_fg, null);
});

test('defectPartOf: ตอบ "เสียที่ชิ้นไหน" + ยังรู้ MAT แม่เสมอ', () => {
  const base = { prod_orders: { mat_no: '10100817', part_name: 'BRACKET' } };
  assert.deepEqual(defectPartOf(base),
    { mat: '10100817', name: 'BRACKET', fgMat: '10100817', isChild: false });
  assert.deepEqual(defectPartOf({ ...base, child_mat_no: '30046428', child_part_name: 'BOLT' }),
    { mat: '30046428', name: 'BOLT', fgMat: '10100817', isChild: true });
  // ไม่ผูกใบผลิต = ชี้เป้าไม่ได้ ⇒ null (จอต้องเขียนบอก ห้ามเดา)
  assert.equal(defectPartOf({}).mat, null);
  assert.equal(hasChildPart({ child_mat_no: '30046428' }), true);
  assert.equal(childPartText({ child_mat_no: '30046428', child_part_name: 'BOLT' }), '↳ 30046428 · BOLT');
  assert.equal(childPartText({}), '');
});

/* ══ 🔴🔴 ด่านสำคัญที่สุดของไฟล์นี้ — เลือกพาร์ทลูกแล้ว %Q/%P ห้ามขยับ ══════════════ */

const QBIN_KEY = 'quality_bin_records';
const defectRow = (extra = {}) => ({
  qty_ng: 3, qty_suspect: 2, qty_repair: 1, is_trial: false,
  prod_order_id: 'o1', prod_orders: { mat_no: '10100817' },
  [QBIN_KEY]: [],                 // "ถามทะเบียนถังแล้ว · ยังไม่มีใบ" ⇒ ของสงสัยรอพิจารณา
  ...extra,
});
const CHILD = { child_mat_no: '30046428', child_part_name: 'BOLT', child_qty_per_fg: 2 };

test('🔴 %Q: defectQty / sumDefectQty / splitDefectQty เท่าเดิมเป๊ะเมื่อระบุพาร์ทลูก', () => {
  const plain = defectRow();
  const child = defectRow(CHILD);
  assert.equal(defectQty(child), defectQty(plain));
  assert.equal(defectQty(child), 3);                       // NG 3 · สงสัย 2 ยังรอ ⇒ ไม่นับ
  assert.equal(defectQtyAll(child), defectQtyAll(plain));
  assert.equal(sumDefectQty([child], 'line'), sumDefectQty([plain], 'line'));
  assert.deepEqual(splitDefectQty([child]), splitDefectQty([plain]));
  assert.equal(suspectPendingQty(child), suspectPendingQty(plain));
  assert.equal(sumSuspectPending([child]), sumSuspectPending([plain]));
});

test('🔴 %P: ngByMatFrom ยังผูกของเสียกับ "MAT แม่" (CT ที่รู้คือของงานที่เครื่องเดิน)', () => {
  const orders = [{ id: 'o1', mat_no: '10100817' }];
  assert.deepEqual(ngByMatFrom([defectRow(CHILD)], orders),
    ngByMatFrom([defectRow()], orders));
  /* 5 → 6 (25/11): ตัวเศษ %P รวม `qty_repair` ด้วยแล้ว (oee.js §7.2.1 — ชิ้นรอซ่อมเครื่องก็เดินทำออกมา)
     fixture นี้คือ NG 3 + สงสัย 2 + ซ่อม 1 · **ประเด็นของเทสไม่เปลี่ยน**: เลือกพาร์ทลูกแล้วต้องได้เท่าเดิม */
  assert.deepEqual(ngByMatFrom([defectRow(CHILD)], orders), { byMat: { 10100817: 6 }, noMat: 0 });
});

test('🔴 ห้ามมีช่อง child โผล่ในสูตร: อัตรา BOM 2 ชิ้น/FG ก็ไม่คูณยอดของเสีย', () => {
  // ลูกเสีย 3 ชิ้น กับอัตรา 2 ชิ้น/FG — ถ้าใครเผลอคูณ/หาร ตัวเลขจะกลายเป็น 6 หรือ 1.5
  const child = defectRow({ ...CHILD, qty_suspect: 0 });
  assert.equal(defectQty(child), 3);
  assert.equal(defectQtyAll(child), 3);
  assert.equal(sumDefectQty([child], 'line'), 3);
});

test('🟡 ใบถังเหลืองอัตโนมัติ: จำนวน/คีย์ MAT ไม่เปลี่ยน · เหตุต้องเขียนว่าเสียที่ลูก', () => {
  const sess = { line_name: 'ASSY1', work_date: '2026-11-16' };
  const plain = yellowRowFromDefect({ id: 'd1', ...defectRow(), dr_defect_types: { name_th: 'รอยขีด' } }, sess, {});
  const child = yellowRowFromDefect({ id: 'd1', ...defectRow(CHILD), dr_defect_types: { name_th: 'รอยขีด' } }, sess, {});
  assert.equal(child.qty, plain.qty);              // 5 ชิ้นเท่าเดิม
  assert.equal(child.mat_no, plain.mat_no);        // คีย์ใบถัง = MAT แม่ (ทั้งสายจับคู่ด้วยคีย์นี้)
  assert.match(child.cause, /เสียที่พาร์ทลูก 30046428 · BOLT/);
  assert.equal(plain.cause.includes('พาร์ทลูก'), false);
});

test('คิวรีที่คิด %Q ยัง embed ทะเบียนถังชุดเดิม (งานนี้ไม่แตะ QBIN_EMBED)', () => {
  assert.match(QBIN_EMBED, /^quality_bin_records\(/);
  assert.equal(QBIN_EMBED.includes('child_'), false);
});
