import test from 'node:test';
import assert from 'node:assert/strict';
import { explodeBom, leafRequirements, flatRequirements, levelTag,
         checkBomFlow, checkIssueFlow, isAssemblyLine } from '../bomTree.js';

/* โครงจริงจาก SAP Display Multilevel BOM ของ 10100384 (user ส่งภาพจอมา 2026-09-02)
   .1  20066660 ×1  →  ..2 20066662 ×1  →  ...3 50029976 ×0.450 KG
   .1  20066663 ×1  →  ..2 50027083 ×0.171 KG
   .1  30042571 ×5 (นัต) ฯลฯ                                                        */
const SAP = {
  '10100384': [
    { mat_no: '20066660', qty_per_unit: 1, uom: 'PC', part_name: 'REINF FRT FNDR @ BAT MTNG LWR RH' },
    { mat_no: '20066663', qty_per_unit: 1, uom: 'PC' },
    { mat_no: '30042571', qty_per_unit: 5, uom: 'PC' },
  ],
  '20066660': [{ mat_no: '20066662', qty_per_unit: 1, uom: 'PC' }],
  '20066662': [{ mat_no: '50029976', qty_per_unit: 0.45, uom: 'KG' }],
  '20066663': [{ mat_no: '50027083', qty_per_unit: 0.171, uom: 'KG' }],
};
/* โครงของเราตอนนี้ = แบนมาจาก SAP แล้วเก็บไว้ทั้ง 2 ชั้น (หลานโผล่ที่ชั้น 1 ด้วย) */
const OURS = {
  ...SAP,
  '10100384': [
    ...SAP['10100384'],
    { mat_no: '20066662', qty_per_unit: 1, uom: 'PC' },
    { mat_no: '50029976', qty_per_unit: 0.45, uom: 'KG' },
    { mat_no: '50027083', qty_per_unit: 0.341, uom: 'KG' },
  ],
};
const bomOf = (m) => SAP[m] || [];
const oursOf = (m) => OURS[m] || [];

test('levelTag — จุดนำหน้าแบบ SAP', () => {
  assert.equal(levelTag(1), '.1');
  assert.equal(levelTag(2), '..2');
  assert.equal(levelTag(3), '...3');
});

test('กางโครง SAP ได้ชั้นถูกต้อง + ลำดับแบบ depth-first', () => {
  const { rows, maxLevel } = explodeBom('10100384', bomOf);
  assert.equal(maxLevel, 3);
  assert.deepEqual(rows.map(r => `${r.tag} ${r.mat_no}`), [
    '.1 20066660', '..2 20066662', '...3 50029976',
    '.1 20066663', '..2 50027083',
    '.1 30042571',
  ]);
});

test('qty = ต่อตัวแม่ (เหมือนคอลัมน์ Qty ของ SAP) · qtyPerRoot = สะสมถึง FG', () => {
  const { rows } = explodeBom('10100384', bomOf);
  const coil = rows.find(r => r.mat_no === '50029976');
  assert.equal(coil.qty, 0.45);          // ต่อ 1 ตัวของ 20066662
  assert.equal(coil.qtyPerRoot, 0.45);   // แม่ทั้งสายเป็น ×1 → สะสมเท่าเดิม
  const nut = rows.find(r => r.mat_no === '30042571');
  assert.equal(nut.qtyPerRoot, 5);
});

test('qtyPerRoot คูณสะสมจริงเมื่อแม่ไม่ใช่ ×1', () => {
  const b = (m) => ({ FG: [{ mat_no: 'SUB', qty_per_unit: 2 }], SUB: [{ mat_no: 'RAW', qty_per_unit: 3 }] }[m] || []);
  const { rows } = explodeBom('FG', b);
  assert.equal(rows.find(r => r.mat_no === 'RAW').qty, 3);
  assert.equal(rows.find(r => r.mat_no === 'RAW').qtyPerRoot, 6);
});

test('🔴 จับแถวที่ "แบน" — หลานถูกใส่ที่ชั้น 1 ด้วย', () => {
  const { rows, flatDupes } = explodeBom('10100384', oursOf);
  assert.deepEqual(flatDupes.map(d => d.mat_no).sort(), ['20066662', '50027083', '50029976']);
  // แถวชั้น 1 คือตัวที่ควรถูกตัดถ้ายืนยันว่าต่อโซ่
  const dupRows = rows.filter(r => r.isDupeRow).map(r => r.mat_no).sort();
  assert.deepEqual(dupRows, ['20066662', '50027083', '50029976']);
  // แถวชั้นลึกของ mat เดียวกันติดธง flatDupe แต่ไม่ใช่ isDupeRow
  const deep = rows.find(r => r.mat_no === '50029976' && r.level > 1);
  assert.equal(deep.flatDupe, true);
  assert.equal(deep.isDupeRow, false);
  assert.equal(flatDupes.find(d => d.mat_no === '50029976').via.includes('20066662'), true);
});

test('โครงที่สะอาด = ไม่มี flatDupe เลย', () => {
  assert.equal(explodeBom('10100384', bomOf).flatDupes.length, 0);
});

test('🔴 BOM วนกลับหาตัวเอง ต้องไม่ค้าง + รายงาน cycle', () => {
  const loop = (m) => ({ A: [{ mat_no: 'B', qty_per_unit: 1 }], B: [{ mat_no: 'A', qty_per_unit: 1 }] }[m] || []);
  const { rows, cycles } = explodeBom('A', loop);
  assert.equal(cycles.length, 1);
  assert.equal(rows.find(r => r.cycle).mat_no, 'A');
  assert.ok(rows.length < 10);            // หยุดจริง ไม่ระเบิด
});

test('maxDepth — โครงลึกเกินต้องตัดแล้วบอก ไม่เงียบ', () => {
  const deep = (m) => (/^L\d+$/.test(m) ? [{ mat_no: `L${Number(m.slice(1)) + 1}`, qty_per_unit: 1 }] : []);
  const { truncated } = explodeBom('L1', deep, { maxDepth: 3 });
  assert.equal(truncated, true);
});

test('leafRequirements — ต่อโซ่แล้วเหลือเฉพาะของที่เบิกจริง (ไม่นับขั้นกลาง)', () => {
  const need = leafRequirements('10100384', bomOf);
  assert.deepEqual(need, [
    { mat_no: '30042571', qty: 5 },
    { mat_no: '50027083', qty: 0.171 },
    { mat_no: '50029976', qty: 0.45 },
  ]);
});

test('เทียบสูตรแบน (ที่ระบบใช้อยู่) กับต่อโซ่ — ต้องเห็นส่วนต่างได้', () => {
  const flat = flatRequirements('10100384', oursOf);
  const leaf = leafRequirements('10100384', oursOf);
  const fm = new Map(flat.map(r => [r.mat_no, r.qty]));
  const lm = new Map(leaf.map(r => [r.mat_no, r.qty]));
  // แบนนับ 20066660 (ขั้นกลาง) เป็นของที่ต้องเบิก · ต่อโซ่ไม่นับ
  assert.equal(fm.get('20066660'), 1);
  assert.equal(lm.has('20066660'), false);
  /* 🔴 coil ตัวเดียวถูกนับ 2 รอบ: แถวแบนที่ชั้น 1 (0.341) + แถวจริงใต้ 20066663 (0.171)
     ทั้งคู่เป็น "ใบชั้นล่างสุด" ทั้งคู่ → ต่อโซ่แล้วยัง **บวกกัน = 0.512**
     ⇒ แค่กางโครงไม่พอ ต้องลบแถวแบนออกด้วย ถึงจะได้ยอดจริง (0.171)
     นี่คือเหตุผลที่ util นี้ต้อง "ชี้แถวที่ควรลบ" (isDupeRow) ไม่ใช่แค่คำนวณให้ใหม่ */
  assert.equal(fm.get('50027083'), 0.341);
  assert.equal(lm.get('50027083'), 0.512);
  // ลบแถวแบนออกแล้วค่อยได้ยอดที่ตรงกับ SAP
  assert.equal(leafRequirements('10100384', bomOf).find(r => r.mat_no === '50027083').qty, 0.171);
});

test('🔴 5xx ที่ไล่ผ่าน 2xx พี่น้องได้ = นับซ้ำแน่ (ของจริง 31 แถว / 15 FG)', () => {
  const w = checkBomFlow('10100384', OURS['10100384'], oursOf);
  // 50029976 อยู่ใต้ 20066660→20066662 อยู่แล้ว · 50027083 อยู่ใต้ 20066663
  assert.equal(w.get('50029976').code, 'raw_double_counted');
  assert.equal(w.get('50029976').level, 'crit');
  assert.equal(w.get('50027083').code, 'raw_double_counted');
  assert.equal(w.has('20066662'), false);            // 2xx ไม่เตือนด้วยกฎนี้ (มี flatDupe จับแยก)
  assert.equal(w.has('30042571'), false);            // ของซื้อ = ปกติ
  assert.equal(w.has('20066660'), false);
});

test('✅ งานปั๊มแล้วขายเลย (ลูก 5xx ล้วน) ห้ามเตือน — ของจริง 21 FG', () => {
  const kids = [{ mat_no: '50031601' }];
  assert.equal(checkBomFlow('10105763', kids, () => []).size, 0);
  // แม้มี 5xx หลายตัวก็ยังเป็นงานปั๊ม ตราบใดที่ไม่มี 2xx/3xx ปน
  assert.equal(checkBomFlow('10105763', [{ mat_no: '50031601' }, { mat_no: '50029610' }], () => []).size, 0);
});

test('⚠ 5xx ปนกับ 2xx/3xx แต่ไล่ไม่ถึง = ต้องตรวจ (warn ไม่ใช่ crit) — ของจริง 40 แถว', () => {
  const kids = [{ mat_no: '20066660' }, { mat_no: '30042571' }, { mat_no: '50099999' }];
  const w = checkBomFlow('10100384', kids, () => []);   // ไม่มี sub-BOM ให้ไล่
  assert.equal(w.get('50099999').code, 'raw_in_assembly');
  assert.equal(w.get('50099999').level, 'warn');
});

test('🔀 FG ถูกใส่เป็นชิ้นส่วน = เตือน · เลขที่ไม่ใช่ตัวเลขห้ามตัดสิน', () => {
  assert.equal(checkBomFlow('20066660', [{ mat_no: '10100384' }], () => []).get('10100384').code, 'fg_as_component');
  assert.equal(checkBomFlow('MB3B-16E060', [{ mat_no: 'RB3B 8C306 BB' }], () => []).size, 0);
});

test('🔴 ไล่พี่น้องต้องไม่ค้างเมื่อ BOM วนกลับ', () => {
  const loop = (m) => ({ A: [{ mat_no: 'B' }], B: [{ mat_no: 'A' }] }[m] || []);
  assert.doesNotThrow(() => checkBomFlow('10100384', [{ mat_no: 'A' }, { mat_no: '50011111' }], loop));
});

test('🔴 จ่าย coil เข้าไลน์ประกอบ = เตือน · เข้าไลน์ปั๊ม = ปกติ · ไม่รู้ชนิดไลน์ = ไม่เดา', () => {
  assert.equal(checkIssueFlow('50031601', 'welding_assembly')?.code, 'raw_to_assembly');
  assert.equal(checkIssueFlow('50031601', 'stamping'), null);
  assert.equal(checkIssueFlow('50031601', 'hydroform'), null);
  assert.equal(checkIssueFlow('50031601', null), null);        // ไม่ตั้ง line_type = ไม่เดา
  assert.equal(checkIssueFlow('20066660', 'welding_assembly'), null);
  assert.equal(checkIssueFlow('10100384', 'welding_assembly')?.code, 'fg_into_line');
});

test('isAssemblyLine — ไม่รู้ต้องคืน null ไม่ใช่ false', () => {
  assert.equal(isAssemblyLine('welding_assembly'), true);
  assert.equal(isAssemblyLine('stamping'), false);
  assert.equal(isAssemblyLine(null), null);
  assert.equal(isAssemblyLine(''), null);
});
