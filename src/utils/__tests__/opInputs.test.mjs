import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opInputsOf, parentKidsAfterOps, isFirstOpInChain, resolveOpParent } from '../opInputs.js';
import { opFamilyKey } from '../partGroup.js';

const STEEL = { mat_no: '50031625', qty_per_unit: 1 };
const NUT = { mat_no: '30043726', qty_per_unit: 6 };

test('ขั้น OP ผูก BOM เอง = ใช้ BOM ของขั้น', () => {
  assert.deepEqual(opInputsOf({ ownKids: [STEEL], parentKids: [STEEL, NUT] }), { kids: [STEEL], via: 'op_bom' });
});
test('ยังไม่ผูก + แม่มีลูกตัวเดียว = กินลูกตัวนั้น (user เคาะ)', () => {
  assert.equal(opInputsOf({ ownKids: [], parentKids: [STEEL] }).via, 'auto_single');
});
test('ยังไม่ผูก + แม่มีลูกหลายตัว = unset ห้ามเดา', () => {
  assert.deepEqual(opInputsOf({ ownKids: [], parentKids: [STEEL, NUT] }), { kids: [], via: 'unset' });
});
test('ใบแม่หักของที่ขั้น OP กินไปแล้ว · ขั้นที่ unset ไม่หักอะไร', () => {
  assert.deepEqual(parentKidsAfterOps([STEEL, NUT], [[STEEL]]).map(x => x.mat_no), ['30043726']);
  assert.deepEqual(parentKidsAfterOps([STEEL, NUT], [[]]).map(x => x.mat_no), ['50031625', '30043726']);
});

test('🔗 โซ่ขั้น (HYDROFORM 10 → LASER-345 20): ลูกตัวเดียวอัตโนมัติใช้กับขั้นแรกเท่านั้น · ขั้นถัดไป = from_prev', () => {
  const sib = [{ op_seq: 10 }, { op_seq: 20 }];
  assert.equal(isFirstOpInChain(sib[0], sib), true);
  assert.equal(isFirstOpInChain(sib[1], sib), false);
  assert.equal(opInputsOf({ parentKids: [STEEL], firstInChain: false }).via, 'from_prev');
  assert.equal(opInputsOf({ parentKids: [STEEL], firstInChain: true }).via, 'auto_single');
  // หลายขั้นแต่ลำดับไม่ครบ = ไม่รู้ว่าตัวไหนแรก = ไม่ใช่ (ห้ามเดา)
  assert.equal(isFirstOpInChain({ op_seq: null }, [{ op_seq: null }, { op_seq: 20 }]), false);
  assert.equal(isFirstOpInChain({ op_seq: null }, [{ op_seq: null }]), true);
});

test('🔩 opFamilyKey (20/11): ท้ายเป็นเรฟตัวอักษร = แกนเดียวกัน · ท้ายมีเลข = เลขเต็ม (ห้ามรวมคนละพาร์ท)', () => {
  assert.equal(opFamilyKey('RB3B-16E060-BA'), '16E060');
  assert.equal(opFamilyKey('RB3B-8C306-BB'), opFamilyKey('RB3B-8C306-BC'));
  assert.equal(opFamilyKey('MB3B 8A297 CB'), '8A297');
  assert.notEqual(opFamilyKey('N1WB-17E850R-PIA02'), opFamilyKey('N1WB-17E850R-PIA04'));
  assert.notEqual(opFamilyKey('R1WB-17K824/825-AAW - STEP 2'), '17K824825AAWSTEP');
  assert.equal(opFamilyKey(''), '');
});

test('🔩 resolveOpParent (20/11): FG ไม่มี OP เอง → แม่ตัวเดียวในกลุ่ม · มีของตัวเอง/กำกวม = ตัวเอง', () => {
  const pno = { '10100385': 'RB3B-16E060-BA', '10100384': 'RB3B-16E060-BA', '10100401': 'RB3B-16E061-BA', X1: 'A-9Z99-AA', X2: 'B-9Z99-AB', X3: 'C-9Z99-AC' };
  const familyOf = (m) => opFamilyKey(pno[m]);
  const isPre = () => true;
  const opsOf = new Map([['10100385', ['90031601', '90031603']], ['10100401', ['90031602']], ['X1', ['OP1']], ['X2', ['OP2']]]);
  assert.equal(resolveOpParent('10100384', { opsOf, familyOf, isPre }), '10100385');
  assert.equal(resolveOpParent('10100385', { opsOf, familyOf, isPre }), '10100385');
  assert.equal(resolveOpParent('X3', { opsOf, familyOf, isPre }), 'X3');           // 2 แม่ในกลุ่ม = กำกวม
  assert.equal(resolveOpParent('10100384', { opsOf, familyOf, isPre: () => false }), '10100384'); // มีแต่ขั้นหลังประกอบ
});

test('⚠️ opDriftAgainstSap (20/11): SAP เปลี่ยนเบอร์ท่อ แต่ขั้น OP ยังกินเบอร์เก่า = เตือน', async () => {
  const { opDriftAgainstSap } = await import('../opInputs.js');
  const opsOf = new Map([['10100385', ['90031601', '90031603']]]);
  const opKidsOf = new Map([['90031601', [{ mat_no: '50031601' }]], ['90031603', [{ mat_no: '90031601' }]]]);
  const fam = { '10100385': '16E060', '10100384': '16E060' };
  const a = { opsOf, opKidsOf, familyOf: (m) => fam[m] || '', isOpMat: (m) => m.startsWith('9003') };
  // BOM ใหม่ยังมีท่อเดิม = ไม่เตือน
  assert.deepEqual(opDriftAgainstSap({ ...a, sheets: [{ mat: '10100385', rows: [{ mat_no: '50031601' }] }] }), []);
  // SAP เปลี่ยนเป็นท่อใหม่ = เตือนที่ขั้นแรก (ขั้นถัดไปกินชิ้นจากขั้นก่อน ไม่นับ)
  assert.deepEqual(opDriftAgainstSap({ ...a, sheets: [{ mat: '10100385', rows: [{ mat_no: '50099999' }] }] }),
    [{ sheet: '10100385', parent: '10100385', op: '90031601', mat: '50031601' }]);
  // FG ต่างลูกค้าของกลุ่มเดียวกันก็ตรวจผ่านแม่ในกลุ่ม
  assert.equal(opDriftAgainstSap({ ...a, sheets: [{ mat: '10100384', rows: [{ mat_no: '50099999' }] }] })[0].parent, '10100385');
  // ใบที่ไม่เกี่ยวกับ OP = ไม่เตือน
  assert.deepEqual(opDriftAgainstSap({ ...a, sheets: [{ mat: '20000000', rows: [] }] }), []);
});
