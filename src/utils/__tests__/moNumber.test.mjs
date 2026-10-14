import test from 'node:test';
import assert from 'node:assert/strict';
import { MONTHLY_TEAM_KEYS, moFormatOf, moCodeOf, moSeqKeyOf, moNoOf } from '../moNumber.js';

/* 🕐 ตรึงเวลาเสมอ — `npm test` รัน 2 รอบ (ปกติ + นาฬิกา +400 วัน)
   ตัวที่อ่าน Date.now() เองจะผ่านวันนี้แล้วตกเองวันหลังโดยไม่มี commit ไหนทำ */
const AT = Date.parse('2026-10-14T03:30:00Z');        // = 14/10/2026 10:30 เวลาไทย
const TEAM = {
  mtn: { key: 'maintenance', mo_code: 'MTN' },
  jig: { key: 'jig_maintenance', mo_code: 'JIG' },
  die: { key: 'die_maintenance', mo_code: 'DIE' },
  prd: { key: 'production', mo_code: 'PRO' },
};

test('ทีม MTN = เลขรีเซ็ตรายเดือน · ทีมอื่น = นับต่อเนื่อง', () => {
  assert.equal(moFormatOf('maintenance'), 'monthly');
  for (const k of ['jig_maintenance', 'die_maintenance', 'production', '', null]) {
    assert.equal(moFormatOf(k), 'running', `${k} ต้องเป็นแบบต่อเนื่อง`);
  }
  assert.deepEqual([...MONTHLY_TEAM_KEYS], ['maintenance'], 'เพิ่มทีมที่นี่ = ต้องเพิ่มใน SQL ด้วย');
});

test('เลขที่ได้ ต้องตรงกับของจริงที่ออกไปแล้วบนฐาน (วัด 14/10)', () => {
  // MTN: ตัวนับเดือน 10 = 14 ⇒ ใบถัดไป 15
  assert.equal(moNoOf(TEAM.mtn, 15, { at: AT }), 'MTN.2026/10-15');
  // JIG: ตัวนับ 13 ⇒ ใบถัดไป 14 · รูปแบบเดิม
  assert.equal(moNoOf(TEAM.jig, 14, { at: AT }), 'JIG-BM-141026-0014');
  assert.equal(moNoOf(TEAM.die, 15, { at: AT }), 'DIE-BM-141026-0015');
  // PRODUCTION: 🔴 ต้องเป็น PRO ไม่ใช่ PRD — ออกไปแล้ว 708 ใบ เปลี่ยนรหัส = เลขรีสตาร์ท
  assert.equal(moNoOf(TEAM.prd, 709, { at: AT }), 'PRO-BM-141026-0709');
  // ประเภทงานซ่อมเปลี่ยน prefix ได้ (เฉพาะแบบต่อเนื่อง)
  assert.equal(moNoOf(TEAM.prd, 709, { at: AT, prefix: 'QC' }), 'PRO-QC-141026-0709');
});

test('คีย์ตัวนับ — รายเดือนต้องมี :YYYYMM ต่อท้าย (ไม่งั้นกรอกเลขลงคีย์ผิด = ไม่มีผล)', () => {
  assert.equal(moSeqKeyOf(TEAM.mtn, AT), 'MTN:202610');
  assert.equal(moSeqKeyOf(TEAM.jig, AT), 'JIG');
  // ข้ามเดือน = คนละตัวนับ ⇒ เลขรีเซ็ตเองโดยไม่ต้องมีใครกด
  assert.equal(moSeqKeyOf(TEAM.mtn, Date.parse('2026-11-01T00:00:00Z')), 'MTN:202611');
});

test('🔴 เส้นแบ่งเดือนใช้เวลาไทย ไม่ใช่ UTC', () => {
  // 31/10 23:30 เวลาไทย = 31/10 16:30Z — ยังเป็นเดือน 10
  assert.equal(moSeqKeyOf(TEAM.mtn, Date.parse('2026-10-31T16:30:00Z')), 'MTN:202610');
  // 01/11 00:30 เวลาไทย = 31/10 17:30Z — UTC ยังเป็นเดือน 10 แต่ไทยขึ้นเดือน 11 แล้ว
  assert.equal(moSeqKeyOf(TEAM.mtn, Date.parse('2026-10-31T17:30:00Z')), 'MTN:202611');
  assert.equal(moNoOf(TEAM.mtn, 1, { at: Date.parse('2026-10-31T17:30:00Z') }), 'MTN.2026/11-1');
  // วันในเลขแบบต่อเนื่องก็ต้องเป็นวันไทย
  assert.equal(moNoOf(TEAM.jig, 1, { at: Date.parse('2026-10-31T17:30:00Z') }), 'JIG-BM-011126-0001');
});

test('รหัสทีมที่ยังไม่ตั้ง = ถอยไป 3 ตัวแรกของ key (ต้องตรงกับกฎใน SQL)', () => {
  assert.equal(moCodeOf({ key: 'production', mo_code: null }), 'PRO');
  assert.equal(moCodeOf({ key: 'jig_maintenance' }), 'JIG');
  assert.equal(moCodeOf({ key: 'maintenance', mo_code: '' }), 'MAI');
  assert.equal(moCodeOf({ key: 'cnc shop' }), 'CNC', 'SQL ตัดช่องว่างออกก่อน — JS ต้องตัดด้วย');
  assert.equal(moCodeOf({}), 'MTN', 'ไม่รู้อะไรเลย = MTN เหมือน SQL');
  assert.equal(moCodeOf({ key: 'production', mo_code: 'prd' }), 'PRD', 'ทะเบียนชนะ + พิมพ์ใหญ่เสมอ');
});

test('🔴 อ่านเวลาไม่ออก = null ห้ามคืนสตริงมั่ว (จอต้องขึ้นว่าตัดสินไม่ได้)', () => {
  for (const bad of [null, undefined, '', 'พรุ่งนี้', NaN]) {
    assert.equal(moSeqKeyOf(TEAM.mtn, bad), null, `moSeqKeyOf(${bad}) ต้องเป็น null`);
    assert.equal(moNoOf(TEAM.mtn, 1, { at: bad }), null, `moNoOf(${bad}) ต้องเป็น null`);
  }
  // ทีมแบบต่อเนื่องยังตอบคีย์ได้ (ไม่ต้องรู้เวลา) — คนละเรื่องกับเลข
  assert.equal(moSeqKeyOf(TEAM.jig, null), 'JIG');
  assert.equal(moNoOf(TEAM.jig, 1, { at: null }), null);
  assert.equal(moNoOf(TEAM.jig, 'x', { at: AT }), null, 'เลขที่ไม่ใช่ตัวเลข = null');
});
