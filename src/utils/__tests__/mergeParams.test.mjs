// เทสตัวรวม query param — กันบั๊ก "กดแท็บส่วนงานแล้วจอเด้งออกจากแท็บที่ใช้อยู่" (2026-09-16)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeParams } from '../useTabParam.js';

const q = (o) => new URLSearchParams(o).toString();

test('param อื่นต้องอยู่ครบ — โดยเฉพาะ ?tab= ของหน้าแม่ (ต้นเหตุจอเด้งไปแท็บแรก)', () => {
  const out = mergeParams(new URLSearchParams({ tab: 'setup', dept: 'maintenance' }), { dept: 'die_maintenance' });
  assert.equal(out.get('tab'), 'setup');
  assert.equal(out.get('dept'), 'die_maintenance');
});

test('ส่ง null/undefined/ว่าง = ล้าง param นั้นทิ้ง (ล้างแบบตั้งใจ)', () => {
  const base = new URLSearchParams({ tab: 'check', dept: 'mtn', equip: 'e1', line: 'HDF1' });
  assert.equal(mergeParams(base, { equip: null }).get('equip'), null);
  assert.equal(mergeParams(base, { line: '' }).get('line'), null);
  assert.equal(mergeParams(base, { equip: undefined }).get('equip'), null);
  assert.equal(mergeParams(base, { equip: null }).get('tab'), 'check', 'ล้างตัวหนึ่งต้องไม่พาตัวอื่นหาย');
});

test('เปลี่ยนแผนกพร้อมล้างตัวกรองไลน์ในครั้งเดียว (พฤติกรรมของ /pm-check)', () => {
  const out = mergeParams(new URLSearchParams({ tab: 'check', dept: 'a', equip: 'e1', line: 'L1' }), { dept: 'b', line: null });
  assert.equal(q(out), q({ tab: 'check', dept: 'b', equip: 'e1' }));
});

test('รับ string/plain object เป็น prev ได้ · ค่าตัวเลขถูกแปลงเป็นสตริง', () => {
  assert.equal(mergeParams('tab=setup', { dept: 'x' }).get('tab'), 'setup');
  assert.equal(mergeParams({ tab: 'setup' }, { n: 5 }).get('n'), '5');
  assert.equal(mergeParams(new URLSearchParams(), {}).toString(), '');
  assert.equal(mergeParams(new URLSearchParams({ a: '1' }), null).get('a'), '1');
});
