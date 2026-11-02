/* 🔴 ด่าน "รู้จักหน่วยนี้ไหม" ต้องมีครบทั้ง 2 แกน (2026-11-02 · คำสั่ง user)
   *"ก็ดุลยทรรศน์ เลเวลผู้จัดการ PD3 แต่เค้ามีสโคปดู PD4 jig MTN แบบนี้ · มันคือการดูและรับผิดชอบควบแผนก"*

   เคสจริงจากทะเบียน: `JIG MTN` เป็น **department ใต้ PD4** (org_nodes.cost_center='2140563100')
   ผู้จัดการที่ดูแล sections=[PD3,PD4] ⇒ ครอบ JIG MTN อยู่แล้วตามผังองค์กร
   แต่ `orderInReporterScope` เทียบ "ชื่อแผนก" กับ "ลิสต์ส่วนงาน" ตรงตัว ⇒ ตอบ false = บล็อกผิด */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderInReporterScope } from '../mtnStepPerm.js';

/* ผู้จัดการที่ดูแลควบแผนก PD3 + PD4 · ทะเบียนส่วนงานจริงมี 4 ตัว (JIG MTN เป็นแผนก ไม่ใช่ส่วนงาน) */
const mgr = {
  scopeLineNames: ['HDF1', 'HDF2', 'Laser LWR'],
  knownLineNames: ['HDF1', 'HDF2', 'Laser LWR', 'LINE A ( 800 Ton )'],
  sections: ['PD3', 'PD4'],
  knownSections: ['PD1', 'PD2', 'PD3', 'PD4'],
};

test('🔴 ใบที่ dept_section เป็น "แผนก" (JIG MTN ใต้ PD4) = ไม่รู้ ⇒ ไม่บล็อก', () => {
  assert.equal(orderInReporterScope({ dept_section: 'JIG MTN' }, mgr), null);
});

test('ใบของส่วนงานอื่นจริงๆ ยังบล็อกเหมือนเดิม', () => {
  assert.equal(orderInReporterScope({ dept_section: 'PD1' }, mgr), false);
});

test('ใบของส่วนงานที่เราดูแล = ผ่าน', () => {
  assert.equal(orderInReporterScope({ dept_section: 'PD4' }, mgr), true);
  assert.equal(orderInReporterScope({ dept_section: 'PD3' }, mgr), true);
});

test('ไลน์ชนะส่วนงานเสมอ — ไลน์ที่รู้จักตัดสินก่อน', () => {
  assert.equal(orderInReporterScope({ line_name: 'HDF1', dept_section: 'PD1' }, mgr), true);
  assert.equal(orderInReporterScope({ line_name: 'LINE A ( 800 Ton )', dept_section: 'PD3' }, mgr), false);
});

test('ไลน์ที่ไม่อยู่ในทะเบียน = ไม่ตัดสินจากไลน์ ถอยไปดูส่วนงาน', () => {
  assert.equal(orderInReporterScope({ line_name: 'ไลน์ที่ไม่มีในทะเบียน', dept_section: 'PD4' }, mgr), true);
});

test('⚠️ ไม่ส่ง knownSections = พฤติกรรมเดิมเป๊ะ (ผู้เรียกอื่นไม่กระทบ)', () => {
  const old = { ...mgr, knownSections: [] };
  assert.equal(orderInReporterScope({ dept_section: 'JIG MTN' }, old), false);
  assert.equal(orderInReporterScope({ dept_section: 'PD4' }, old), true);
});

test('🔴 ไม่จำกัดขอบเขต (scopeLineNames = null) = ไม่บล็อกอะไรเลย', () => {
  assert.equal(orderInReporterScope({ dept_section: 'PD1' }, { ...mgr, scopeLineNames: null }), null);
});

test('ใบไม่ระบุทั้งไลน์และส่วนงาน = ไม่รู้', () => {
  assert.equal(orderInReporterScope({}, mgr), null);
});
