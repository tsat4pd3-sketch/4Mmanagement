/* 🪪 ตัวตนบัญชี vs ฐานพนักงาน — ล็อกกติกาการเทียบ (2026-10-08)
 *
 * ที่มา: แถบเตือนใน /add-user เดิมเทียบแค่ team + line ⇒ section/position/org_node เพี้ยนเงียบ
 * (วัดจริง 06/10 จาก 42 ใบที่ผูกแล้ว: section 8 · position 8 · org_node 6 · team 1 · line 0)
 * เทสนี้กันไม่ให้ลิสต์ช่องหดกลับ และกันปุ่ม "ใช้ค่าจากฐานพนักงาน" เขียนไม่ครบ
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITY_FIELDS, DUAL_MEANING_FIELDS, identityDiff, identityFallbacks, syncPatch,
  hasIdentityIssue, dualMeaningInfo,
} from '../identitySync.js';

test('ลิสต์ "ต้องตรงกัน" = ทีม/ไลน์/ส่วนงาน เท่านั้น — หดหรือโตเมื่อไหร่ต้องตั้งใจ', () => {
  assert.deepEqual(IDENTITY_FIELDS.map(f => f.key).sort(), ['line_id', 'section', 'team']);
  for (const f of IDENTITY_FIELDS) assert.ok(f.label, `ช่อง ${f.key} ต้องมีป้ายภาษาไทย`);
});

test('ต่างกันทุกช่อง = คืนครบทุกช่อง พร้อมค่าทั้ง 2 ฝั่ง', () => {
  const d = identityDiff(
    { team: 'A', line_id: 1, section: 'PD1', position: 'operator', org_node_id: 'n1' },
    { team: 'C', line_id: 2, section: 'PD3', position: 'dept_head', org_node_id: 'n2' });
  assert.equal(d.length, 3);   // ตำแหน่ง/หน่วยในผัง ไม่นับ — คนละความหมาย (ดูเทสท้ายไฟล์)
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
  const patch = syncPatch({ team: 'C', line_id: null, section: '', position: 'dept_head', org_node_id: 'n9' });
  assert.deepEqual(Object.keys(patch).sort(), IDENTITY_FIELDS.map(f => f.key).sort());
  assert.equal(patch.line_id, null);
  assert.equal(patch.section, null);    // '' ต้องกลายเป็น null ไม่ใช่ค้างเป็นสตริงว่าง
  assert.equal(patch.team, 'C');
});

test('🔴🔴 syncPatch ห้ามแตะ position / org_node_id — ทับ = ข้อมูลอีกความหมายหายถาวร', () => {
  const patch = syncPatch({ team: 'C', position: 'operator', org_node_id: 'n9' });
  assert.equal('position' in patch, false);
  assert.equal('org_node_id' in patch, false);
});

test('กดปุ่มแล้วต้องหายจริง — เขียน patch ทับแล้วไม่เหลือข้อขัดแย้ง', () => {
  const emp = { team: 'C', line_id: 2, section: 'PD3' };
  const after = { ...{ team: 'A', line_id: 1, section: 'PD1' }, ...syncPatch(emp) };
  assert.deepEqual(identityDiff(after, emp), []);
  assert.deepEqual(identityFallbacks(after, emp), []);
  assert.equal(hasIdentityIssue(after, emp), false);
});

test('ไม่มีพนักงานผูก = ไม่เตือนอะไร (ยังไม่ผูกตัวตน เป็นอีกอาการหนึ่ง)', () => {
  assert.deepEqual(identityDiff({ team: 'A' }, null), []);
  assert.deepEqual(identityFallbacks({ team: 'A' }, null), []);
  assert.equal(hasIdentityIssue({ team: 'A' }, null), false);
});

/* ── 🔴🔴 2 ชั้นที่ห้ามปนกัน — 2026-10-13 · คำสั่ง user ────────────────────────
   > *"6 คนนี้ ตำแหน่งจริงที่เค้าเป็นอยู่กับบริษัทคือตามฐานพนักงาน
   >   แต่ตำแหน่งงานและงานที่ตัวเค้าทำ คือทำในตำแหน่งตรงกับบัญชี"*
   `position` ไม่ใช่ค่าเดียวกันที่เก็บ 2 ที่ — เป็น **2 คำถามคนละข้อ** ที่ชื่อคอลัมน์ซ้ำกัน
   (ตำแหน่งตามบริษัท vs ตำแหน่งที่ปฏิบัติงาน) ⇒ ต่างกัน = ถูกต้อง · ทับ = ข้อมูลหายถาวร
   เทสชุดนี้กันไม่ให้มีใครลากมันกลับเข้า IDENTITY_FIELDS อีก */

test('🔴 position / org_node_id ต้องอยู่ชั้น "คนละความหมาย" ไม่ใช่ชั้น "ต้องตรงกัน"', () => {
  const must = IDENTITY_FIELDS.map(f => f.key);
  assert.equal(must.includes('position'), false);
  assert.equal(must.includes('org_node_id'), false);
  assert.deepEqual(DUAL_MEANING_FIELDS.map(f => f.key).sort(), ['org_node_id', 'position']);
});

test('ช่องคนละความหมายต้องมีป้ายของทั้ง 2 ฝั่ง (ไม่งั้นจอเขียนไม่ได้ว่าใครคืออะไร)', () => {
  for (const f of DUAL_MEANING_FIELDS) {
    assert.ok(f.empLabel && f.acctLabel, `ช่อง ${f.key} ต้องมี empLabel/acctLabel`);
    assert.ok(f.note, `ช่อง ${f.key} ต้องมี note`);
  }
});

test('🔴 ตำแหน่งต่างกัน = ไม่ใช่ข้อขัดแย้ง (ห้ามขึ้นแถบเตือน) แต่ต้องโผล่ในชั้นข้อมูล', () => {
  const acct = { team: 'C', position: 'dept_head' };          // ปฏิบัติงานเป็นหัวหน้าแผนก
  const emp  = { team: 'C', position: 'line_leader' };        // บริษัทบรรจุเป็นหัวหน้าไลน์
  assert.deepEqual(identityDiff(acct, emp), []);
  assert.deepEqual(identityFallbacks(acct, emp), []);
  assert.equal(hasIdentityIssue(acct, emp), false);
  const info = dualMeaningInfo(acct, emp);
  assert.equal(info.length, 1);
  assert.equal(info[0].emp, 'line_leader');
  assert.equal(info[0].acct, 'dept_head');
  assert.ok(info[0].empLabel.includes('บริษัท'));
});

test('ตรงกัน / ฝั่งใดฝั่งหนึ่งว่าง = ไม่ต้องเขียนอะไรบนจอ', () => {
  assert.deepEqual(dualMeaningInfo({ position: 'dept_head' }, { position: 'dept_head' }), []);
  assert.deepEqual(dualMeaningInfo({ position: 'dept_head' }, { position: null }), []);
  assert.deepEqual(dualMeaningInfo({ position: null }, { position: 'operator' }), []);
  assert.deepEqual(dualMeaningInfo({ position: 'x' }, null), []);
});

test('หน่วยในผังติดธง undecided ไว้ — เตือนคนอ่านว่ายังไม่ได้ตัดสิน', () => {
  assert.equal(DUAL_MEANING_FIELDS.find(f => f.key === 'org_node_id').undecided, true);
  assert.ok(!DUAL_MEANING_FIELDS.find(f => f.key === 'position').undecided);
});
