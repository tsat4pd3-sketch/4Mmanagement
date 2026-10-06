import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mailsMissingFiles, subjectKinds, mailFileKind, periodStartMs } from '../mailInbox.js';

test('หัวเรื่องบอก 830 & 862 แต่ได้แค่ 830 → ขาด 862 (เคสจริง 05/10)', () => {
  const r = mailsMissingFiles([
    { message_id: 'm3', subject: 'FTM_AAT_ 830 & 862_05.10.2026', file_name: '830_05.10.26.xlsm', received_at: '2026-10-05T01:02:14Z' },
    { message_id: 'm1', subject: 'FTM_AAT_ 830 & 862_30.09.2026', file_name: '830_28.09.26.xlsm', received_at: '2026-09-30T01:10:41Z' },
    { message_id: 'm1', subject: 'FTM_AAT_ 830 & 862_30.09.2026', file_name: '862_30.09.26.xlsm', received_at: '2026-09-30T01:10:41Z' },
  ]);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].missing, ['862']);
  assert.deepEqual(r[0].got, ['830']);
});

test('ตัวเลขในวันที่/เลขอื่นไม่ถูกนับเป็นชนิด · หัวเรื่องไม่ระบุ = ไม่เตือน', () => {
  assert.deepEqual(subjectKinds('report 18620 / 8300'), []);
  assert.deepEqual(subjectKinds('FTM_AAT_ 830 & 862_02.10.2026').sort(), ['830', '862']);
  assert.deepEqual(mailsMissingFiles([{ message_id: 'x', subject: 'Forecast', file_name: '830_x.xlsm' }]), []);
  assert.equal(mailFileKind('862 05.10.26.xlsm'), '862');
});

/* 06/10 คำสั่ง user: 830 มาแค่ต้นสัปดาห์ · หลังไฟล์แรกของสัปดาห์ ได้แต่ 862 = ปกติ */
const REAL = [
  { message_id: 'm1', subject: 'FTM_AAT_ 830 & 862_30.09.2026', file_name: '830_28.09.26.xlsm', received_at: '2026-09-30T01:10:41Z' },
  { message_id: 'm1', subject: 'FTM_AAT_ 830 & 862_30.09.2026', file_name: '862_30.09.26.xlsm', received_at: '2026-09-30T01:10:41Z' },
  { message_id: 'm2', subject: 'FTM_AAT_ 830 & 862_02.10.2026', file_name: '862_02.10.26.xlsm', received_at: '2026-10-02T01:05:00Z' },
  { message_id: 'm3', subject: 'FTM_AAT_ 830 & 862_05.10.2026', file_name: '830_05.10.26.xlsm', received_at: '2026-10-05T01:02:14Z' },
  { message_id: 'm4', subject: 'FTM_AAT_ 830 & 862_06.10.2026', file_name: '862_06.10.26.xlsm', received_at: '2026-10-06T01:02:00Z' },
];

test('830 มีแล้วในสัปดาห์เดียวกัน → วันอื่นได้แต่ 862 ไม่เตือน', () => {
  const r = mailsMissingFiles(REAL);
  assert.deepEqual(r.map(x => x.message_id), ['m3']);       // เหลือแค่ 05/10 ที่ขาด 862 จริง
});

test('862 ที่คนนำเข้าเองวันเดียวกัน = ได้ของแล้ว ไม่เตือน', () => {
  const r = mailsMissingFiles(REAL, { imports: [{ kind: '862', at: '2026-10-05T03:37:50Z' }] });
  assert.deepEqual(r, []);
});

test('เมลแรกของสัปดาห์ไม่มี 830 = ยังเตือน (830 สัปดาห์ก่อนไม่นับ)', () => {
  const r = mailsMissingFiles([
    { message_id: 'a', subject: 'FTM_AAT_ 830 & 862_28.09.2026', file_name: '830_28.09.26.xlsm', received_at: '2026-09-28T01:00:00Z' },
    { message_id: 'b', subject: 'FTM_AAT_ 830 & 862_05.10.2026', file_name: '862_05.10.26.xlsm', received_at: '2026-10-05T01:00:00Z' },
  ]);
  assert.deepEqual(r.find(x => x.message_id === 'b')?.missing, ['830']);
});

test('ขอบสัปดาห์ตามเวลาไทย — จันทร์ 06:00 ไทย (อาทิตย์ 23:00 UTC) อยู่สัปดาห์ใหม่', () => {
  const t = Date.parse('2026-10-04T23:00:00Z');
  assert.equal(periodStartMs(t, 'week'), Date.parse('2026-10-04T17:00:00Z'));
  assert.equal(periodStartMs(t, 'day'), Date.parse('2026-10-04T17:00:00Z'));
  assert.equal(periodStartMs(Date.parse('2026-10-07T05:00:00Z'), 'week'), Date.parse('2026-10-04T17:00:00Z'));
});
