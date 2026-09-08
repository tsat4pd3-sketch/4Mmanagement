import test from 'node:test';
import assert from 'node:assert/strict';
import { currentWorkShift, isBorrowIntoScope } from '../lineHelpers.js';

/* 🤝 ยืมพนักงานข้ามไลน์ (line_helpers) — ล็อกกฎ 2 ข้อที่พลาดแล้วคนหายจากจอเงียบๆ:
   1) วัน+กะของ "การยืมที่ยังมีผลตอนนี้" ต้องใช้กฎ work date ไทย (ตัด 08:00) เหมือนทั้งระบบ
   2) ไลน์ปลายทางอยู่ใน scope ผู้ใช้ไหม — leader คิดด้วยไลน์ · role อื่นคิดด้วยส่วนงาน       */

const at = (y, m, d, h) => new Date(y, m - 1, d, h, 0, 0);

test('currentWorkShift — กะเช้า 08:00-19:59 ของวันเดียวกัน', () => {
  assert.deepEqual(currentWorkShift(at(2026, 9, 8, 8)),  { workDate: '2026-09-08', shift: 'day' });
  assert.deepEqual(currentWorkShift(at(2026, 9, 8, 19)), { workDate: '2026-09-08', shift: 'day' });
});

test('currentWorkShift — กะดึกก่อนเที่ยงคืนยังเป็นวันเดียวกัน', () => {
  assert.deepEqual(currentWorkShift(at(2026, 9, 8, 20)), { workDate: '2026-09-08', shift: 'night' });
  assert.deepEqual(currentWorkShift(at(2026, 9, 8, 23)), { workDate: '2026-09-08', shift: 'night' });
});

test('currentWorkShift — ตี 2 = ยังเป็นงานของ "เมื่อวาน" (กฎตัด 08:00 ห้ามใช้ toISOString)', () => {
  assert.deepEqual(currentWorkShift(at(2026, 9, 9, 2)), { workDate: '2026-09-08', shift: 'night' });
  assert.deepEqual(currentWorkShift(at(2026, 9, 9, 7)), { workDate: '2026-09-08', shift: 'night' });
  // 08:00 ตรง = ข้ามมาเป็นวันใหม่ กะเช้า
  assert.deepEqual(currentWorkShift(at(2026, 9, 9, 8)), { workDate: '2026-09-09', shift: 'day' });
});

test('currentWorkShift — ข้ามเดือน/ข้ามปีต้องถอยวันถูก (ห้ามใช้เลขวันลบตรงๆ)', () => {
  assert.equal(currentWorkShift(at(2026, 10, 1, 3)).workDate, '2026-09-30');
  assert.equal(currentWorkShift(at(2027, 1, 1, 3)).workDate, '2026-12-31');
});

const LINE_BY_ID = {
  10: { id: 10, name: 'LINE APRON ASSY', section: 'ASSY2' },
  20: { id: 20, name: 'TSRA',            section: 'ASSY1' },
  30: { id: 30, name: 'HDF1',            section: 'HYDRO' },
};

test('leader — เห็นคนยืมเฉพาะที่ยืมเข้าไลน์ในครอบครัวตัวเอง', () => {
  const fam = new Set([10, 11]);
  assert.equal(isBorrowIntoScope(fam, [], LINE_BY_ID, 10), true);
  assert.equal(isBorrowIntoScope(fam, [], LINE_BY_ID, 11), true);
  assert.equal(isBorrowIntoScope(fam, [], LINE_BY_ID, 20), false);
});

test('leader — line id ที่มาจาก DB เป็น string ต้องเทียบติด (PostgREST คืน int แต่ state เก็บ string ได้)', () => {
  assert.equal(isBorrowIntoScope(['10'], [], LINE_BY_ID, 10), true);
  assert.equal(isBorrowIntoScope([10], [], LINE_BY_ID, '10'), true);
});

test('leader ที่ไม่มีไลน์ใน scope = ไม่เห็นคนยืมของใคร (fail-closed)', () => {
  assert.equal(isBorrowIntoScope([], [], LINE_BY_ID, 10), false);
  assert.equal(isBorrowIntoScope(new Set(), [], LINE_BY_ID, 10), false);
});

test('role ที่คุมด้วยส่วนงาน — ดูจาก section ของไลน์ปลายทาง', () => {
  assert.equal(isBorrowIntoScope(null, ['ASSY2'], LINE_BY_ID, 10), true);
  assert.equal(isBorrowIntoScope(null, ['ASSY2'], LINE_BY_ID, 20), false);
  // ไลน์ที่ไม่รู้จัก (ยังไม่โหลด lines) = ไม่ผ่าน scope ที่จำกัดไว้
  assert.equal(isBorrowIntoScope(null, ['ASSY2'], LINE_BY_ID, 99), false);
});

test('admin/manager (ไม่จำกัด scope) — ผ่านหมด', () => {
  assert.equal(isBorrowIntoScope(null, [], LINE_BY_ID, 20), true);
  assert.equal(isBorrowIntoScope(null, [], LINE_BY_ID, 99), true);
});
