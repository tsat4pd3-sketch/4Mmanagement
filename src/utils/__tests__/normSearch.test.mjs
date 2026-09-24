/* 🔎 ตัว normalize คำค้นกลางของ picker ทุกตัว — `normSearch` (src/components/SearchSelect.jsx)
 *
 * ── บั๊กที่กันไว้ (23/09/2026 · เกิดจริงที่ /add-user) ───────────────────────
 * ฐานพนักงานเก็บ `เจนนิภา เจริญพันธ` (ไม่มี ์ ท้าย) · admin พิมพ์ค้น `เจนนิภา เจริญพันธ์`
 * ⇒ เทียบตรงๆ ไม่เจอ ⇒ dropdown ว่าง ⇒ สรุปว่า "ไม่มีคนนี้ในฐาน" ⇒ กดเพิ่มคนใหม่
 * ⇒ ชนรหัสพนักงานซ้ำ (2103622) ⇒ ตัน · วนซ้ำจนไม่เชื่อหน้าจอ
 *
 * **ชื่อคนไทยในฐานพิมพ์มือ สะกดต่างกัน 1 ตัวเสมอ — ตัวค้นต้องทน ไม่ใช่ให้คนพิมพ์ให้เป๊ะ**
 *
 * ไฟล์นี้อ่านซอร์สแล้วประเมินฟังก์ชันตรงๆ (SearchSelect.jsx เป็น .jsx + import react
 * จึง import เข้าเทสไม่ได้ — ดึงเฉพาะบรรทัดนิยามมารันแทน)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../../components/SearchSelect.jsx', import.meta.url), 'utf8');

/** ดึงนิยาม THAI_MARKS + normSearch ออกมาประกอบเป็นฟังก์ชันจริง (ไม่ mock ไม่เขียนซ้ำ) */
function loadNormSearch() {
  const marks = SRC.match(/const THAI_MARKS = (\/\[[^\n]*?\/g);/);
  const body  = SRC.match(/export const normSearch = ([\s\S]*?);\n/);
  assert.ok(marks, 'หา THAI_MARKS ในซอร์สไม่เจอ — ถ้าเปลี่ยนชื่อ/ย้ายที่ ให้แก้เทสนี้ด้วย');
  assert.ok(body,  'หา normSearch ในซอร์สไม่เจอ — ถ้าเปลี่ยนชื่อ/ย้ายที่ ให้แก้เทสนี้ด้วย');
  // eslint-disable-next-line no-new-func
  return new Function(`const THAI_MARKS = ${marks[1]}; return (${body[1]});`)();
}
const normSearch = loadNormSearch();

test('🔴 ทัณฑฆาต (์) ต่างกัน ต้องยังค้นเจอ — เคสจริง เจนนิภา เจริญพันธ(์)', () => {
  assert.equal(normSearch('เจนนิภา เจริญพันธ์'), normSearch('เจนนิภา เจริญพันธ'));
  assert.ok(normSearch('เจนนิภา เจริญพันธ').includes(normSearch('เจริญพันธ์')));
});

test('ช่องว่างซ้ำ / ขีด / จุด / วงเล็บ ไม่มีผล (ของเดิม ห้าม regress)', () => {
  assert.equal(normSearch('ชะเอ็ม  เศียรเขียว'), normSearch('ชะเอ็ม เศียรเขียว'));
  assert.equal(normSearch('M8 D6.6'), normSearch('m8-d6_6'));
  assert.equal(normSearch('LINE A ( 800 Ton )'), normSearch('linea800ton'));
});

test('วรรณยุกต์/สระบน-ล่าง ก็ต้องทน (ชื่อไทยพิมพ์มือต่างกันได้)', () => {
  assert.equal(normSearch('อำพรรณ์'), normSearch('อำพรรณ'));
  // เคสจริงในฐาน: ชื่อมีช่องว่างซ้อน 3 เคาะ + วิสิทธิ์ (มี ์ กลางคำ)
  assert.equal(normSearch('นายกีรติวุฒิ   วิสิทธิ์ศิลป์'), normSearch('นายกีรติวุฒิ วิสิทธิศิลป'));
  assert.equal(normSearch('ม้า'), normSearch('มา'));        // ผลข้างเคียงที่ยอมรับ — เป็นแค่ตัวกรอง
});

test('ตัวพยัญชนะต่างกัน ต้องยังแยกออก (ห้ามตัดจนกลายเป็นคนละคนก็ match)', () => {
  assert.notEqual(normSearch('สมชาย'), normSearch('สมหญิง'));
  assert.notEqual(normSearch('ไพรัชช์'), normSearch('อภิเดช'));
});

test('ค่าว่าง / null / ตัวเลข ไม่ throw', () => {
  assert.equal(normSearch(null), '');
  assert.equal(normSearch(undefined), '');
  assert.equal(normSearch(2103622), '2103622');
});
