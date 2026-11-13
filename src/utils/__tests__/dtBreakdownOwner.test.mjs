/* 🔧 ธง "เครื่องเสียที่ช่างรับผิดชอบ" ในทะเบียนประเภท downtime (13/11 · คำสั่ง user)
 * 🔴 3 สถานะห้ามยุบเหลือ 2 — `unset` (ยังไม่มีใครติ๊ก) ≠ `no` (ตัดสินแล้วว่าไม่ใช่ของช่าง) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mbFlagOf, mbValueForDb, splitByMbFlag, MB_FLAGS, mbFlagMeta } from '../dtBreakdownOwner.js';

test('อ่านธงจากแถวทะเบียน — true/false/null คนละความหมาย', () => {
  assert.equal(mbFlagOf({ is_machine_breakdown: true }), 'yes');
  assert.equal(mbFlagOf({ is_machine_breakdown: false }), 'no');
  assert.equal(mbFlagOf({ is_machine_breakdown: null }), 'unset');
});

test('🔴 คิวรีไม่ได้ select คอลัมน์มา = unset ห้ามเดาเป็น yes', () => {
  assert.equal(mbFlagOf({}), 'unset', 'undefined = ยังไม่รู้');
  assert.equal(mbFlagOf(null), 'unset');
  assert.equal(mbFlagOf(undefined), 'unset');
  /* เดาเป็น yes = ชั่วโมงไหลเข้าฝั่งช่างทั้งก้อนโดยไม่มีใครตัดสิน */
  for (const bad of ['x', 0, 1, '']) {
    assert.equal(mbFlagOf({ is_machine_breakdown: bad }), 'unset', `ค่าเพี้ยน (${bad}) ต้องเป็น unset`);
  }
});

test('🔴 เก็บลงฐาน: ยังไม่ระบุ = null ห้ามเก็บ false แทน', () => {
  assert.equal(mbValueForDb('yes'), true);
  assert.equal(mbValueForDb('no'), false);
  assert.equal(mbValueForDb('unset'), null);
  assert.equal(mbValueForDb('ไม่มีคีย์นี้'), null, 'คีย์แปลก = ยังไม่ระบุ ไม่ใช่ false');
});

test('แยก 3 ถัง — บวกกลับได้เท่ายอดรวมเสมอ', () => {
  const r = splitByMbFlag([
    { flag: 'yes', hr: 10 }, { flag: 'yes', hr: 5 },
    { flag: 'no', hr: 7 },
    { flag: 'unset', hr: 3 },
  ]);
  assert.equal(r.yesHr, 15);
  assert.equal(r.noHr, 7);
  assert.equal(r.unsetHr, 3);
  assert.equal(r.totalHr, 25);
  assert.equal(r.yesHr + r.noHr + r.unsetHr, r.totalHr, 'ไม่มีชั่วโมงไหนหายไป');
  assert.ok(Math.abs(r.decidedPct - 88) < 0.01, 'ตัดสินแล้ว 22 จาก 25 ชม.');
});

test('🔴 ยังไม่มีใครติ๊กเลย = ตัดสินแล้ว 0% และชั่วโมงอยู่ถัง unset ครบ', () => {
  const r = splitByMbFlag([{ flag: 'unset', hr: 813.6 }]);
  assert.equal(r.yesHr, 0);
  assert.equal(r.noHr, 0);
  assert.ok(Math.abs(r.unsetHr - 813.6) < 0.01);
  assert.equal(r.decidedPct, 0);
});

test('🔴 ไม่มีชั่วโมงเลย = decidedPct เป็น null ห้ามคืน 0', () => {
  const r = splitByMbFlag([]);
  assert.equal(r.totalHr, 0);
  assert.equal(r.decidedPct, null, '0% แปลว่า "ยังไม่ตัดสินเลย" คนละเรื่องกับ "ไม่มีข้อมูล"');
  for (const bad of [null, undefined, 'x', 42]) {
    assert.equal(splitByMbFlag(bad).totalHr, 0);
  }
});

test('ทะเบียนธงครบ 3 + meta ถอยไป unset เมื่อคีย์แปลก', () => {
  assert.deepEqual(MB_FLAGS.map(f => f.key), ['yes', 'no', 'unset']);
  assert.equal(MB_FLAGS.find(f => f.key === 'unset').value, null);
  assert.equal(mbFlagMeta('ไม่มี').key, 'unset');
  assert.equal(mbFlagMeta('no').value, false);
});
