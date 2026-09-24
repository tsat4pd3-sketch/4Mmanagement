/* 👔 รักษาการ / หัวหน้าหน่วย — สถานะต้องคิดจากวันที่ ไม่ใช่จาก cron    2026-09-24
 *
 * บั๊กที่ด่านนี้กัน:
 *  1. **อ่านนาฬิกาข้างในฟังก์ชันโดยไม่เปิดให้ส่งค่า** ⇒ เทสระเบิดเวลา
 *     (`npm test` รันรอบ "นาฬิกา +400 วัน" ด้วย — เทสที่ตรึงวันไม่ได้จะตกเองวันหลัง)
 *  2. **รักษาการที่ไม่มีวันสิ้นสุด ถูกนับเป็น "ปกติ"** ⇒ สิทธิ์ชั่วคราวกลายเป็นถาวรเงียบๆ
 *     ผังจริง ORG-001 Rev.09 ไม่ได้เขียนวันสิ้นสุดไว้เลยสักใบ ทั้งที่ 7/14 ส่วนเป็นรักษาการ
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignmentStatus, isGranting, needsEndDate, needsConfirm,
         expiringWithin, reviewSummary, todayLocal } from '../orgAssignments.js';

const TODAY = '2026-09-24';   // ตรึงวันเสมอ — ห้ามพึ่งนาฬิกาเครื่อง

test('🔴 รักษาการที่ไม่มีวันสิ้นสุด = สถานะแยกต่างหาก ไม่ใช่ "ปกติ"', () => {
  const acting = { kind: 'acting', ends_on: null };
  assert.equal(assignmentStatus(acting, TODAY), 'open_ended');
  assert.equal(needsEndDate(acting), true, 'ต้องเข้าคิวตามเก็บ');
  // หัวหน้าตัวจริงไม่มีวันสิ้นสุด = เรื่องปกติ ห้ามฟ้อง
  const head = { kind: 'head', ends_on: null };
  assert.equal(assignmentStatus(head, TODAY), 'active');
  assert.equal(needsEndDate(head), false);
});

test('หมดอายุแล้ว = ไม่ให้ขอบเขตอีก (คิดตอนอ่าน ไม่ต้องมี cron)', () => {
  const past = { kind: 'acting', ends_on: '2026-09-23' };
  assert.equal(assignmentStatus(past, TODAY), 'expired');
  assert.equal(isGranting(past, TODAY), false, 'หมดอายุแล้วต้องไม่ให้สิทธิ์ ต่อให้ไม่มี cron มาปิด');
  // วันสุดท้ายยังนับว่ามีผล
  assert.equal(assignmentStatus({ kind: 'acting', ends_on: TODAY }, TODAY), 'active');
});

test('ยังไม่ถึงวันเริ่ม = ยังไม่ให้สิทธิ์', () => {
  const future = { kind: 'acting', starts_on: '2026-10-01', ends_on: '2026-12-31' };
  assert.equal(assignmentStatus(future, TODAY), 'future');
  assert.equal(isGranting(future, TODAY), false);
});

test('⏱️ ส่งวันเข้าไปได้ — ไม่งั้นเทสจะตกเองในอนาคต', () => {
  const row = { kind: 'acting', ends_on: '2026-12-31' };
  assert.equal(assignmentStatus(row, '2026-06-01'), 'active');
  assert.equal(assignmentStatus(row, '2027-01-01'), 'expired',
    'ปีหน้าต้องหมดอายุ — พิสูจน์ว่าฟังก์ชันใช้ค่าที่ส่งเข้าไป ไม่ใช่นาฬิกาเครื่อง');
});

test('todayLocal ต้องเป็นเวลาท้องถิ่น ไม่ใช่ UTC', () => {
  // 2026-09-24 07:00 ไทย → toISOString() จะได้ 2026-09-24T00:00Z (ยังตรง)
  // แต่ 2026-09-24 01:00 ไทย → UTC = 2026-09-23 ⇒ วันเพี้ยน
  const d = new Date(2026, 8, 24, 1, 0, 0);   // local 01:00
  assert.equal(todayLocal(d), '2026-09-24');
});

test('เตือนล่วงหน้าก่อนหมดอายุ', () => {
  assert.equal(expiringWithin({ ends_on: '2026-10-10' }, 30, TODAY), true);
  assert.equal(expiringWithin({ ends_on: '2026-12-31' }, 30, TODAY), false, 'ยังอีกนาน');
  assert.equal(expiringWithin({ ends_on: '2026-09-01' }, 30, TODAY), false, 'หมดไปแล้ว ไม่ใช่ "ใกล้หมด"');
  assert.equal(expiringWithin({ ends_on: null }, 30, TODAY), false, 'ไม่มีวันจบ = คนละปัญหา');
});

test('ระบบใส่ให้จากผัง = ต้องมีคนยืนยัน', () => {
  assert.equal(needsConfirm({ source: 'org_chart_rev09', confirmed_at: null }), true);
  assert.equal(needsConfirm({ source: 'org_chart_rev09', confirmed_at: '2026-09-24' }), false);
  assert.equal(needsConfirm({ source: 'manual', confirmed_at: null }), false, 'คนกรอกเอง = ยืนยันในตัวแล้ว');
});

test('สรุปคิวทบทวน — แยกแต่ละปัญหาออกจากกัน', () => {
  const rows = [
    { kind: 'acting', ends_on: null,         source: 'org_chart_rev09', confirmed_at: null },
    { kind: 'acting', ends_on: '2026-09-01', source: 'manual' },
    { kind: 'acting', ends_on: '2026-10-05', source: 'manual' },
    { kind: 'head',   ends_on: null,         source: 'manual' },
  ];
  const s = reviewSummary(rows, { today: TODAY });
  assert.equal(s.total, 4);
  assert.equal(s.openEnded.length, 1,  'รักษาการไม่มีวันจบ 1 (หัวหน้าตัวจริงไม่นับ)');
  assert.equal(s.expired.length, 1);
  assert.equal(s.expiring.length, 1);
  assert.equal(s.unconfirmed.length, 1);
});
