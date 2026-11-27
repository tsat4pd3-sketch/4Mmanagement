import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeSheetHeader, parseStoreStockSheet, buildStoreStockPlan, boardKeyOfSloc } from '../storeStockSheet.js';

const HEAD = ['Item', " Mat'l SAP", 'Part Name', 'Picture', 'STD/PC', 'MAX', 'MIN'];
const sheet = (name, body) => ({ name, rows: [[], HEAD, ...body] });

test('หัวตารางอยู่แถว 2 · คอลัมน์ตามไฟล์จริง', () => {
  const h = storeSheetHeader([[], HEAD]);
  assert.equal(h.row, 1); assert.equal(h.mat, 1); assert.equal(h.max, 5); assert.equal(h.min, 6); assert.equal(h.std, 4);
  assert.equal(storeSheetHeader([['A', 'B']]), null);
});

test('STD ไม่ใช่ตัวเลข (Kg) = packing null + เก็บหน่วยไว้ · MAT ซ้ำในชีทใช้แถวแรก', () => {
  const p = parseStoreStockSheet(' r401 ', [[], HEAD,
    [1, 50027624, 'STKM11A', null, 90, null, null],
    [2, 50027247, 'JSC coil', null, 'Kg', null, null],
    [3, 50027624, 'ซ้ำ', null, 1, 1, 1]]);
  assert.equal(p.sloc, 'R401');
  assert.equal(p.parts.length, 2);
  assert.equal(p.parts[0].std, 90);
  assert.equal(p.parts[1].std, null); assert.equal(p.parts[1].unit, 'Kg');
  assert.deepEqual(p.dupMats, ['50027624']);
});

const CUR = {
  boards: [{ id: 'b1', board_key: boardKeyOfSloc('R402') }],
  parts: [
    { id: 'p1', board_id: 'b1', mat_no: '111', part_no: null, row_key: '111|', part_name: 'A', packing: 10, sort_order: 0, is_active: true },
    { id: 'p2', board_id: 'b1', mat_no: '999', part_no: null, row_key: '999|', part_name: 'Gone', packing: null, sort_order: 1, is_active: true },
    { id: 'p3', board_id: 'b1', mat_no: '888', part_no: null, row_key: '888|', part_name: 'Off', packing: null, sort_order: 2, is_active: false },
  ],
  ks: [{ mat_no: '111', min_qty: 100, max_qty: 200 }, { mat_no: '222', min_qty: 5, max_qty: 9 }],
  home: new Map([['111', null], ['222', 'S403'], ['333', 'R402']]),
};

test('แผน: เพิ่ม/อัพเดท/ถอด · ถอดเฉพาะที่เปิดอยู่ · แถวที่ปิดไว้กลับมา = เพิ่ม', () => {
  const plan = buildStoreStockPlan([sheet('R402', [
    [1, '111', 'A', null, 10, 300, 150],
    [2, '222', 'B', null, 5, 9, 5],
    [3, '888', 'Back', null, null, null, null],
  ])], CUR);
  const s = plan.sheets[0];
  assert.deepEqual(s.add.map(x => x.mat), ['222', '888']);
  assert.deepEqual(s.same.map(x => x.mat), ['111']);
  assert.deepEqual(s.remove.map(x => x.id), ['p2']);
  assert.ok(s.upserts.every(u => u.is_active === true && u.row_key.endsWith('|')));
});

test('MAX/MIN: ทับค่าเดิม · ไม่มีแถวคัมบัง = ไม่สร้าง · MAX<MIN = ไม่บันทึก · ช่องว่างไม่แตะ', () => {
  const plan = buildStoreStockPlan([sheet('R402', [
    [1, '111', 'A', null, 10, 300, null],   // MIN ว่าง → คงค่าเดิม 100
    [2, '222', 'B', null, 5, 9, 5],         // เท่าเดิม → ไม่มีรายการเปลี่ยน
    [3, '444', 'New', null, 5, 50, 10],     // ไม่มี kanban_standards
    [4, '555', 'Bad', null, 5, 10, 20],     // MAX < MIN
  ])], CUR);
  assert.deepEqual(plan.minmax, [{ sloc: 'R402', mat: '111', name: 'A', fromMin: 100, fromMax: 200, min: 100, max: 300 }]);
  assert.deepEqual(plan.minmaxNoKs.map(x => x.mat), ['444']);
  assert.deepEqual(plan.minmaxBad.map(x => x.mat), ['555']);
});

test('ที่จัดเก็บหลัก: เติมเฉพาะที่ว่าง · คนละที่ = ขัดกัน ไม่ทับ · ไม่มีในทะเบียนพาร์ท = แจ้ง', () => {
  const plan = buildStoreStockPlan([sheet('R402', [
    [1, '111', 'A', null, 10, null, null],
    [2, '222', 'B', null, 5, null, null],
    [3, '333', 'C', null, 5, null, null],
    [4, '777', 'D', null, 5, null, null],
  ])], CUR);
  assert.deepEqual(plan.homeFill.map(x => x.mat), ['111']);
  assert.deepEqual(plan.homeConflict, [{ sloc: 'R402', mat: '222', now: 'S403' }]);
  assert.deepEqual(plan.homeNoPm.map(x => x.mat), ['777']);
});

test('ชีทที่ไม่มีบอร์ด / ไม่ใช่ชีทแบบนี้ = ข้ามพร้อมเหตุผล ห้ามเงียบ', () => {
  const plan = buildStoreStockPlan([sheet('Z999', [[1, '111', 'A', null, 1, null, null]]), { name: 'Note', rows: [['x']] }], CUR);
  assert.equal(plan.sheets.length, 0);
  assert.equal(plan.skipped.length, 2);
  assert.ok(plan.skipped.every(s => s.why));
});
