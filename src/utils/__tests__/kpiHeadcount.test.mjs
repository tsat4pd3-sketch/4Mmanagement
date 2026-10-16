import test from 'node:test';
import assert from 'node:assert/strict';
import { headcountAuto, headcountAutoVar } from '../kpiHeadcount.js';
import { buildBaseIndex } from '../kpiFormula.js';

const emps = [
  { id: 1, section: 'PD1', department: 'BIG PRESS', is_active: true, start_date: '2020-01-15' },
  { id: 2, section: 'PD1', department: 'BIG PRESS', is_active: true, start_date: '2026-03-10' },   // เข้าเดือน 3
  { id: 3, section: 'PD1', department: 'SMALL PRESS', is_active: true, start_date: '2569-05-01' }, // บั๊ก พ.ศ. = นับทุกเดือน
  { id: 4, section: 'PD1', department: 'SMALL PRESS', is_active: false, start_date: '2019-01-01' }, // ออกแล้ว
  { id: 5, section: 'PD2', department: 'HYDROFORM', is_active: true, start_date: null },
  { id: 6, section: 'Planning&Store', department: 'STORE', is_active: true, start_date: '2021-01-01' },
];

test('headcountAuto: ทั้งโรงงาน/ส่วนงาน/แผนก นับคน active ที่เข้าแล้ว ณ สิ้นเดือน · start_date ว่าง/อนาคต = นับ · ไลน์ = null', () => {
  const hc = headcountAuto(emps, { year: 2026, today: '2026-10-15' });
  assert.equal(hc.get('plant', 1), 4);           // 1,3,5,6 (2 ยังไม่เข้า · 4 ออกแล้ว)
  assert.equal(hc.get('plant', 3), 5);
  assert.equal(hc.get('section:PD1', 1), 2); assert.equal(hc.get('section:PD1', 4), 3);
  assert.equal(hc.get('department:BIG PRESS', 2), 1); assert.equal(hc.get('department:big press', 3), 2);
  assert.equal(hc.get('section:Planning & Store', 1), 1, 'เทียบชื่อไม่สนช่องว่าง/&');
  assert.equal(hc.get('section:PD9', 1), null, 'ไม่มีใครในส่วนงานนี้ = ไม่รู้ ไม่ใช่ 0');
  assert.equal(hc.get('line:LINE A', 1), null);
  assert.equal(hc.size, 5);
});

test('buildBaseIndex({auto}): กรอกมือชนะ · ไม่มีแถว = ใช้ทะเบียน + src=auto · ตัวแปรอื่นไม่เติม', () => {
  const hc = headcountAuto(emps, { year: 2026, today: '2026-10-15' });
  const base = buildBaseIndex([{ id: 'r1', month: 1, scope_kind: 'section', scope_value: 'PD1', var_key: 'manpower', value: 300 }], { auto: headcountAutoVar(hc) });
  assert.equal(base.get('section:PD1', 'manpower', 1), 300); assert.equal(base.src('section:PD1', 'manpower', 1), 'manual');
  assert.equal(base.get('section:PD1', 'manpower', 2), 2); assert.equal(base.src('section:PD1', 'manpower', 2), 'auto');
  assert.equal(base.get('section:PD1', 'dl', 2), null); assert.equal(base.src('section:PD1', 'dl', 2), null);
  assert.equal(buildBaseIndex([]).src('plant', 'manpower', 1), null);
});
