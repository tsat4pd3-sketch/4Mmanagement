/* 🏠 "จอหน้างานเปิดมาควรอยู่ที่ไลน์ไหน" — ด่านของ `defaultLineFilter()` (13/11)
   เคสจริง: หัวหน้ากลุ่ม PD4 แจ้งว่า *"หัวหน้าไลน์เห็นพนักงานไลน์อื่นตอนเช็คชื่อ"*
   วัดจริงจากทะเบียน: หัวหน้า GOR ควรเห็น 24 คน (GOR 18 + Assy GOR 6) แต่เห็น 52 คน
     (ติดครอบครัว LWR BAR 21 + Office PD4 7) — เป็นทุกส่วนงาน ไม่ใช่แค่ PD4

   🔴 ตัวนี้เป็น **ค่าตั้งต้นของช่องกรอง ไม่ใช่ด่านสิทธิ์** — `lineScope()` ยังคืนเท่าเดิมเป๊ะ
      (26/10 เคยบีบ scope จริงแล้วทั้งโรงงานเปิดกะไม่ได้ · ปุ่ม "ยืมคน" ต้องเห็นคนไลน์อื่น)
   ⇒ ไฟล์นี้ตรึงว่า: ใครได้ค่าตั้งต้น · ใครไม่ได้ · และเคสที่ต้องคืน '' เพื่อไม่ให้จอว่างเทียม */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultLineFilter, lineScope } from '../sectionScope.js';

const LINES = [
  { id: 10, name: 'GOR',       section: 'PD4', parent_line_name: null },
  { id: 11, name: 'Assy GOR',  section: 'PD4', parent_line_name: 'GOR' },
  { id: 8,  name: 'LWR BAR',   section: 'PD4', parent_line_name: null },
  { id: 12, name: 'Assy  LWR', section: 'PD4', parent_line_name: 'LWR BAR' },
  { id: 99, name: 'Office PD4', section: 'PD4', parent_line_name: null },
];

test('หัวหน้าไลน์ (leader) เปิดมาที่ไลน์ตัวเอง — คืนเป็นสตริง id', () => {
  assert.equal(defaultLineFilter({ role: 'leader', lineId: 10, lines: LINES }), '10');
  assert.equal(defaultLineFilter({ role: 'leader', lineId: '8', lines: LINES }), '8');
});

test('🔴 supervisor ไม่เข้าข่าย — ดูทั้งส่วนงานเป็นหน้าที่ของเขา', () => {
  assert.equal(defaultLineFilter({ role: 'supervisor', lineId: 10, lines: LINES }), '');
});

test('role ที่เห็นทั้งโรงงานตามปกติ ไม่ถูกบีบค่าตั้งต้น', () => {
  for (const role of ['admin', 'manager', 'qa', 'mtn', 'planner_store', 'viewer']) {
    assert.equal(defaultLineFilter({ role, lineId: 10, lines: LINES }), '',
      `role ${role} ต้องไม่ถูกตั้งค่าเริ่มต้นเป็นไลน์เดียว`);
  }
});

test('ไม่มีไลน์ผูกบัญชี (รักษาการหลายหน่วย) = เปิดมาเห็นทั้งขอบเขต', () => {
  assert.equal(defaultLineFilter({ role: 'leader', lineId: null, lines: LINES }), '');
  assert.equal(defaultLineFilter({ role: 'leader', lineId: '', lines: LINES }), '');
  assert.equal(defaultLineFilter({ role: 'leader', lines: LINES }), '');
});

test('🔴 ไลน์ตัวเองไม่อยู่ในทะเบียน (ถูกลบ/เปลี่ยนชื่อ) = คืน \'\' ห้ามให้จอว่างเทียม', () => {
  assert.equal(defaultLineFilter({ role: 'leader', lineId: 7777, lines: LINES }), '');
});

test('ทะเบียนยังไม่โหลด = ยังตัดสินไม่ได้ ⇒ ใช้ไลน์ตัวเองไปก่อน (ห้ามเด้งเป็นทั้งโรงงานตอนโหลด)', () => {
  assert.equal(defaultLineFilter({ role: 'leader', lineId: 10, lines: [] }), '10');
  assert.equal(defaultLineFilter({ role: 'leader', lineId: 10 }), '10');
});

test('ไม่ส่งอะไรเลย ต้องไม่โยน', () => {
  assert.equal(defaultLineFilter(), '');
  assert.equal(defaultLineFilter({}), '');
});

/* 🔴🔴 ตาข่ายสำคัญสุด — ค่าตั้งต้นนี้ **ห้ามแตะขอบเขตที่เห็นได้**
   ถ้าวันหนึ่งมีคนเผลอเอาไปบีบ lineScope() เคสนี้จะล้ม: หัวหน้า GOR ต้องยัง "เห็น" ได้ทั้ง PD4
   (ไม่งั้นยืมคนข้ามไลน์ไม่ได้ และซ้ำเหตุ 26/10 ที่เปิดกะไม่ได้ทั้งโรงงาน) */
test('🔴 ขอบเขตที่เห็นได้ของหัวหน้าไลน์ ต้องยังเป็น ไลน์ตัวเอง ∪ ไลน์ในส่วนงาน (ห้ามถูกบีบ)', () => {
  const sc = lineScope({ role: 'leader', lineId: 10, sections: ['PD4'], lines: LINES });
  assert.equal(sc.unlimited, false);
  for (const n of ['GOR', 'Assy GOR', 'LWR BAR', 'Assy  LWR', 'Office PD4']) {
    assert.ok(sc.names.includes(n), `หัวหน้า GOR ต้องยังเห็น "${n}" ได้ (ยืมคน/เปิดกะ)`);
  }
  // และค่าตั้งต้นของจอต้องแคบกว่าขอบเขต = เปิดมาเห็นแค่ไลน์ตัวเอง
  assert.equal(defaultLineFilter({ role: 'leader', lineId: 10, lines: LINES }), '10');
});
