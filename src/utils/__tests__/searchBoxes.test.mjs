/* ช่องค้นหากลาง 2 ตัว — ล็อกการแก้ 2 บั๊กที่ build/lint/crashsweep ผ่านหมดแต่ใช้งานจริงไม่ได้ (2026-10-01)
   ตรวจบนจอจริงด้วย `node audit/searchsweep.mjs` (ต้องเปิด vite audit) — เทสนี้คือด่านขั้นต่ำใน build */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (p) => readFileSync(new URL(`../../components/${p}`, import.meta.url), 'utf8');

test('SearchSelect: ระหว่างพิมพ์ คำค้น = สิ่งที่พิมพ์ ไม่ใช่ "ตัวที่เลือก" (พิมพ์ 274 แล้วขึ้นครบ 128 รายการ)', () => {
  const s = src('SearchSelect.jsx');
  assert.match(s, /const q = typing \? innerText/, 'q ต้องใช้คำที่กำลังพิมพ์เมื่อ typing — ไม่งั้น option "นอกทะเบียน" ที่ history เติมกลับจะทำให้ q=\'\'');
  assert.match(s, /setTyping\(true\)/, 'onChange ของช่องต้องตั้ง typing');
});

test('SearchInput: ที่ว่างของไอคอน 🔍 อยู่ที่ช่องเอง (inline) — class แพ้กฎแถบกรอง (0,6,1)', () => {
  const s = src('SearchInput.jsx');
  assert.match(s, /paddingLeft:\s*30/);
  assert.match(s, /style=\{\{ \.\.\.ICON_PAD, \.\.\.inputStyle \}\}/);
});
