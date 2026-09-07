/**
 * ปลายทางของสต๊อกที่ค้างผิดที่ — เคสจริงจากจอ /line-stock (2026-09-03)
 *
 * user: "มันเลือกไป HDF1 หรือ 2 ไม่ได้ มีให้เลือกแค่ laser · ตัวนี้เป็นเหล็กจาก supplier
 *        ที่จะต้องเข้า hdf1 หรือ 2 ก่อน แล้วผลิตเป็น OP hydroform ค่อยส่งเข้า laser345/789"
 *       "ละมีไปอยู่ไลน์ apron assy อีก มั่วไปหมดเลย"
 *       "รายการที่ 2 กับ 3 ก็เป็นเหล็ก coil กับงาน blank ที่จะอยู่ไลน์ปั๊ม"
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveTargets, isFormingLine, looksLikeBlank } from '../moveTargets.js';

const childrenOf = {
  HYDROFORM:          ['HDF1', 'HDF2', 'LASER-345', 'LASER-789'],
  'LINE APRON ASSY':  ['Line 60', 'Line 61', 'Assy LWR', 'SUB APRON'],
  'LINE A ( 800 Ton )': ['PRESS-1', 'PRESS-2'],
};
const typeOf = {
  HDF1: 'hydroform', HDF2: 'hydroform', 'LASER-345': 'laser', 'LASER-789': 'laser',
  'Line 60': 'welding_assembly', 'Line 61': 'welding_assembly',
  'Assy LWR': 'welding_assembly', 'SUB APRON': 'welding_assembly',
  'PRESS-1': 'stamping', 'PRESS-2': 'stamping',
};
const allLeaf = Object.values(childrenOf).flat();
const base = { childrenOf, typeOf, allLeaf };
const flat = (r) => r.groups.flatMap(g => g.lines);
const groupOf = (r, line) => r.groups.find(g => g.lines.includes(line))?.key;

test('🔴 เคสที่ user เจอ: coil ที่ HYDROFORM ต้องเลือก HDF1/HDF2 ได้', () => {
  const r = moveTargets('50031601', { ...base, at: 'HYDROFORM', usedAt: ['LASER-789'] });
  assert.deepEqual(r.groups[0].lines, ['HDF1', 'HDF2'], 'ไลน์ขึ้นรูปต้องมาก่อน');
  assert.equal(groupOf(r, 'LASER-789'), 'bom', 'LASER ยังอยู่ แต่ถูกจัดเป็นขั้นถัดไป');
  assert.equal(r.sure, false, 'มี 2 ไลน์ขึ้นรูป → ต้องให้คนเลือก ห้ามเดา');
});

test('🔴 ของเดิมตัดตัวเลือกทิ้ง — ตอนนี้ไลน์ลูกทุกตัวต้องยังอยู่ในลิสต์', () => {
  const r = moveTargets('50031601', { ...base, at: 'HYDROFORM', usedAt: ['LASER-789'] });
  ['HDF1', 'HDF2', 'LASER-345', 'LASER-789'].forEach(n =>
    assert.ok(flat(r).includes(n), `${n} ต้องอยู่ในลิสต์`));
});

test('🔴 coil ค้างที่แผนกประกอบ → ต้องเสนอไลน์ขึ้นรูปแผนกอื่น ไม่งั้นไม่มีตัวเลือกไหนถูก', () => {
  const r = moveTargets('50029610', { ...base, at: 'LINE APRON ASSY', usedAt: ['Line 60'] });
  assert.equal(r.warn?.code, 'no_forming_in_dept');
  const out = r.groups.find(g => g.key === 'forming_out');
  assert.deepEqual(out.lines.sort(), ['HDF1', 'HDF2', 'PRESS-1', 'PRESS-2']);
  assert.ok(flat(r).includes('Line 60'), 'ไลน์ลูกในแผนกยังอยู่ ไม่ตัดทิ้ง');
});

test('🔴 งาน blank (2xx) ก็ต้องไปไลน์ปั๊ม — เลขตัวแรกตัดสินไม่ได้ ต้องดูชื่อ', () => {
  const r = moveTargets('20065734', {
    ...base, at: 'LINE APRON ASSY', partName: 'BRKT ENG ELETR GRD(MB3BE102D04BC)BLANK', usedAt: ['Line 60'],
  });
  assert.equal(r.needsForming, true);
  assert.equal(r.warn?.code, 'no_forming_in_dept');
  assert.ok(r.groups.find(g => g.key === 'forming_out').lines.includes('PRESS-1'));
});

test('2xx ที่ไม่ใช่ blank = ชิ้นประกอบปกติ → BOM มาก่อน ไม่ยัดไปไลน์ปั๊ม', () => {
  const r = moveTargets('20058626', {
    ...base, at: 'LINE APRON ASSY', partName: 'NUT WELD ASSY', usedAt: ['Line 61'],
  });
  assert.equal(r.needsForming, false);
  assert.equal(r.warn, null);
  assert.deepEqual(r.groups[0].lines, ['Line 61']);
  assert.equal(r.sure, true, 'BOM ชี้ไลน์เดียว = เลือกให้ได้');
});

test('ใช้ dr_products.line_name เมื่อ BOM ไม่ช่วย (blank ที่รู้ว่าผลิตที่ไหน)', () => {
  const r = moveTargets('20065734', {
    ...base, at: 'LINE APRON ASSY', partName: 'BRKT BLANK', usedAt: [], madeAt: 'PRESS-2',
  });
  assert.equal(r.groups[0].key, 'made_out');
  assert.deepEqual(r.groups[0].lines, ['PRESS-2']);
  assert.equal(r.sure, true);
});

test('แผนกมีไลน์ขึ้นรูปอยู่แล้ว → ไม่เสนอข้ามแผนก และไม่เตือน', () => {
  const r = moveTargets('50031601', { ...base, at: 'HYDROFORM', usedAt: [] });
  assert.equal(r.warn, null);
  assert.equal(r.groups.find(g => g.key === 'forming_out'), undefined);
});

test('mat ที่ไม่ใช่เลข SAP 8 หลัก = ไม่ตัดสิน (ไม่รู้ ≠ ไม่ใช่)', () => {
  const r = moveTargets('127 (M6 มีเกลียว)', { ...base, at: 'LINE APRON ASSY', usedAt: ['Line 60'] });
  assert.equal(r.needsForming, false);
  assert.equal(r.warn, null);
});

test('line_type ยังไม่ได้ตั้ง = ไม่ถือว่าเป็นไลน์ขึ้นรูป แต่ต้องไม่หายจากลิสต์', () => {
  const r = moveTargets('50031601', {
    ...base, typeOf: {}, at: 'HYDROFORM', usedAt: ['LASER-789'],
  });
  assert.equal(r.warn?.code, 'no_forming_in_dept', 'ไม่รู้ประเภท = เตือนให้ไปตั้ง');
  ['HDF1', 'HDF2', 'LASER-345', 'LASER-789'].forEach(n => assert.ok(flat(r).includes(n)));
});

test('ไม่มีบรรทัดซ้ำข้ามกลุ่ม', () => {
  const r = moveTargets('50031601', { ...base, at: 'HYDROFORM', usedAt: ['HDF1', 'LASER-789'] });
  const all = flat(r);
  assert.equal(all.length, new Set(all).size);
});

test('helper: isFormingLine / looksLikeBlank', () => {
  assert.equal(isFormingLine('hydroform'), true);
  assert.equal(isFormingLine('stamping'), true);
  assert.equal(isFormingLine('laser'), false);
  assert.equal(isFormingLine(null), false);
  assert.equal(looksLikeBlank('BRKT GRD(MB3B)BLANK'), true);
  assert.equal(looksLikeBlank('COIL 2.0X76'), true);
  assert.equal(looksLikeBlank('NUT WELD'), false);
  assert.equal(looksLikeBlank(null), false);
});

test('checkStockPlacement: เตือนตอนจ่ายพาร์ท — ปิดที่ต้นเหตุ', async () => {
  const { checkStockPlacement } = await import('../moveTargets.js');
  assert.equal(checkStockPlacement('50031601', 'COIL', 'welding_assembly')?.code, 'needs_forming_line');
  assert.equal(checkStockPlacement('50031601', 'COIL', 'laser')?.code, 'needs_forming_line');
  assert.equal(checkStockPlacement('50031601', 'COIL', 'hydroform'), null, 'ไลน์ขึ้นรูป = ถูกแล้ว');
  assert.equal(checkStockPlacement('50031601', 'COIL', null), null, 'ไม่รู้ประเภทไลน์ = ไม่เดา');
  assert.equal(checkStockPlacement('20058626', 'NUT WELD', 'welding_assembly'), null, '2xx ปกติ = ไม่เตือน');
  assert.equal(checkStockPlacement('20065734', 'BRKT BLANK', 'welding_assembly')?.code, 'needs_forming_line');
  assert.equal(checkStockPlacement('127 (M6)', null, 'welding_assembly'), null, 'ไม่ใช่เลข SAP = ไม่ตัดสิน');
});
