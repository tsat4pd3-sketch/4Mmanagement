/* 🔭 สวิตช์ "ขอบเขตการมองเห็น" จาก role/ช่องว่าง → `profiles.scope_depth`   2026-09-25
 *
 * ── ทำไมต้องมีเทสชุดนี้ ────────────────────────────────────────────────────
 * การสลับตัวคำนวณขอบเขตคือจุดที่ **พังเงียบ** ได้ง่ายที่สุดในงานสิทธิ์ทั้งชุด:
 * คนหายจากจอ / ไม่ได้รับแจ้งเตือน โดยไม่มี error และไม่มีใครรู้ว่าเกิดขึ้น
 * ⇒ กติกาที่ตั้งไว้ก่อนสลับ (docs/ORG-AXES-DECISION.md §7.6):
 *   **"ต้องพิสูจน์ว่าผลเท่าเดิม กับชุดค่าที่มีอยู่จริงในฐาน ก่อนสลับ"**
 *
 * ไฟล์นี้คือหลักฐานนั้น — ชุดค่าด้านล่าง **ถอดจาก 97 บัญชีจริง** (นับจริง 25/09)
 * ถ้าใครแก้ `effectiveSections` แล้วเทสตก = พฤติกรรมเปลี่ยนจริง ไม่ใช่เทสงี่เง่า
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveSections, scopedLineNames, scopeIneffective } from '../sectionScope.js';

/** ตรรกะ **ก่อน** 25/09 — คัดลอกไว้เป็นตัวเทียบ ห้ามแก้ให้ตรงกับของใหม่ */
function oldEffectiveSections(role, sections, section) {
  if (!role || role === 'admin') return [];
  if (['qa'].includes(role)) return [];                       // FACTORY_WIDE_ROLES
  const arr = Array.isArray(sections) ? sections.filter(Boolean) : [];
  if (arr.length) return arr;
  if (role === 'supervisor' && section) return [section];
  return [];
}

/* ชุดค่าที่มีอยู่จริงในฐาน — **ทุกรูปแบบที่ปรากฏจริง 29 แบบ รวม 97 บัญชี** (วัด 25/09)
   [role, scope_depth, sections, section, จำนวนบัญชี]
   ⚠️ นี่คือ "ภาพถ่าย" ของข้อมูลจริง **ห้ามแต่งให้สวย** — รูปแบบแปลกๆ ในนี้คือของจริงทั้งหมด
      เช่น admin ที่มี sections ค้าง · warehouse_delivery ที่ sections เป็น [] แต่ section มีค่า
      · leader ที่ไม่มี sections แต่มี section (3 ใบที่ fail-open) */
const REAL = [
  ['mtn',               'all',    null,                                        null,             15],
  ['supervisor',        'branch', ['PD3'],                                     'PD3',            11],
  ['leader',            'branch', ['PD3'],                                     'PD3',            10],
  ['qa',                'all',    ['PD3'],                                     'PD3',             8],
  ['qa',                'all',    ['QA'],                                      'QA',              6],
  ['qa',                'all',    ['PD3','PD4'],                               'PD3',             6],
  ['warehouse_delivery','all',    [],                                          'Planning&Store',  5],
  ['supervisor',        'branch', ['PD1'],                                     'PD1',             4],
  ['supervisor',        'branch', ['PD4'],                                     'PD4',             4],
  ['leader',            'branch', ['PD4'],                                     'PD4',             3],
  ['leader',            'branch', ['PD2'],                                     'PD2',             3],
  ['admin',             'all',    null,                                        null,              2],
  ['display',           'all',    null,                                        null,              2],
  ['leader',            'all',    null,                                        'PD3',             2],
  ['supervisor',        'branch', ['PD2'],                                     'PD2',             2],
  ['admin',             'all',    ['PD3'],                                     'PD3',             1],
  ['admin',             'all',    ['Planning&Store'],                          'Planning&Store',  1],
  ['display',           'branch', ['PD3'],                                     'PD3',             1],
  ['document_control',  'branch', ['PD3'],                                     'PD3',             1],
  ['document_control',  'branch', ['PD4'],                                     'PD4',             1],
  ['engineer',          'all',    null,                                        null,              1],
  ['leader',            'all',    null,                                        'PD4',             1],
  ['manager',           'all',    null,                                        null,              1],
  ['manager',           'branch', ['PD1'],                                     'PD1',             1],
  ['manager',           'branch', ['Planning&Store','PD1','PD2','PD3','PD4'],  'Planning&Store',  1],
  ['manager',           'branch', ['PD2'],                                     'PD2',             1],
  ['planner_store',     'all',    [],                                          'Planning&Store',  1],
  ['supervisor',        'branch', ['PD3','PD4'],                               'PD3',             1],
  ['supervisor',        'branch', ['PD2','PD1'],                               'PD2',             1],
];

test('🔴 สลับแล้วผลต้องเท่าเดิมทุกรูปแบบที่มีอยู่จริงในฐาน (97 บัญชี)', () => {
  const diffs = [];
  let covered = 0;
  for (const [role, depth, sections, section, n] of REAL) {
    covered += n;
    const before = oldEffectiveSections(role, sections, section);
    const after  = effectiveSections(role, sections, section, depth);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diffs.push(`${role} / ${depth} / ${JSON.stringify(sections)} → เก่า ${JSON.stringify(before)} · ใหม่ ${JSON.stringify(after)} (${n} บัญชี)`);
    }
  }
  assert.equal(covered, 97, 'ชุดทดสอบต้องครอบคลุมครบ 97 บัญชี — ถ้าจำนวนบัญชีจริงเปลี่ยน ให้วัดใหม่แล้วอัพเดทที่นี่');
  assert.deepEqual(diffs, [],
    '\n\n❌ สลับตัวคำนวณแล้วขอบเขตเปลี่ยน ' + diffs.length + ' รูปแบบ\n'
    + '   นี่คือคลาสบั๊กที่ผู้ใช้จะไม่มีทางรู้ว่าเกิด (คนหายจากจอ / ไม่ได้แจ้งเตือน เงียบๆ)\n\n'
    + diffs.map(d => '   • ' + d).join('\n') + '\n');
});

test('🔴 admin ต้องไม่มีทางถูกล็อกออกจากระบบด้วยค่าที่ตั้งผิด', () => {
  // ตาข่ายกันตาย — หลักเดียวกับ hasPermission()
  assert.deepEqual(effectiveSections('admin', ['PD1'], 'PD1', 'self'), []);
  assert.deepEqual(effectiveSections('admin', null, null, 'unit'), []);
  assert.equal(scopedLineNames({ role: 'admin', sections: ['PD1'], lines: [{ id: 1, name: 'A', section: 'PD9' }] }), null);
});

test('ยังโหลดไม่เสร็จ (scope_depth undefined) = ใช้ตรรกะเดิม ห้ามจำกัดมั่ว', () => {
  // ถ้าตีความว่า "แคบสุด" ระหว่างโหลด จอจะว่างทั้งระบบชั่วขณะ
  assert.deepEqual(effectiveSections('qa', ['PD3'], 'PD3', undefined), [], 'qa เดิม = ไม่จำกัด');
  assert.deepEqual(effectiveSections('supervisor', null, 'PD2', undefined), ['PD2']);
  assert.deepEqual(effectiveSections('leader', ['PD1'], null, null), ['PD1']);
});

test('🔭 ตั้ง all = ไม่จำกัด แม้จะมี sections ค้างอยู่', () => {
  assert.deepEqual(effectiveSections('qa', ['PD3'], 'PD3', 'all'), []);
  assert.deepEqual(effectiveSections('manager', ['PD1','PD2'], null, 'all'), []);
});

test('🔭 ตั้งแคบ = จำกัดจริง แม้ role เคยถูก hardcode ว่าเห็นทั้งโรงงาน', () => {
  // เดิม qa/mtn ถูก hardcode ⇒ ตั้งขอบเขตจากจอแล้วไม่มีผลเงียบๆ
  assert.deepEqual(effectiveSections('qa',  ['PD3'], 'PD3', 'branch'), ['PD3']);
  assert.deepEqual(effectiveSections('mtn', ['PD1'], null,  'branch'), ['PD1']);
  const lines = [{ id: 1, name: 'L1', section: 'PD1' }, { id: 2, name: 'L2', section: 'PD9' }];
  assert.deepEqual(scopedLineNames({ role: 'mtn', sections: ['PD1'], lines }), ['L1'],
    'ช่างที่ถูกจำกัดต้องเห็นเฉพาะไลน์ในขอบเขต — เดิมคืน null (ทั้งโรงงาน) เสมอ');
});

test('✅ ช่างที่ไม่ได้ตั้งขอบเขต ยังเห็นทั้งโรงงานเหมือนเดิม (16 บัญชีจริง)', () => {
  const lines = [{ id: 1, name: 'L1', section: 'PD1' }];
  assert.equal(scopedLineNames({ role: 'mtn', sections: [], lines }), null);
  assert.equal(scopedLineNames({ role: 'engineer', sections: [], lines }), null);
});

test('🚩 ตั้งแคบแต่ไม่มีหน่วยให้ยึด = ยังไม่จำกัดจริง ต้องฟ้อง ห้ามเงียบ', () => {
  assert.equal(scopeIneffective({ role: 'leader', scope_depth: 'unit', sections: null, section: null }), true);
  assert.deepEqual(effectiveSections('leader', null, null, 'unit'), [],
    'ยังคืน "ไม่จำกัด" เพราะจำกัดให้อยู่ในหน่วยตัวเองไม่ได้ถ้าไม่เคยบอกว่าหน่วยไหน');
  // มี anchor แล้ว = ไม่ต้องฟ้อง
  assert.equal(scopeIneffective({ role: 'leader', scope_depth: 'unit', sections: ['PD1'] }), false);
  assert.equal(scopeIneffective({ role: 'leader', scope_depth: 'all',  sections: null }), false, 'all = ตั้งใจให้กว้าง');
  assert.equal(scopeIneffective({ role: 'admin',  scope_depth: 'unit', sections: null }), false, 'admin ยกเว้น');
});
