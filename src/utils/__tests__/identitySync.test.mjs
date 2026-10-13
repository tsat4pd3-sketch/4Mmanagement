/* 🪪 ตัวตนบัญชี vs ฐานพนักงาน — ล็อกกติกาการเทียบ (2026-10-08)
 *
 * ที่มา: แถบเตือนใน /add-user เดิมเทียบแค่ team + line ⇒ section/position/org_node เพี้ยนเงียบ
 * (วัดจริง 06/10 จาก 42 ใบที่ผูกแล้ว: section 8 · position 8 · org_node 6 · team 1 · line 0)
 * เทสนี้กันไม่ให้ลิสต์ช่องหดกลับ และกันปุ่ม "ใช้ค่าจากฐานพนักงาน" เขียนไม่ครบ
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY_FIELDS, identityDiff, identityFallbacks, syncPatch, hasIdentityIssue,
  changesBehaviour, USES_EMP, USES_ACCT, USES_SPLIT,
} from '../identitySync.js';

test('ลิสต์ช่องต้องครบทั้ง 5 คู่ที่เก็บ 2 ที่ — หดเมื่อไหร่ = ช่องนั้นเพี้ยนเงียบ', () => {
  assert.deepEqual(IDENTITY_FIELDS.map(f => f.key).sort(),
    ['line_id', 'org_node_id', 'position', 'section', 'team']);
  for (const f of IDENTITY_FIELDS) assert.ok(f.label, `ช่อง ${f.key} ต้องมีป้ายภาษาไทย`);
});

test('ต่างกันทุกช่อง = คืนครบทุกช่อง พร้อมค่าทั้ง 2 ฝั่ง', () => {
  const d = identityDiff(
    { team: 'A', line_id: 1, section: 'PD1', position: 'operator', org_node_id: 'n1' },
    { team: 'C', line_id: 2, section: 'PD3', position: 'dept_head', org_node_id: 'n2' });
  assert.equal(d.length, 5);
  const team = d.find(x => x.key === 'team');
  assert.equal(team.acct, 'A');
  assert.equal(team.emp, 'C');
});

test('ว่างคือว่าง — null / undefined / "" ถือว่าเท่ากัน (ไม่ใช่ความต่าง)', () => {
  assert.deepEqual(identityDiff({ team: null, section: '' }, { team: undefined, section: null }), []);
});

test('🔴 ฐานพนักงานว่าง = ไม่ใช่ "ต่างกัน" แต่เป็น fallback (ระบบใช้ค่าในบัญชีจริง)', () => {
  const p = { team: 'A', line_id: 5 }, e = { team: null, line_id: 5 };
  assert.deepEqual(identityDiff(p, e), []);                       // ไม่นับเป็นข้อขัดแย้ง
  const fb = identityFallbacks(p, e);
  assert.equal(fb.length, 1);
  assert.equal(fb[0].key, 'team');
});

test('เทียบ uuid/ตัวเลขข้ามชนิดได้ (line_id 5 vs "5" = ตรงกัน)', () => {
  assert.deepEqual(identityDiff({ line_id: 5 }, { line_id: '5' }), []);
});

test('🔴 syncPatch ต้องเขียนครบทุกช่อง รวมช่องที่ฐานพนักงานว่าง (เป็น null)', () => {
  const patch = syncPatch({ team: 'C', line_id: null, section: 'PD3', position: '', org_node_id: 'n9' });
  assert.deepEqual(Object.keys(patch).sort(), IDENTITY_FIELDS.map(f => f.key).sort());
  assert.equal(patch.line_id, null);
  assert.equal(patch.position, null);   // '' ต้องกลายเป็น null ไม่ใช่ค้างเป็นสตริงว่าง
  assert.equal(patch.team, 'C');
});

test('กดปุ่มแล้วต้องหายจริง — เขียน patch ทับแล้วไม่เหลือข้อขัดแย้ง', () => {
  const emp = { team: 'C', line_id: 2, section: 'PD3', position: 'dept_head', org_node_id: 'n2' };
  const after = { ...{ team: 'A', line_id: 1, section: 'PD1', position: 'operator', org_node_id: 'n1' },
                  ...syncPatch(emp) };
  assert.deepEqual(identityDiff(after, emp), []);
  assert.deepEqual(identityFallbacks(after, emp), []);
  assert.equal(hasIdentityIssue(after, emp), false);
});

test('ไม่มีพนักงานผูก = ไม่เตือนอะไร (ยังไม่ผูกตัวตน เป็นอีกอาการหนึ่ง)', () => {
  assert.deepEqual(identityDiff({ team: 'A' }, null), []);
  assert.deepEqual(identityFallbacks({ team: 'A' }, null), []);
  assert.equal(hasIdentityIssue({ team: 'A' }, null), false);
});

/* ── 🔴 "ช่องนี้ระบบใช้ฝั่งไหน" — 2026-10-13 ──────────────────────────────────
   แถบเตือนเคยเขียนเหมาว่า "ระบบใช้ค่าจากฐานพนักงานแล้ว ค่าในบัญชีคือค่าเก่าที่ไม่ถูกใช้"
   ซึ่งจริงเฉพาะ team/line_id/section · `position` App.jsx อ่านจาก `profiles` ล้วน
   (→ positionRank = ด่านช่องเซ็นขั้น 6/7/8 + คิวรออนุมัติ MO) · `org_node_id` ไม่มี merge เลย
   ⇒ ปุ่ม "ใช้ค่าจากฐานพนักงาน" บน 2 ช่องนั้น = **เปลี่ยนสิทธิ์จริง** ไม่ใช่ล้างค่าขยะ */

test('🔴 ทุกช่องต้องประกาศว่าระบบใช้ฝั่งไหน — ไม่ประกาศ = จอเขียนเหมาแล้วโกหก', () => {
  for (const f of IDENTITY_FIELDS) {
    assert.ok([USES_EMP, USES_ACCT, USES_SPLIT].includes(f.uses), `ช่อง ${f.key} ต้องมี uses`);
  }
});

test('🔴 ฐานพนักงานชนะเฉพาะ ทีม/ไลน์/ส่วนงาน (ตรงกับ merge ใน App.jsx)', () => {
  const empWins = IDENTITY_FIELDS.filter(f => f.uses === USES_EMP).map(f => f.key).sort();
  assert.deepEqual(empWins, ['line_id', 'section', 'team']);
  assert.equal(IDENTITY_FIELDS.find(f => f.key === 'position').uses, USES_ACCT);
  assert.equal(IDENTITY_FIELDS.find(f => f.key === 'org_node_id').uses, USES_SPLIT);
});

test('ช่องที่ไม่ใช่ฐานพนักงานชนะ ต้องมีข้อความอธิบายติดมาด้วย', () => {
  for (const f of IDENTITY_FIELDS.filter(x => x.uses !== USES_EMP)) {
    assert.ok(f.note, `ช่อง ${f.key} ต้องมี note บอกว่าทับแล้วเกิดอะไร`);
  }
});

test('changesBehaviour: คัดเฉพาะช่องที่ทับแล้วของจริงเปลี่ยน', () => {
  const d = identityDiff(
    { team: 'A', position: 'operator', org_node_id: 'n1' },
    { team: 'C', position: 'dept_head', org_node_id: 'n2' });
  assert.deepEqual(changesBehaviour(d).map(x => x.key).sort(), ['org_node_id', 'position']);
  // ต่างแค่ช่องที่ฐานพนักงานชนะ = ล้างได้เลย ไม่ต้องถาม
  assert.deepEqual(changesBehaviour(identityDiff({ team: 'A' }, { team: 'C' })), []);
});

test('diff/fallback ต้องพก uses ติดไปให้จอใช้ตัดสินสีและคำเตือน', () => {
  const [d] = identityDiff({ position: 'operator' }, { position: 'dept_head' });
  assert.equal(d.uses, USES_ACCT);
  assert.ok(d.note);
  const [fb] = identityFallbacks({ position: 'operator' }, { position: null });
  assert.equal(fb.uses, USES_ACCT);
});
