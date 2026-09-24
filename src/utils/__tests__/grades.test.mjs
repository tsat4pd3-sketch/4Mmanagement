/* 🎓 เกรด — กฎ "เลขน้อย = สูงกว่า" และเครื่องหมายรักษาการ          2026-09-24
 *
 * บั๊กที่ด่านนี้กัน: เทียบเกรดด้วยสตริง/`.sort()` ตามโค้ด
 *   `'T3' < 'T6'` เป็นจริง **แต่ T3 สูงกว่า T6** ⇒ เรียงกลับหัวโดยไม่มีสัญญาณ
 * (ผังทางการ: หัวหน้ากลุ่ม T1-T3 · พนักงานทั่วไป T6-T8)
 *
 * ไฟล์นี้ mock cache ของ grades.js ตรงๆ เพื่อไม่ต้องต่อ DB
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../grades.js', import.meta.url), 'utf8');

/* ประกอบฟังก์ชันจริงจากซอร์ส โดยแทน import supabase ด้วยของปลอม
   (grades.js import supabase ซึ่งลาก env เข้ามา — เทสไม่ต้องการส่วนนั้น) */
async function loadModule(rows) {
  const body = SRC
    .replace(/^import .*$/m, '')                       // ตัด import supabase
    .replace(/export async function loadGrades[\s\S]*?\n}\n/, '')  // ตัดตัวโหลด DB
    .replace(/export /g, '');
  const fn = new Function(`${body}; _rows = ${JSON.stringify(rows)};
    return { gradeRank, compareGrades, actingMark, gradeFitsPosition, gradesSync, gradeRow, ACTING_MARKS };`);
  return fn();
}

const ROWS = [
  { code: 'M1', band: 'M', rank: 730, label_th: 'ผู้จัดการ' },
  { code: 'M3', band: 'M', rank: 710, label_th: 'ผู้จัดการ' },
  { code: 'S1', band: 'S', rank: 630, label_th: 'หัวหน้าส่วน' },
  { code: 'S3', band: 'S', rank: 610, label_th: 'หัวหน้าแผนก' },
  { code: 'T3', band: 'T', rank: 510, label_th: 'หัวหน้ากลุ่ม' },
  { code: 'T6', band: 'T', rank: 430, label_th: 'พนักงานทั่วไป' },
];

test('🔴 เลขน้อย = สูงกว่า — เคสที่เทียบสตริงแล้วผิด', async () => {
  const g = await loadModule(ROWS);
  assert.ok(g.gradeRank('T3') > g.gradeRank('T6'),
    'T3 (หัวหน้ากลุ่ม) ต้องสูงกว่า T6 (พนักงานทั่วไป) — เทียบสตริงจะได้ตรงข้าม');
  assert.ok(g.gradeRank('S1') > g.gradeRank('S3'), 'หัวหน้าส่วน S1 สูงกว่าหัวหน้าแผนก S3');
  assert.ok(g.gradeRank('M3') > g.gradeRank('S1'), 'ผู้จัดการต่ำสุด ยังสูงกว่าหัวหน้าส่วนสูงสุด');
});

test('ไม่รู้จักเกรด = null ไม่ใช่ 0 (แยก "ต่ำสุด" ออกจาก "ไม่รู้")', async () => {
  const g = await loadModule(ROWS);
  assert.equal(g.gradeRank('ZZ9'), null);
  assert.equal(g.gradeRank(''), null);
  assert.equal(g.gradeRank(null), null);
  assert.equal(g.compareGrades('S1', 'ZZ9'), null, 'เทียบกับค่าที่ไม่รู้จัก ต้องไม่เดาว่าเท่ากัน');
});

test('เครื่องหมายรักษาการตรงตามหมายเหตุแม่แบบ', async () => {
  const g = await loadModule(ROWS);
  // เคสจริงจากผังรวม: คนเกรด S1 รักษาการตำแหน่งผู้จัดการ (M1-M3) → สูงกว่า → '*'
  assert.equal(g.actingMark('S1', ['M1', 'M3']).mark, '*');
  // สูงกว่าแต่ cost center เดียวกัน → ไม่ใส่เครื่องหมาย
  assert.equal(g.actingMark('S1', ['M1', 'M3'], { sameCostCenter: true }).mark, '');
  // ไปรักษาการตำแหน่งที่ต่ำกว่า → '**'
  assert.equal(g.actingMark('M1', ['S1']).mark, '**');
  // เท่ากัน → '**' (แม่แบบรวม "เท่ากับหรือต่ำกว่า" ไว้ด้วยกัน)
  assert.equal(g.actingMark('S1', ['S1']).mark, '**');
});

test('ข้อมูลไม่พอ = null ห้ามเดาเครื่องหมาย', async () => {
  const g = await loadModule(ROWS);
  assert.equal(g.actingMark(null, ['M1']), null, 'ไม่รู้เกรดจริงของคน');
  assert.equal(g.actingMark('S1', []), null, 'ตำแหน่งที่ไปรักษาการไม่ได้ระบุเกรด');
  assert.equal(g.actingMark('S1', ['ไม่มีเกรดนี้']), null);
});

test('ตรวจเกรดกับตำแหน่ง — เตือนได้ แต่ต้องมีสถานะ "ไม่รู้" ด้วย', async () => {
  const g = await loadModule(ROWS);
  assert.equal(g.gradeFitsPosition('S1', ['S1']), 'ok');
  assert.equal(g.gradeFitsPosition('S3', ['S1']), 'mismatch');
  assert.equal(g.gradeFitsPosition('S1', null), 'unknown', 'แม่แบบไม่ได้ระบุ = ไม่รู้ ไม่ใช่ผิด');
  assert.equal(g.gradeFitsPosition(null, ['S1']), 'unknown', 'ยังไม่กรอกเกรด = ไม่รู้ ไม่ใช่ผิด');
});
