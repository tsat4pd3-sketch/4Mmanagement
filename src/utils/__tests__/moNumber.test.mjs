import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MONTHLY_TEAM_KEYS, TEAM_MO_FORMAT, moFormatOf, moCodeOf, moSeqKeyOf, moMonthKeyOf, moNoOf,
} from '../moNumber.js';

/* 🕐 ตรึงเวลาเสมอ — `npm test` รัน 2 รอบ (ปกติ + นาฬิกา +400 วัน)
   ตัวที่อ่าน Date.now() เองจะผ่านวันนี้แล้วตกเองวันหลังโดยไม่มี commit ไหนทำ */
const AT = Date.parse('2026-10-14T03:30:00Z');        // = 14/10/2026 10:30 เวลาไทย
const TEAM = {
  mtn: { key: 'maintenance', mo_code: 'MTN' },
  jig: { key: 'jig_maintenance', mo_code: 'JIG' },
  die: { key: 'die_maintenance', mo_code: 'DIE' },
  prd: { key: 'production', mo_code: 'PRO' },
};

test('รูปแบบต่อทีม — MTN รายเดือน (มี O- นำหน้า) · ที่เหลือต่อเนื่อง + หางลำดับเดือน', () => {
  assert.equal(moFormatOf('maintenance'), 'monthly');
  for (const k of ['jig_maintenance', 'die_maintenance', 'production', '', null]) {
    assert.equal(moFormatOf(k), 'running', `${k} ต้องเป็นแบบต่อเนื่อง`);
  }
  assert.deepEqual([...MONTHLY_TEAM_KEYS], ['maintenance'], 'เพิ่มทีมที่นี่ = ต้องเพิ่มใน SQL ด้วย');
  assert.equal(TEAM_MO_FORMAT.maintenance.mark, 'O-', 'O- = ออกจากระบบ (ชั่วคราวระหว่างเลิกเล่มมือ)');
});

test('🔴 เลขที่ได้ — ของเดิมอยู่ครบ แค่ต่อหางลำดับเดือน (คำสั่ง user: ไม่เอาของเดิมออก)', () => {
  // ใบรันสะสมที่ 14 ของทีม JIG · เป็นใบที่ 8 ของเดือน ต.ค.
  assert.equal(moNoOf(TEAM.jig, { seq: 14, monthSeq: 8, at: AT }), 'JIG-BM-141026-0014-M8');
  // วันที่ (141026) + ประเภทงาน (PM) ยังอยู่ในเลข — นี่คือสิ่งที่ "ห้ามเอาออก"
  assert.equal(moNoOf(TEAM.die, { seq: 15, monthSeq: 5, at: AT, prefix: 'PM' }), 'DIE-PM-141026-0015-M5');
  // PRODUCTION ได้ด้วย โดยไม่ต้องแตะ 670 ใบเก่า (ตัวนับเดิมไม่ถูกรีเซ็ต)
  assert.equal(moNoOf(TEAM.prd, { seq: 712, monthSeq: 174, at: AT }), 'PRO-BM-141026-0712-M174');
});

test('ทีม MTN — O- นำหน้า · ไม่ต่อหาง (ลำดับเดือนอยู่ในเลขอยู่แล้ว)', () => {
  assert.equal(moNoOf(TEAM.mtn, { seq: 16, at: AT }), 'O-MTN.2026/10-16');
  assert.equal(moNoOf(TEAM.mtn, { seq: 16, monthSeq: 99, at: AT }), 'O-MTN.2026/10-16',
    'ส่ง monthSeq มาก็ต้องไม่ต่อหางซ้ำ');
  assert.equal(moMonthKeyOf(TEAM.mtn, AT), null, 'ทีมที่ไม่ต่อหาง ต้องไม่มีตัวนับลำดับเดือน');
});

test('🔴 ไม่รู้ลำดับเดือน = ไม่ต่อหาง (ไม่ใช่คืน null) — ใบยังต้องมีเลขเสมอ', () => {
  assert.equal(moNoOf(TEAM.jig, { seq: 14, at: AT }), 'JIG-BM-141026-0014');
  assert.equal(moNoOf(TEAM.jig, { seq: 14, monthSeq: null, at: AT }), 'JIG-BM-141026-0014');
  assert.equal(moNoOf(TEAM.jig, { seq: 14, monthSeq: 'x', at: AT }), 'JIG-BM-141026-0014');
  // 🔴 `Number(null) === 0` — เคยหลุดเป็นหาง `-M0` = เลขที่โกหกว่า "ใบที่ 0 ของเดือน"
  assert.equal(moNoOf(TEAM.jig, { seq: 14, monthSeq: 0, at: AT }), 'JIG-BM-141026-0014');
  assert.equal(moNoOf(TEAM.jig, { seq: 14, monthSeq: '', at: AT }), 'JIG-BM-141026-0014');
});

test('คีย์ตัวนับ — หลัก vs ลำดับเดือน ต้องคนละคีย์ ห้ามชนกัน', () => {
  assert.equal(moSeqKeyOf(TEAM.mtn, AT), 'MTN:202610');
  assert.equal(moSeqKeyOf(TEAM.jig, AT), 'JIG', 'ตัวนับหลักของทีมต่อเนื่อง = รหัสทีมเฉยๆ');
  assert.equal(moMonthKeyOf(TEAM.jig, AT), 'JIG:M202610');
  assert.notEqual(moMonthKeyOf(TEAM.jig, AT), moSeqKeyOf(TEAM.jig, AT));
  // ข้ามเดือน = คนละตัวนับ ⇒ หางรีเซ็ตเองโดยไม่ต้องมีใครกด · ตัวนับหลักไม่รีเซ็ต
  assert.equal(moMonthKeyOf(TEAM.jig, Date.parse('2026-11-01T01:00:00Z')), 'JIG:M202611');
  assert.equal(moSeqKeyOf(TEAM.jig, Date.parse('2026-11-01T01:00:00Z')), 'JIG');
});

test('🔴 เส้นแบ่งเดือนใช้เวลาไทย ไม่ใช่ UTC', () => {
  // 31/10 23:30 ไทย = 31/10 16:30Z — ยังเดือน 10
  assert.equal(moMonthKeyOf(TEAM.jig, Date.parse('2026-10-31T16:30:00Z')), 'JIG:M202610');
  // 01/11 00:30 ไทย = 31/10 17:30Z — UTC ยังเดือน 10 แต่ไทยขึ้นเดือน 11 แล้ว
  assert.equal(moMonthKeyOf(TEAM.jig, Date.parse('2026-10-31T17:30:00Z')), 'JIG:M202611');
  assert.equal(moSeqKeyOf(TEAM.mtn, Date.parse('2026-10-31T17:30:00Z')), 'MTN:202611');
  assert.equal(moNoOf(TEAM.mtn, { seq: 1, at: Date.parse('2026-10-31T17:30:00Z') }), 'O-MTN.2026/11-1');
  assert.equal(moNoOf(TEAM.jig, { seq: 1, monthSeq: 1, at: Date.parse('2026-10-31T17:30:00Z') }),
    'JIG-BM-011126-0001-M1');
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
    assert.equal(moMonthKeyOf(TEAM.jig, bad), null, `moMonthKeyOf(${bad}) ต้องเป็น null`);
    assert.equal(moNoOf(TEAM.mtn, { seq: 1, at: bad }), null, `moNoOf(${bad}) ต้องเป็น null`);
  }
  assert.equal(moSeqKeyOf(TEAM.jig, null), 'JIG', 'ตัวนับหลักของทีมต่อเนื่องไม่ต้องรู้เวลา');
  assert.equal(moNoOf(TEAM.jig, { seq: 'x', at: AT }), null, 'เลขที่ไม่ใช่ตัวเลข = null');
});

test('ใบเก่าที่ไม่มีหาง ยังแยกออกจากใบใหม่ได้ (ไม่ต้อง migrate ข้อมูลเก่า)', () => {
  const เก่า = 'JIG-BM-180926-0007';
  const ใหม่ = moNoOf(TEAM.jig, { seq: 14, monthSeq: 8, at: AT });
  assert.ok(!เก่า.includes('-M'), 'ใบเก่าต้องไม่มีหาง');
  assert.ok(ใหม่.startsWith('JIG-BM-'), 'ส่วนหน้าเหมือนเดิม ⇒ ค้นหาด้วยคำเดิมยังเจอ');
  assert.ok(ใหม่.includes('0014'), 'ค้นด้วยเลขรันเดิมยังเจอ');
});
