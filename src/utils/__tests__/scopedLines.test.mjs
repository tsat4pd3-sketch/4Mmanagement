/* 🔭 scopedLines — "ไลน์ที่เห็นได้" คืนตัวไลน์ ผ่านผังองค์กร (2026-10-22)
   คุมสัญญา 3 ข้อที่ห้ามหลุด: ขยายผ่านผังได้ · ไม่ส่งดัชนี = เหมือนเดิมเป๊ะ · ห้ามคืน [] ตอนยังไม่รู้ */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOrgScope } from '../orgScope.js';
import { scopedLines } from '../sectionScope.js';

const nodes = [
  { id: 's1', kind: 'section',    name: 'PD1', code: 'PD1', parent_id: null },
  { id: 'd1', kind: 'department', name: 'BIG PRESS',   parent_id: 's1' },
  { id: 'd2', kind: 'department', name: 'SMALL PRESS', parent_id: 's1' },
  { id: 'l1', kind: 'line', name: 'LINE A ( 800 Ton )',     parent_id: 'd1', ref_line_id: 17 },
  { id: 'l2', kind: 'line', name: 'LINE C ( 200&250 Ton )', parent_id: 'd2', ref_line_id: 19 },
];
const lines = [
  { id: 17, name: 'LINE A ( 800 Ton )',     section: 'PD1', is_active: true },
  { id: 19, name: 'LINE C ( 200&250 Ton )', section: 'PD1', is_active: true },
];
const idx = buildOrgScope({ nodes, lines });
const names = (arr) => arr.map(l => l.name);

test('ขอบเขตระดับแผนก → เห็นเฉพาะไลน์ใต้แผนกนั้น (เดิมเทียบ section จะเห็นทั้ง PD1)', () => {
  assert.deepEqual(names(scopedLines({ sections: ['SMALL PRESS'], lines, scopeIdx: idx })),
    ['LINE C ( 200&250 Ton )']);
  // ไม่ส่งดัชนีผัง = พฤติกรรมเดิม: 'SMALL PRESS' ไม่ตรง l.section ของใครเลย
  assert.deepEqual(scopedLines({ sections: ['SMALL PRESS'], lines }), []);
});

test('ขอบเขตระดับส่วนงาน = ผลเท่าเดิมทั้งสองทาง', () => {
  assert.deepEqual(names(scopedLines({ sections: ['PD1'], lines, scopeIdx: idx })), names(lines));
  assert.deepEqual(names(scopedLines({ sections: ['PD1'], lines })), names(lines));
});

test('🔴 ไม่จำกัด / ทะเบียนยังไม่โหลด → คืนทั้งก้อน ห้ามคืน [] (จอว่างระหว่างโหลด)', () => {
  assert.deepEqual(scopedLines({ sections: [], lines, scopeIdx: idx }), lines);
  assert.deepEqual(scopedLines({ sections: [null, ''], lines, scopeIdx: idx }), lines);
  assert.deepEqual(scopedLines({ sections: ['PD1'], lines: [], scopeIdx: idx }), []);
});

test('🔴 ชื่อที่ผังไม่รู้จัก → ถอยไปเทียบข้อความ ห้ามบีบให้แคบเงียบ', () => {
  const out = scopedLines({ sections: ['ส่วนงานเก่า'], lines, scopeIdx: idx });
  assert.deepEqual(out, []);                                  // ไม่ตรงใครเลย = เท่าพฤติกรรมเดิม
  const mixed = scopedLines({ sections: ['ส่วนงานเก่า', 'PD1'], lines, scopeIdx: idx });
  assert.deepEqual(names(mixed), names(lines));               // ยังเห็นของ PD1 ตามเดิม
});

/* ══ 🔴 ตาข่ายกันตั้งค่าผิด: หัวหน้ากลุ่ม (leader) ที่ผูกไลน์ ต้องเห็นเฉพาะครอบครัวไลน์ตัวเอง ══
   เคสจริง 24/10 — หัวหน้า LWR BAR / HYDROFORM ถูกตั้ง `scope_depth='all'` ⇒ sections = []
   ⇒ เดิมจอที่กรองด้วย sections อย่างเดียวโชว์ทั้งโรงงาน (user แจ้ง "เห็นทุกไลน์ผลิตเลย") */
test('🔴 leader + lineId → เห็นเฉพาะ family แม้ sections ว่าง (scope_depth=all)', () => {
  const out = scopedLines({ role: 'leader', lineId: 17, sections: [], lines, scopeIdx: idx });
  assert.deepEqual(names(out), ['LINE A ( 800 Ton )']);
});

test('🔴 leader + lineId → แกนไลน์ชนะแกนส่วนงานเสมอ (ตั้ง PD1 ก็ยังเหลือไลน์ตัวเอง)', () => {
  const out = scopedLines({ role: 'leader', lineId: 17, sections: ['PD1'], lines, scopeIdx: idx });
  assert.deepEqual(names(out), ['LINE A ( 800 Ton )']);
  // ไม่ใช่ leader = พฤติกรรมเดิม (ทั้งส่วนงาน)
  assert.deepEqual(names(scopedLines({ role: 'supervisor', sections: ['PD1'], lines, scopeIdx: idx })), names(lines));
});

test('🔴 leader ที่หาไลน์ตัวเองไม่เจอ = fail-closed (คืน []) ไม่ใช่เห็นทั้งโรงงาน', () => {
  assert.deepEqual(scopedLines({ role: 'leader', lineId: 999, sections: [], lines, scopeIdx: idx }), []);
  // ทะเบียนยังไม่โหลด = คืนของเดิม ไม่ใช่ fail-closed (จอต้องไม่ว่างระหว่างโหลด)
  assert.deepEqual(scopedLines({ role: 'leader', lineId: 999, sections: [], lines: [], scopeIdx: idx }), []);
});

test('admin = ไม่จำกัดเสมอ (ตาข่ายกันตาย)', () => {
  assert.deepEqual(names(scopedLines({ role: 'admin', lineId: 17, sections: ['PD1'], lines, scopeIdx: idx })), names(lines));
});
