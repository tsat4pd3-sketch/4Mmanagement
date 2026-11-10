import test from 'node:test';
import assert from 'node:assert/strict';
import { SLOC_RE, slocLabel, slocValid, slocKindGuess, slocKindMeta, SLOC_KINDS, slocOfLine, slocCodeOfLine, linesOfSloc } from '../storageLoc.js';

/* รูปแบบที่ user กำหนดเอง 2026-09-02:
   ตัวอักษร 1-3 ตัว + เลข 3 หลัก · S=สโตร์ชิ้นส่วน P=ผลิต W=warehouse R=วัตถุดิบ */

test('slocLabel — ตัวพิมพ์ใหญ่ + ตัดช่องว่าง (user พิมพ์ s401 ต้องได้ S401)', () => {
  assert.equal(slocLabel(' s401 '), 'S401');
  assert.equal(slocLabel('p402'), 'P402');
  assert.equal(slocLabel(null), '');
  assert.equal(slocLabel('   '), '');
});

test('รหัสตามรูปแบบที่ใช้จริงต้องผ่านทั้ง 5 ตัว', () => {
  ['S401', 'P401', 'P402', 'W401', 'R401'].forEach(c => {
    assert.equal(SLOC_RE.test(c), true, c);
    assert.equal(slocValid(c), true, c);
  });
  assert.equal(slocValid('s401'), true);        // normalize ก่อนตรวจ
  assert.equal(slocValid('JG401'), true);       // 2 ตัวอักษรก็ได้ (เผื่อพื้นที่ใหม่)
});

test('🔴 รหัสผิดรูปแบบต้องไม่ผ่าน — นี่คือด่านกันพิมพ์ผิด', () => {
  assert.equal(slocValid('401'), false);        // ไม่มีตัวอักษรนำ
  assert.equal(slocValid('S4011'), false);      // เลขเกิน 3 หลัก
  assert.equal(slocValid('S40'), false);        // เลขไม่ครบ
  assert.equal(slocValid('STORE'), false);      // ไม่มีเลข
  assert.equal(slocValid('S-401'), false);      // มีขีด
  assert.equal(slocValid('SLOC401'), false);    // ตัวอักษรเกิน 3
});

test('⚪ ว่าง = "ยังไม่ระบุ" ต้องผ่าน ไม่ใช่ error (ไม่กรอกก็ใช้พฤติกรรมเดิมได้)', () => {
  assert.equal(slocValid(''), true);
  assert.equal(slocValid(null), true);
  assert.equal(slocValid(undefined), true);
  assert.equal(slocValid('  '), true);
});

test('slocKindGuess — เดาชนิดจากตัวอักษรนำหน้าตามธรรมเนียมที่วางไว้', () => {
  assert.equal(slocKindGuess('S401'), 'store_part');
  assert.equal(slocKindGuess('p401'), 'production');   // normalize ก่อนเดา
  assert.equal(slocKindGuess('P402'), 'production');
  assert.equal(slocKindGuess('W401'), 'warehouse');
  assert.equal(slocKindGuess('R401'), 'raw');
});

test('🔴 เดาไม่ได้ต้องคืน null ไม่ใช่ "other" — ไม่รู้ ≠ ไม่เข้าพวก', () => {
  assert.equal(slocKindGuess('X401'), null);    // ตัวอักษรที่ยังไม่มีความหมาย
  assert.equal(slocKindGuess('JG401'), null);
  assert.equal(slocKindGuess('บ้าง'), null);
  assert.equal(slocKindGuess(''), null);
  assert.equal(slocKindGuess(null), null);
});

test('slocKindMeta — ชนิดที่ไม่รู้จักต้องไม่พัง (คืนค่ากลาง)', () => {
  assert.equal(slocKindMeta('raw').label, SLOC_KINDS.raw.label);
  assert.equal(slocKindMeta('ไม่มีชนิดนี้').label, SLOC_KINDS.other.label);
  assert.equal(slocKindMeta(null).label, SLOC_KINDS.other.label);
  // ทุกชนิดต้องมี label/icon/color ครบ (จอพึ่ง 3 ค่านี้)
  Object.entries(SLOC_KINDS).forEach(([k, v]) => {
    assert.ok(v.label && v.icon && v.color, k);
  });
});

/* ── ไลน์ → SLoc (2026-09-08): ผูกที่ไลน์แม่ครั้งเดียว ลูกตกทอด · ยังไม่ผูก = null ห้ามเดา ── */
const LINES = [
  { name: 'LINE APRON ASSY', parent_line_name: null }, { name: 'Line 60', parent_line_name: 'LINE APRON ASSY' },
  { name: 'Line 61', parent_line_name: 'LINE APRON ASSY' }, { name: 'SUB APRON', parent_line_name: 'LINE APRON ASSY' },
  { name: 'HYDROFORM', parent_line_name: null }, { name: 'HDF1', parent_line_name: 'HYDROFORM' },
  { name: 'LINE B', parent_line_name: null }, { name: 'STORE', parent_line_name: null },
];
const SLOCS = [
  { code: 'P411', line_names: ['LINE APRON ASSY'], is_active: true },
  { code: 'P409', line_names: ['HYDROFORM'], is_active: true },
  { code: 'S401', line_names: ['STORE'], is_active: true },
  { code: 'X999', line_names: ['LINE B'], is_active: false },
];
test('slocOfLine — ไลน์ลูกตกทอดจากแม่ · Line 60/61/Sub ทั้งหมด = P411 · via บอกว่าผูกที่ไหน', () => {
  assert.equal(slocCodeOfLine(SLOCS, LINES, 'Line 60'), 'P411');
  assert.equal(slocCodeOfLine(SLOCS, LINES, 'Line 61'), 'P411');
  assert.equal(slocCodeOfLine(SLOCS, LINES, 'SUB APRON'), 'P411');
  assert.equal(slocOfLine(SLOCS, LINES, 'Line 60').via, 'LINE APRON ASSY');
  assert.equal(slocCodeOfLine(SLOCS, LINES, 'HDF1'), 'P409');
  assert.equal(slocCodeOfLine(SLOCS, LINES, 'STORE'), 'S401');
});
test('🔴 ยังไม่ผูก / ผูกกับ SLoc ที่ปิด = null ไม่ใช่เดา', () => {
  assert.equal(slocCodeOfLine(SLOCS, LINES, 'LINE B'), null);     // ผูกกับ X999 ที่ปิดใช้งาน
  assert.equal(slocCodeOfLine(SLOCS, LINES, 'ไม่มีไลน์นี้'), null);
  assert.equal(slocCodeOfLine(SLOCS, LINES, ''), null);
  assert.equal(slocCodeOfLine([{ code: 'P1', line_names: null }], LINES, 'Line 60'), null);   // แถวเก่าไม่มี line_names ไม่พัง
});
test('ไลน์ที่ผูก SLoc เองชนะแม่ · linesOfSloc รวมลูกหลานให้', () => {
  const S2 = [...SLOCS, { code: 'P412', line_names: ['SUB APRON'], is_active: true }];
  assert.equal(slocCodeOfLine(S2, LINES, 'SUB APRON'), 'P412');
  assert.deepEqual(linesOfSloc(S2, LINES, 'P411').sort(), ['LINE APRON ASSY', 'Line 60', 'Line 61']);
  assert.deepEqual(linesOfSloc(S2, LINES, 'p412'), ['SUB APRON']);
});

import { slocOfStockRow, homeSlocOf, isStockBucket } from '../storageLoc.js';
test('🏠 ที่จัดเก็บหลัก: กองคลังใช้ home_sloc ของพาร์ท · ไลน์ผลิตใช้ผูกไลน์ · ไม่ตั้ง = null (ไม่เดาจากเลข MAT)', () => {
  const slocs = [{ code: 'P401', line_names: ['LINE A'], is_active: true }, { code: 'S402', line_names: [], is_active: true },
                 { code: 'S401', line_names: ['STORE'], is_active: true }];
  const home = new Map([['20056789', 's402']]);
  assert.equal(slocOfStockRow(slocs, [], 'STORE', '20056789', home)?.code, 'S402');
  // กองคลังไม่สนการผูกไลน์ใน storage_locations อีก (ไม่ตั้ง = null แม้ S401 ยังผูก STORE ค้าง)
  assert.equal(slocOfStockRow(slocs, [], 'STORE', '50027079', home), null);
  assert.equal(slocOfStockRow(slocs, [], 'LINE A', '20056789', home)?.code, 'P401');
  assert.equal(isStockBucket(' fg warehouse '), true);
  assert.equal(homeSlocOf(null, 'x'), null);
});

import { areaLinesOf } from '../storageLoc.js';
test('📍 areaLinesOf: แม่-ลูกในพื้นที่ SAP เดียวกัน = ที่เดียวกัน · ไม่ผูก = ไลน์ตัวเอง', () => {
  const slocs = [{ code: 'P412', line_names: ['LWR BAR', 'Assy  LWR', 'Laser LWR'], is_active: true },
                 { code: 'P410', line_names: ['GOR'], is_active: true }];
  const lines = [{ name: 'GOR' }, { name: 'Assy GOR', parent_line_name: 'GOR' }, { name: 'Laser GOR', parent_line_name: 'GOR' }, { name: 'X' }];
  const a = areaLinesOf(slocs, lines, 'Laser LWR');
  assert.equal(a.code, 'P412'); assert.deepEqual([...a.lines].sort(), ['Assy  LWR', 'LWR BAR', 'Laser LWR'].sort());
  const g = areaLinesOf(slocs, lines, 'Laser GOR');
  assert.equal(g.code, 'P410'); assert.deepEqual([...g.lines].sort(), ['Assy GOR', 'GOR', 'Laser GOR']);
  assert.deepEqual(areaLinesOf(slocs, lines, 'X'), { code: null, lines: ['X'] });
});

import { parentAreaCovers } from '../storageLoc.js';
test('parentAreaCovers — แม่อยู่พื้นที่เดียวกับลูกอย่างน้อย 1 ตัว = หักได้ · แม่ไม่ผูก/พื้นที่ไม่มีลูก = ค้างจริง', () => {
  const slocs = [
    { code: 'P411', line_names: ['LINE APRON ASSY', 'Line 60', 'Line 61', 'SUB APRON'] },
    { code: 'P404', line_names: ['Line D1'] },
    { code: 'P413', line_names: ['Line D2'] },
    { code: 'P412', line_names: ['LWR BAR', 'Assy LWR'] },
  ];
  const lines = [
    { name: 'Line 60', parent_line_name: 'LINE APRON ASSY' }, { name: 'Line 61', parent_line_name: 'LINE APRON ASSY' },
    { name: 'SUB APRON', parent_line_name: 'LINE APRON ASSY' },
    { name: 'Line D1', parent_line_name: 'ASSY D' }, { name: 'Line D2', parent_line_name: 'ASSY D' },
    { name: 'Assy LWR', parent_line_name: 'LWR BAR' }, { name: 'Laser LWR', parent_line_name: 'LWR BAR' },
  ];
  assert.equal(parentAreaCovers(slocs, lines, 'LINE APRON ASSY'), true);
  assert.equal(parentAreaCovers(slocs, lines, 'ASSY D'), false);        // แม่ไม่ผูก + ลูกแยก 2 พื้นที่
  assert.equal(parentAreaCovers(slocs, lines, 'LWR BAR'), true);        // Assy LWR อยู่พื้นที่เดียวกัน (Laser LWR ไม่อยู่ ไม่เป็นไร)
  const slocs2 = [...slocs.slice(0, 2), { code: 'P413', line_names: ['Line D2', 'ASSY D'] }];
  assert.equal(parentAreaCovers(slocs2, lines, 'ASSY D'), true);        // แม่ผูก P413 คู่กับ D2 · D1 อยู่ P404 ตามที่ตั้ง
  assert.equal(parentAreaCovers([{ code: 'P999', line_names: ['ASSY D'] }], lines, 'ASSY D'), false); // พื้นที่ของแม่ไม่มีลูกเลย
  assert.equal(parentAreaCovers(slocs, lines, 'Line 60'), false);       // ไม่มีลูก
  assert.equal(parentAreaCovers(null, lines, 'LINE APRON ASSY'), false); // ไม่มีทะเบียน = ไม่รู้ = ไม่ซ่อน
});
