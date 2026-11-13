import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normBadgeCode, findByBadge, markPresentRecord, badgeScanOutcome } from '../badgeCheckin.js';

const emps = [
  { id: 1, employee_id_code: '2101864', name: 'A' },
  { id: 2, employee_id_code: '21018640', name: 'B' },
  { id: 3, employee_id_code: 'abc1234', name: 'C' },
  { id: 4, employee_id_code: 'TSAT-SUB-01', name: 'D' },
];

test('QR บนบัตร = รหัสพนักงานล้วน → จับคู่ตรงเป๊ะ (ไม่ใช่ "มีเลขนี้อยู่ข้างใน")', () => {
  assert.equal(findByBadge(emps, '2101864')?.id, 1);
  assert.equal(findByBadge(emps, '210186'), null);
  assert.equal(findByBadge(emps, '2101864\r\n')?.id, 1, 'Enter/CR ท้ายจากเครื่องสแกน');
});

test('ตัวพิมพ์/ขีด/ช่องว่างไม่มีผล', () => {
  assert.equal(findByBadge(emps, 'ABC1234')?.id, 3);
  assert.equal(findByBadge(emps, 'tsat sub 01')?.id, 4);
  assert.equal(normBadgeCode(' tsat-sub-01 '), 'TSATSUB01');
});

test('🔴 รหัสซ้ำในทะเบียน = ไม่เดา', () => {
  assert.equal(findByBadge([...emps, { id: 9, employee_id_code: '2101864' }], '2101864'), null);
});

test('ลาเต็มวันแล้วมาสแกน = มาจริง ล้างการลา · ลาครึ่งวันคงไว้', () => {
  assert.deepEqual(markPresentRecord({ is_present: false, leave_type: 'ลาป่วย', leave_duration: 'full', has_helmet: true }),
    { is_present: true, leave_type: '', leave_duration: '', leave_period: '', leave_hours: '', has_helmet: true });
  assert.deepEqual(markPresentRecord({ is_present: true, leave_type: 'ลากิจ', leave_duration: 'half' }),
    { is_present: true, leave_type: 'ลากิจ', leave_duration: 'half' });
});

test('ผลการสแกน 4 แบบ', () => {
  const displayedIds = new Set([1, 3]);
  const attendance = { 1: { is_present: false }, 3: { is_present: true } };
  assert.equal(badgeScanOutcome({ employees: emps, displayedIds, attendance, raw: '2101864' }).kind, 'marked');
  assert.equal(badgeScanOutcome({ employees: emps, displayedIds, attendance, raw: 'ABC1234' }).kind, 'already');
  assert.equal(badgeScanOutcome({ employees: emps, displayedIds, attendance, raw: '21018640' }).kind, 'not_shown', 'มีในทะเบียนแต่ไม่อยู่ในรายชื่อที่แสดง = ไม่ติ๊กให้');
  assert.equal(badgeScanOutcome({ employees: emps, displayedIds, attendance, raw: '9999999' }).kind, 'unknown');
});
