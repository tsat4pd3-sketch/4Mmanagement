/* 🔭 scope_depth — "ไม่รู้ = แคบ" ห้ามกลับด้าน                        2026-09-24
 * บั๊กต้นทางที่ด่านนี้กัน: ของเดิมอนุมานความกว้างจาก **การเว้นว่าง**
 * (`sections = []` ⇒ เห็นทั้งโรงงาน) ⇒ 12/97 บัญชีกว้างโดยไม่มีใครตั้งใจ
 * ผิดทั้ง role-centric RBAC-A (NIST) และ deny-by-default (OWASP A01)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { depthForLevel, depthRank, isWiderThan, needsScopeReview,
         SCOPE_DEPTHS, SCOPE_DEPTH_META } from '../scopeDepth.js';

test('🔴 ไม่รู้ระดับ ต้องได้ค่าแคบ ห้ามได้ all', () => {
  for (const v of [undefined, null, '', 'ระดับที่ไม่มีในทะเบียน', 'ADMIN']) {
    const d = depthForLevel(v);
    assert.notEqual(d, 'all', `depthForLevel(${JSON.stringify(v)}) ต้องไม่ใช่ all`);
    assert.equal(d, 'unit');
  }
});

test('ระดับที่สูงขึ้น ต้องไม่แคบลง (ลำดับต้องสมเหตุผล)', () => {
  const ladder = ['operator', 'technician', 'leader', 'supervisor', 'manager'];
  for (let i = 1; i < ladder.length; i++) {
    assert.ok(depthRank(depthForLevel(ladder[i])) >= depthRank(depthForLevel(ladder[i - 1])),
      `${ladder[i]} ต้องไม่แคบกว่า ${ladder[i - 1]}`);
  }
});

test('ผู้จัดการฝ่าย = ทั้งสายของฝ่ายตัวเอง ไม่ใช่ทั้งโรงงาน', () => {
  // ตรงกับที่ user ทัก: "manager มองได้หมด ซึ่งความจริงต้องดูว่าอยู่ส่วนงานไหน"
  assert.equal(depthForLevel('manager'), 'branch');
  assert.notEqual(depthForLevel('manager'), 'all');
});

test('`all` ต้องมาจากการตั้งค่าเท่านั้น — ไม่มี level ไหน default เป็น all', () => {
  const levels = ['operator', 'technician', 'staff', 'engineer', 'leader', 'supervisor', 'manager'];
  assert.deepEqual(levels.filter(l => depthForLevel(l) === 'all'), [],
    'ถ้ามีระดับไหน default เป็น all = กลับไปเป็น fail-open ผ่านประตูหลัง');
});

test('เทียบความกว้างได้ถูกทาง', () => {
  assert.ok(isWiderThan('all', 'branch'));
  assert.ok(isWiderThan('branch', 'unit'));
  assert.ok(isWiderThan('unit', 'self'));
  assert.ok(!isWiderThan('self', 'unit'));
  assert.equal(depthRank('ค่าประหลาด'), 0, 'ค่าที่ไม่รู้จัก = แคบสุด ไม่ใช่กว้างสุด');
});

test('คิวทบทวนสิทธิ์ = เฉพาะที่กว้างแบบไม่มีใครตั้งใจ', () => {
  assert.equal(needsScopeReview({ scope_depth: 'all', scope_depth_src: 'legacy_open' }), true);
  assert.equal(needsScopeReview({ scope_depth: 'all', scope_depth_src: 'role_wide' }), false,
    'กว้างเพราะ role (admin/qa/ช่าง) = ตั้งใจมาแต่เดิม ไม่ใช่คิวทบทวน');
  assert.equal(needsScopeReview({ scope_depth: 'all', scope_depth_src: 'manual' }), false);
  assert.equal(needsScopeReview({ scope_depth: 'branch', scope_depth_src: 'legacy_open' }), false);
  assert.equal(needsScopeReview(null), false);
  assert.equal(needsScopeReview({}), false);
});

test('ทุกค่ามีป้ายกำกับครบ (จอห้ามโชว์ค่าดิบ)', () => {
  for (const d of SCOPE_DEPTHS) {
    assert.ok(SCOPE_DEPTH_META[d]?.label, `${d} ต้องมี label`);
    assert.ok(SCOPE_DEPTH_META[d]?.desc?.length > 10, `${d} ต้องมีคำอธิบายที่คนอ่านรู้เรื่อง`);
  }
});
