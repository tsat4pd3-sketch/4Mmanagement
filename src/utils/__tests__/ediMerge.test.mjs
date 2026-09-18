/* 862 ห้ามสร้างใบซ้ำของเที่ยวที่ e-SMART/หน้างานทำไปแล้ว
   เคสจริง 2026-09-18 (AAT/GRBNA): อัพ 862 ตอน 13:53 → สร้างใบรอบ 08:00/10:00/13:00
   ทับเที่ยวที่ e-SMART ยืนยัน+ส่งไปแล้วตอน 09:00/11:00/14:00 ⇒ หักสต็อกซ้ำ 515 ชิ้น */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDoneCover, splitAlreadyDone, shipAtMs, normKey, DONE_STATUSES } from '../ediMerge.js';

const D = '2026-09-18';
const done = (t, mat, dock = 'B5', status = 'shipped', pn = null) =>
  ({ id: `${mat}@${t}`, mat_no: mat, customer_part_no: pn, due_date: D, ship_time: t, dock_code: dock, status });
const rec = (t, mat, dock = 'B5', part = 'RB3B 16E060 BA') =>
  ({ shipTo: 'GRBNA', part, mat_no: mat, date: D, time: t, dock });

test('🔴 862 08:00 = เที่ยวเดียวกับ e-SMART 09:00 → ต้องข้าม ไม่สร้างซ้ำ', () => {
  const by = findDoneCover(rec('08:00', '10100385'), [done('09:00', '10100385')]);
  assert.ok(by, 'ต้องเจอใบที่ครอบคลุม');
  assert.equal(by.ship_time, '09:00');
});

test('คู่ที่วัดไว้จริงทั้ง 3 เที่ยวต้องถูกจับได้หมด (08↔09 · 10↔11 · 13↔14)', () => {
  const d = [done('09:00', 'M1'), done('11:00', 'M1'), done('14:00', 'M1')];
  ['08:00', '10:00', '13:00'].forEach((t, i) => {
    const by = findDoneCover(rec(t, 'M1'), d);
    assert.ok(by, `${t} ต้องจับคู่ได้`);
    assert.equal(by.ship_time, ['09:00', '11:00', '14:00'][i]);
  });
});

test('เที่ยวที่ยังไม่มีใครทำ ต้องสร้างได้ตามปกติ', () => {
  assert.equal(findDoneCover(rec('15:30', 'M1'), [done('09:00', 'M1')]), null);
  assert.equal(findDoneCover(rec('21:00', 'M1'), [done('09:00', 'M1')]), null);
});

test('คนละ dock = คนละเที่ยว ห้ามข้าม', () => {
  assert.equal(findDoneCover(rec('08:00', 'M1', 'T6'), [done('09:00', 'M1', 'B5')]), null);
});

test('ใบเดิมที่ไม่ระบุ dock ถือว่าเข้ากันได้ (ใบเก่าก่อนมีคอลัมน์ dock)', () => {
  assert.ok(findDoneCover(rec('08:00', 'M1', 'B5'), [done('09:00', 'M1', null)]));
});

test('คนละ MAT ห้ามข้าม แม้เลขพาร์ทลูกค้าจะสะกดเหมือนกัน', () => {
  assert.equal(findDoneCover(rec('08:00', '10100385'), [done('09:00', '10100384')]), null);
});

test('ไม่มี MAT → เทียบเลขพาร์ทลูกค้าแบบ normalize (ขีด/ช่องว่างไม่เกี่ยง)', () => {
  const by = findDoneCover({ ...rec('08:00', null), part: 'RB3B 16E060 BA' },
    [done('09:00', null, 'B5', 'shipped', 'RB3B-16E060-BA')]);
  assert.ok(by);
});

test('ใบ pending ไม่นับว่า "ทำไปแล้ว" — ผู้เรียกต้องกรอง DONE_STATUSES มาก่อน', () => {
  assert.deepEqual(DONE_STATUSES, ['confirmed', 'prepared', 'loaded', 'shipped']);
});

test('เวลาก่อน 08:00 = กะดึกของวันงาน ⇒ ตกวันถัดไป (ห้ามเทียบเป็นนาทีบนหน้าปัด)', () => {
  assert.ok(shipAtMs(D, '00:30') > shipAtMs(D, '22:00'), '00:30 ต้องอยู่หลัง 22:00 ของวันงานเดียวกัน');
  // 862 06:00 (กะดึก) ต้องไม่ไปจับกับใบ 09:00 ของเช้าวันเดียวกัน
  assert.equal(findDoneCover(rec('06:00', 'M1'), [done('09:00', 'M1')]), null);
});

test('splitAlreadyDone แยกกองได้ถูก', () => {
  const r = [rec('08:00', 'M1'), rec('15:30', 'M1'), rec('10:00', 'M1')];
  const { insert, covered } = splitAlreadyDone(r, [done('09:00', 'M1'), done('11:00', 'M1')]);
  assert.equal(insert.length, 1);
  assert.equal(insert[0].time, '15:30');
  assert.equal(covered.length, 2);
});

test('normKey ตัดขีด/ช่องว่าง/ตัวพิมพ์', () => {
  assert.equal(normKey('RB3B-16E060-BA'), normKey('rb3b 16e060 ba'));
});
