/* 🔐 ชั้นที่ 3 ของสิทธิ์ — "แถวนี้เป็นของหน่วยงานเราไหม" (2026-10-15 · คำสั่ง user)
 *
 * > *"user เป็น mtn ที่เป็นแค่แอดมินส่วนงาน แต่เข้าไปแก้ KPI ของแผนกอื่นได้ มั่วเลย"*
 *
 * 🔴 กติกาที่ห้าม regress: **"ขอบเขตที่เห็น" ≠ "ขอบเขตที่แก้ได้"**
 *    วัดจริง 15/10: 31 จาก 122 บัญชี `sections` ว่าง (เป็น role mtn 16) เพราะช่างต้องเห็นทุกไลน์
 *    ⇒ ถ้าเอา `sections` มาตัดสินการแก้ = ช่างแก้ได้ทั้งโรงงาน (เคสที่ user แจ้ง)
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { canWriteUnit, canWriteLine, writeUnitsOf, hasAllUnits, writableRows, writeBlockText }
  from '../writeScope.js';

const MTN = { role: 'mtn', section: 'JIG MTN', sections: null };          // ช่าง: เห็นทั้งโรงงาน
const SUP = { role: 'supervisor', section: 'PD3', sections: ['PD3'] };
const QA  = { role: 'qa', section: 'QA', sections: null, allUnits: true };

test('🔴 เคสที่ user แจ้ง — ช่างที่ sections ว่าง ต้องแก้ได้แค่บ้านตัวเอง', () => {
  assert.equal(canWriteUnit(MTN, 'JIG MTN').ok, true);
  assert.equal(canWriteUnit(MTN, 'PD3').ok, false);          // ← เดิมผ่าน เพราะ sections ว่าง = ไม่จำกัด
  assert.equal(canWriteUnit(MTN, 'PD3').code, 'other_unit');
});

test('sections ชนะ section เมื่อมีค่า (คนที่ถูกตั้งขอบเขตหลายส่วนงาน)', () => {
  const m = { role: 'manager', section: 'PD1', sections: ['PD1', 'PD2'] };
  assert.deepEqual(writeUnitsOf(m), ['PD1', 'PD2']);
  assert.equal(canWriteUnit(m, 'PD2').ok, true);
  assert.equal(canWriteUnit(m, 'PD4').ok, false);
});

test('คีย์ scope:all_units = ผ่านทุกหน่วย · admin เป็นตาข่ายกันตาย', () => {
  assert.equal(canWriteUnit(QA, 'PD3').code, 'all_units');
  assert.equal(hasAllUnits({ role: 'admin' }), true);        // ไม่มีคีย์ก็ต้องผ่าน
  assert.equal(hasAllUnits({ role: 'mtn' }), false);
});

test('🔴 ไม่รู้บ้านตัวเอง = บล็อก + บอกทางแก้ (ห้ามเงียบ ห้ามปล่อยผ่าน)', () => {
  const r = canWriteUnit({ role: 'supervisor' }, 'PD3');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no_home_unit');
  assert.match(writeBlockText(r), /ยังไม่ได้ตั้งส่วนงาน/);
  assert.match(writeBlockText(r), /แอดมิน/);                  // ต้องบอกทางแก้
});

test('🔴 แถวที่ไม่ผูกหน่วยงาน (ทะเบียนกลาง) — default ผ่าน · block ได้เมื่อจอสั่ง', () => {
  assert.equal(canWriteUnit(SUP, null).code, 'unknown_target');
  assert.equal(canWriteUnit(SUP, '', { unknownTarget: 'block' }).ok, false);
  // ของกลางห้ามล็อกทั้งโรงงานโดยไม่ตั้งใจ — default ต้องเป็น allow
  assert.equal(canWriteUnit(SUP, '').ok, true);
});

test('canWriteLine: ไลน์ที่ไม่อยู่ในทะเบียน = ไม่รู้เจ้าของ ไม่ใช่ "ของเรา"', () => {
  const lines = [{ name: 'Assy 060', section: 'PD3' }, { name: 'Weld 101', section: 'PD1' }];
  assert.equal(canWriteLine(SUP, 'Assy 060', lines).ok, true);
  assert.equal(canWriteLine(SUP, 'Weld 101', lines).ok, false);
  assert.equal(canWriteLine(SUP, 'ไลน์ที่ไม่มีในทะเบียน', lines).code, 'unknown_target');
  assert.equal(canWriteLine(SUP, 'ไลน์ที่ไม่มีในทะเบียน', lines, { unknownTarget: 'block' }).ok, false);
});

test('เทียบชื่อแบบ normalize (ช่องว่าง/ตัวพิมพ์) — section เป็น text พิมพ์มือ', () => {
  assert.equal(canWriteUnit(SUP, ' pd3 ').ok, true);
});

test('writableRows: กรองลิสต์ได้ · ถือ all_units = ไม่กรองเลย', () => {
  const rows = [{ s: 'PD3' }, { s: 'PD1' }, { s: null }];
  assert.equal(writableRows(SUP, rows, r => r.s).length, 2);   // PD3 + แถวไม่ผูกหน่วย
  assert.equal(writableRows(QA, rows, r => r.s).length, 3);
});

/* ═══════════════════════════════════════════════════════════════════════════════════════
   💰 แกนที่ 2 — Cost Center + ลำดับชั้น (2026-10-19 · คำสั่ง user "สลับ 20 จอมาใช้ canWriteScope")
   สลับที่ไฟล์นี้ที่เดียว ⇒ 20 จอได้แกนใหม่พร้อมกันโดยไม่ต้องแก้ด่านในจอ
   ผังในเทสถอดจากของจริง + กับดักเลขรหัส (ลูกของ 21404xx = 21405xx)
═══════════════════════════════════════════════════════════════════════════════════════ */
import { buildOrgScope } from '../orgScope.js';
import { attachCc } from '../ccScope.js';

const NODES = [
  { id: 's1', kind: 'section',    code: 'PD1', name: 'PD1',         parent_id: null, cost_center: '2140461000', is_active: true },
  { id: 'd1', kind: 'department', code: 'BIG PRESS',   name: 'BIG PRESS',   parent_id: 's1', cost_center: '2140561001', is_active: true },
  { id: 'd1b',kind: 'department', code: 'SMALL PRESS', name: 'SMALL PRESS', parent_id: 's1', cost_center: null,         is_active: true },
  { id: 's2', kind: 'section',    code: 'PD2', name: 'PD2',         parent_id: null, cost_center: '2140470000', is_active: true },
  { id: 'd2', kind: 'department', code: 'ASSY A-GM',   name: 'Assy A-GM',   parent_id: 's2', cost_center: '2140571000', is_active: true },
  { id: 'n1', kind: 'line',       code: 'PRESS 1', name: 'PRESS 1', parent_id: 'd1', ref_line_id: 'L1', cost_center: null, is_active: true },
  { id: 'n2', kind: 'line',       code: 'ASSY 1',  name: 'ASSY 1',  parent_id: 'd2', ref_line_id: 'L2', cost_center: null, is_active: true },
];
const LINES = [
  { id: 'L1', name: 'PRESS 1', section: 'PD1', parent_line_name: null, cost_center: null, is_active: true },
  { id: 'L2', name: 'ASSY 1',  section: 'PD2', parent_line_name: null, cost_center: null, is_active: true },
];
const IDX = attachCc(buildOrgScope({ nodes: NODES, lines: LINES }), NODES);
/* หัวหน้าแผนก BIG PRESS: บ้านจริงคือ PD1 (แกนเดิมให้ทั้งส่วนงาน) แต่ CC ให้แค่แผนกตัวเอง */
const HEAD_BP = { role: 'supervisor', section: 'PD1', sections: ['PD1'],
  respCostCenters: ['2140561001'], scopeIdx: IDX };
/* หัวหน้าส่วน PD1: CC ชั้นส่วนงาน ⇒ ต้องได้ทุกหน่วยใต้ลงไป */
const HEAD_PD1 = { role: 'manager', section: 'PD1', sections: ['PD1'],
  respCostCenters: ['2140461000'], scopeIdx: IDX };

test('🔑 โจทย์ user — รับผิดชอบ CC ชั้นส่วนงาน ⇒ ได้ทุกหน่วยใต้ลงไป', () => {
  assert.equal(canWriteUnit(HEAD_PD1, 'PD1').ok, true);
  assert.equal(canWriteUnit(HEAD_PD1, 'BIG PRESS').ok, true, 'แผนกใต้ PD1 ต้องแก้ได้');
  assert.equal(canWriteUnit(HEAD_PD1, 'SMALL PRESS').ok, true, 'แผนกที่ไม่มีรหัสเอง (ตกทอด) ก็ต้องแก้ได้');
  assert.equal(canWriteLine(HEAD_PD1, 'PRESS 1', LINES).ok, true);
});

test('🔑 แกนใหม่ทำสิ่งที่แกนข้อความทำไม่ได้ — แผนกเดียว ไม่ได้ทั้งส่วนงาน', () => {
  assert.equal(canWriteUnit(HEAD_BP, 'BIG PRESS').ok, true);
  assert.equal(canWriteUnit(HEAD_BP, 'PD1').ok, false, 'ถือ CC แผนก ต้องไม่ได้ทั้งส่วนงาน PD1');
  assert.equal(canWriteUnit(HEAD_BP, 'SMALL PRESS').ok, false, 'แผนกพี่น้องต้องแยกจากกันได้');
  /* เทียบกับแกนเดิมของบัญชีเดียวกัน (ไม่มี CC) — เดิม PD1 ทั้งส่วนงานผ่านหมด */
  const old = { role: 'supervisor', section: 'PD1', sections: ['PD1'] };
  assert.equal(canWriteUnit(old, 'PD1').ok, true);
  assert.equal(canWriteUnit(old, 'BIG PRESS').ok, false, 'แกนเดิมเทียบข้อความตรงตัว = แผนกไม่ผ่าน');
});

test('🔴 ไลน์ตัดสินที่ตัวไลน์ ไม่ใช่ถอยไปใช้ส่วนงานของไลน์', () => {
  assert.equal(canWriteLine(HEAD_BP, 'PRESS 1', LINES).ok, true, 'ไลน์ใต้แผนกตัวเองต้องแก้ได้');
  assert.equal(canWriteLine(HEAD_BP, 'ASSY 1', LINES).ok, false, 'ไลน์ของ PD2 ต้องแก้ไม่ได้');
});

test('🔴 ข้ามส่วนงานต้องถูกบล็อกทุกทาง (เลขรหัสใกล้กันหลอกตาไม่ได้)', () => {
  assert.equal(canWriteUnit(HEAD_PD1, 'PD2').ok, false);
  assert.equal(canWriteUnit(HEAD_PD1, 'ASSY A-GM').ok, false, '21404xx ต้องไม่ครอบ 21405 71000 ของ PD2');
});

test('🔁 ยังไม่ตั้ง CC = พฤติกรรมเดิมเป๊ะ (0/122 บัญชีวันที่ลง)', () => {
  const noCc = { role: 'supervisor', section: 'PD1', sections: ['PD1'], scopeIdx: IDX };
  assert.equal(canWriteUnit(noCc, 'PD1').ok, true);
  assert.equal(canWriteUnit(noCc, 'BIG PRESS').ok, false);   // แกนข้อความ: ชื่อไม่ตรง = ไม่ใช่ของเรา
  assert.equal(canWriteUnit(noCc, 'PD2').ok, false);
});

test('🔁 ตั้ง CC แต่จอไม่ได้ส่งดัชนีผัง = ถอยไปแกนเดิม ห้ามบล็อกมั่ว', () => {
  const noIdx = { role: 'supervisor', section: 'PD1', sections: ['PD1'], respCostCenters: ['2140561001'] };
  assert.equal(canWriteUnit(noIdx, 'PD1').ok, true);
});

test('🔴 ตั้ง CC ไว้แต่อ่านผังไม่สำเร็จ = fail-closed + บอกเหตุได้', () => {
  const broken = { role: 'supervisor', section: 'PD1', sections: ['PD1'],
    respCostCenters: ['2140561001'], scopeIdx: { failed: true } };
  const r = canWriteUnit(broken, 'PD1');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'scope_unreadable');
  assert.match(writeBlockText(r, { what: 'ใบนี้' }), /ผังองค์กร/);
});

test('🔴 ชื่อหน่วยที่ผังไม่รู้จัก = ถอยไปแกนเดิม (ทะเบียนเก่าเก็บข้อความนอกผังไว้เยอะ)', () => {
  assert.equal(canWriteUnit(HEAD_BP, 'หน่วยที่เลิกใช้แล้ว').ok, false);   // แกนเดิม: ไม่ตรง PD1 = บล็อก
  const bpHome = { ...HEAD_BP, section: 'BIG PRESS', sections: ['BIG PRESS'] };
  assert.equal(canWriteUnit(bpHome, 'หน่วยที่เลิกใช้แล้ว').ok, false);
  assert.equal(canWriteUnit(bpHome, 'BIG PRESS').ok, true);
});

test('ของกลาง (target ว่าง) — พฤติกรรมเดิมทุกกรณี แม้ตั้ง CC แล้ว', () => {
  assert.equal(canWriteUnit(HEAD_PD1, null).ok, true);                              // default allow
  assert.equal(canWriteUnit(HEAD_PD1, null, { unknownTarget: 'block' }).ok, false); // จอที่ขอ block
});

test('ใบผ่าน scope:all_units ชนะทุกแกน', () => {
  const qa = { role: 'qa', section: 'QA', sections: null, allUnits: true,
    respCostCenters: ['2140561001'], scopeIdx: IDX };
  assert.equal(canWriteUnit(qa, 'PD2').ok, true);
  assert.equal(canWriteLine(qa, 'ASSY 1', LINES).ok, true);
});

test('writableRows กรองด้วยแกน CC ได้ (จอที่ซ่อนปุ่มตามแถว)', () => {
  const rows = [{ sec: 'BIG PRESS' }, { sec: 'SMALL PRESS' }, { sec: 'ASSY A-GM' }];
  const keep = writableRows(HEAD_BP, rows, r => r.sec);
  assert.deepEqual(keep.map(r => r.sec), ['BIG PRESS']);
});
