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

test('ลิสต์ "ต้องตรงกัน" = ทีม/ไลน์/ส่วนงาน/หน่วยในผัง — หดหรือโตเมื่อไหร่ต้องตั้งใจ', () => {
  assert.deepEqual(IDENTITY_FIELDS.map(f => f.key).sort(),
    ['line_id', 'org_node_id', 'section', 'team']);
  for (const f of IDENTITY_FIELDS) assert.ok(f.label, `ช่อง ${f.key} ต้องมีป้ายภาษาไทย`);
});

test('ต่างกันทุกช่อง = คืนครบทุกช่อง พร้อมค่าทั้ง 2 ฝั่ง', () => {
  const d = identityDiff(
    { team: 'A', line_id: 1, section: 'PD1', position: 'operator', org_node_id: 'n1' },
    { team: 'C', line_id: 2, section: 'PD3', position: 'dept_head', org_node_id: 'n2' });
  assert.equal(d.length, 4);   // ตำแหน่งไม่นับ — คนละความหมาย (ดูเทสท้ายไฟล์)
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

test('🔴🔴 syncPatch ห้ามเขียน null ทับช่องที่ฐานพนักงานว่าง — ค่านั้นคือค่าที่ระบบใช้อยู่', () => {
  /* App.jsx resolve ด้วย `emp.<f> ?? profile.<f>` ⇒ ฐานพนักงานว่าง = ระบบใช้ค่าในบัญชี
     เขียน null ทับ = คนนั้นเสีย ทีม/ไลน์/ส่วนงาน ทันทีตอน login
     (วัดจริง 14/10: ส่วนงาน 8 · หน่วยผัง 2 · ทีม 1 = 11 ช่องที่จะหายถ้าเขียนทับ) */
  const patch = syncPatch({ team: 'C', line_id: null, section: '', org_node_id: 'n9' });
  assert.deepEqual(Object.keys(patch).sort(), ['org_node_id', 'team']);
  assert.equal('line_id' in patch, false);   // null = ไม่แตะ
  assert.equal('section' in patch, false);   // ''   = ไม่แตะ
  assert.equal(patch.team, 'C');
});

test('🔴🔴 syncPatch ห้ามแตะ position — คนละความหมาย ทับ = ข้อมูลหายถาวร', () => {
  const patch = syncPatch({ team: 'C', position: 'operator' });
  assert.equal('position' in patch, false);
});

test('ไม่เขียนช่องว่าง แล้วแถบเตือนยังหายจริงไหม — identityDiff นับเฉพาะช่องที่ฐานพนักงานมีค่า', () => {
  const emp  = { team: 'C', line_id: null, section: 'PD3' };     // ไลน์ว่างที่ฐานพนักงาน
  const acct = { team: 'A', line_id: 7, section: 'PD1' };        // บัญชีมีไลน์ 7 (ค่าที่ระบบใช้อยู่)
  const after = { ...acct, ...syncPatch(emp) };
  assert.deepEqual(identityDiff(after, emp), [], 'แถบเตือนต้องหาย');
  assert.equal(after.line_id, 7, 'ไลน์ในบัญชีต้องไม่ถูกล้าง');
  assert.equal(identityFallbacks(after, emp).length, 1);          // ยังเตือนให้ไปกรอกที่ทะเบียน
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

test('🔴 position ต้องอยู่ชั้น "คนละความหมาย" ไม่ใช่ชั้น "ต้องตรงกัน"', () => {
  assert.equal(IDENTITY_FIELDS.map(f => f.key).includes('position'), false);
  assert.deepEqual(DUAL_MEANING_FIELDS.map(f => f.key), ['position']);
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

test('หน่วยในผังตัดสินแล้ว (14/10) — ย้ายเข้าชั้น "ต้องตรงกัน" ไม่เหลือธง undecided', () => {
  assert.equal(DUAL_MEANING_FIELDS.some(f => f.undecided), false);
  const d = identityDiff({ org_node_id: 'pd2' }, { org_node_id: 'assyD' });
  assert.equal(d.length, 1);
  assert.equal(d[0].key, 'org_node_id');
});
