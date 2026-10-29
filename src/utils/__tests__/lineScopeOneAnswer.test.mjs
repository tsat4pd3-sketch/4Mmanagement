/* 🔭🔭 "บัญชีนี้เห็นไลน์ไหน" ต้องมีคำตอบเดียว — ด่านของการยุบ 29/10
   เดิม scopedLines() กับ scopedLineNames() ตอบคนละอย่างบนบัญชีเดียวกัน
   ⇒ อาการที่หน้างานแจ้งซ้ำทุกสัปดาห์: "เห็นของทุกไลน์ แต่เปิดกะเลือกไลน์ตัวเองไม่ได้"

   29/10 ยุบตรรกะเป็นแกนเดียว `lineScope()` แล้ว · เหลือ **ความต่างที่ตั้งใจ 1 จุด** คือ posture:
     scopedLines()     = ไลน์ที่ **เห็น**        → ครอบครัว ∪ ส่วนงาน
     scopedLineNames() = ไลน์ที่ **รับผิดชอบ**  → ครอบครัวล้วน
   (ด่าน E ใน scopeRegistryGate.test.mjs ล็อกไว้ · ยุบ = product decision ต้องถาม user)
   ไฟล์นี้บังคับว่า **นอกเหนือ posture แล้วทั้ง 2 ทางต้องตอบเหมือนกันทุกเคส** */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineScope, scopedLines, scopedLineNames } from '../sectionScope.js';

const LINES = [
  { id: 1, name: 'LWR BAR',     section: 'PD4', parent_line_name: null },
  { id: 2, name: 'LWR BAR 306', section: 'PD4', parent_line_name: 'LWR BAR' },
  { id: 3, name: '250T',        section: 'PD4', parent_line_name: null },
  { id: 4, name: 'HYDRO',       section: 'PD3', parent_line_name: null },
];
const names = rows => rows.map(l => l.name).sort();

/** ชุดที่ "ชื่อไลน์" ตอบ — แปลง null (ไม่จำกัด) ให้เทียบกับชุดเต็มได้ */
const nameSet = (args) => {
  const n = scopedLineNames(args);
  return (n === null ? LINES.map(l => l.name) : n).slice().sort();
};

/* เคสที่ posture ทำให้ต่างกันโดยเจตนา (leader + มีส่วนงานกำกับ) แยกไปเทสข้างล่าง */
const CASES = [
  ['admin',                     { role: 'admin',      lineId: null, sections: [],      lines: LINES }],
  ['supervisor PD4',            { role: 'supervisor', lineId: null, sections: ['PD4'], lines: LINES }],
  ['supervisor ไม่จำกัด',        { role: 'supervisor', lineId: null, sections: [],      lines: LINES }],
  ['leader 306 ไม่มีส่วนงาน',    { role: 'leader',     lineId: 2,    sections: [],      lines: LINES }],
  ['leader ไลน์หาย + PD4',       { role: 'leader',     lineId: 99,   sections: ['PD4'], lines: LINES }],
  ['ส่วนงานที่ผังไม่รู้จัก',      { role: 'supervisor', lineId: null, sections: ['ไม่มีจริง'], lines: LINES }],
];

for (const [label, args] of CASES) {
  test(`🔭 สองทางต้องตอบเหมือนกัน — ${label}`, () => {
    const viaObjs = names(scopedLines(args));
    const viaName = nameSet(args);
    // 'ส่วนงานที่ผังไม่รู้จัก' = ช่องว่างที่เหลืออยู่จุดเดียว (fail-closed vs fail-open) — ยกเว้นไว้ชัดๆ
    if (label === 'ส่วนงานที่ผังไม่รู้จัก') {
      assert.deepEqual(viaObjs, [], 'ฝั่งตัวไลน์ยัง fail-closed');
      assert.equal(lineScope(args).unsure, true, '🔴 ต้องตั้งธง unsure ให้จอเขียนบนจอ');
      return;
    }
    assert.deepEqual(viaObjs, viaName, `🔴 ${label}: 2 ทางตอบไม่ตรงกัน = บั๊กเรื้อรังกลับมาแล้ว`);
  });
}

test('🔴 posture ต่างกันโดยเจตนา — "เห็น" กว้างกว่า "รับผิดชอบ" (ด่าน E)', () => {
  const a = { role: 'leader', lineId: 2, sections: ['PD4'], lines: LINES };
  // เห็น = ครอบครัว ∪ ส่วนงาน
  assert.deepEqual(names(scopedLines(a)), ['250T', 'LWR BAR', 'LWR BAR 306']);
  // รับผิดชอบ = ครอบครัวล้วน
  assert.deepEqual(nameSet(a), ['LWR BAR', 'LWR BAR 306']);
  // ทั้ง 2 ท่า ข้ามส่วนงานห้ามเห็น
  assert.ok(!names(scopedLines(a)).includes('HYDRO'));
  assert.ok(!nameSet(a).includes('HYDRO'));
});

test('🔴 sections ว่าง (scope_depth=all ที่ตั้งผิด) ยังถูกบีบเหลือครอบครัวไลน์ตัวเอง', () => {
  // "ครอบครัว" = ตัวเอง + สายแม่ + ลูก (getLineFamily · ไม่ลากไลน์พี่น้องมา)
  assert.deepEqual(nameSet({ role: 'leader', lineId: 2, sections: [], lines: LINES }), ['LWR BAR', 'LWR BAR 306']);
  assert.deepEqual(nameSet({ role: 'leader', lineId: 1, sections: [], lines: LINES }), ['LWR BAR', 'LWR BAR 306']);
  // ยังไม่หลุดไปเห็นทั้งโรงงาน — 250T อยู่ PD4 เหมือนกันแต่ไม่ใช่ครอบครัว
  const n = nameSet({ role: 'leader', lineId: 2, sections: [], lines: LINES });
  assert.ok(!n.includes('HYDRO') && !n.includes('250T'));
});

test('🔴 ทะเบียนยังไม่โหลด = ไม่จำกัด + unsure (ห้ามคืน [] = จอว่างทั้งระบบ)', () => {
  const r = lineScope({ role: 'leader', lineId: 2, sections: ['PD4'], lines: [] });
  assert.equal(r.unlimited, true);
  assert.equal(r.unsure, true);
  assert.equal(r.reason, 'registry_unloaded');
  assert.deepEqual(scopedLines({ role: 'leader', lineId: 2, sections: ['PD4'], lines: [] }), []);
});

test('🔴 หาไลน์ตัวเองไม่เจอ = unsure ทุกทาง (จอต้องบอก ไม่ใช่โชว์ "ไม่มีรายการ")', () => {
  assert.equal(lineScope({ role: 'leader', lineId: 99, sections: ['PD4'], lines: LINES }).unsure, true);
  assert.equal(lineScope({ role: 'leader', lineId: 99, sections: [],      lines: LINES }).unsure, true);
});

test('lines กับ names เป็นชุดเดียวกันเสมอ (ในท่าเดียวกัน)', () => {
  for (const [, args] of CASES.map(c => c)) {
    const r = lineScope(args);
    assert.deepEqual(r.names.slice().sort(), names(r.lines), 'สองช่องนี้ห้ามไม่ตรงกัน');
  }
});
