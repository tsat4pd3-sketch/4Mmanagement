/* ประมาณการ "Downtime ลงเกินจริงกี่นาที" ตอน %P ทะลุ 100 (2026-09-17 · user ยืนยันว่าเจอบ่อยที่สุด)

   กลไก: ลง downtime เกินจริง → runMin หดผิด → %A ตกลง (ดูเหมือนความผิดเครื่อง/ซ่อมบำรุง)
          แล้ว %P ดีดขึ้นชนเพดานพอดี เพราะตัวหารเล็กลง = ย้ายความผิดออกจากไลน์

   ปัญหาคือ "CT ช้า" กับ "DT เกินจริง" ให้อาการเหมือนกันเป๊ะ (%P ทะลุ 100 ทั้งคู่)
   ⇒ ตัวเลขนี้จึงพูดแบบมีเงื่อนไขเสมอ: "ถ้า CT กับยอดถูกต้อง แล้ว DT เกินไปอย่างน้อยเท่านี้"

   ฐาน: งานที่ผลิตได้ต้องใช้เวลาเดินเครื่องอย่างน้อย stdMin นาที
        ถ้า stdMin > runMin ⇒ downtime ต้องหดลงอย่างน้อย (stdMin − runMin) ถึงจะเป็นไปได้ */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

/** ถอดมาจากสาย sequential ใน computeSessionOee (src/utils/oee.js §8) */
const dtOverstate = (stdSec, runMin) => {
  const ratio = stdSec / (runMin * 60);
  return ratio > 1.001 ? Math.round(stdSec / 60 - runMin) : null;
};

test('🔴 ลง DT เกินจริง — งาน 400 นาที แต่อ้างว่าเครื่องเดินแค่ 300 ⇒ เกินอย่างน้อย 100 นาที', () => {
  assert.equal(dtOverstate(400 * 60, 300), 100);
});

test('กะปกติ (งานน้อยกว่าเวลาเดินเครื่อง) ⇒ ไม่เตือน', () => {
  assert.equal(dtOverstate(250 * 60, 300), null);
});

test('พอดีเป๊ะ ⇒ ไม่เตือน (ต้องเผื่อ tolerance กันเลขปัดเศษ)', () => {
  assert.equal(dtOverstate(300 * 60, 300), null);
});

test('เกินนิดเดียวจากการปัดเศษ ⇒ ยังไม่เตือน (ต่ำกว่าเกณฑ์ 0.1%)', () => {
  assert.equal(dtOverstate(300.2 * 60, 300), null);
});

test('เคสหนัก — อ้างว่าเดินเครื่องแค่ 120 นาที แต่ทำงานได้ 600 นาที', () => {
  assert.equal(dtOverstate(600 * 60, 120), 480);
});

test('runMin = 0 — ของจริงไปไม่ถึงตรงนี้ (computeOEE กัน runSec > 0 ไว้ก่อนแล้ว → %P = null)', () => {
  // บันทึกไว้ว่าสูตรเองยังให้ค่าที่อ่านได้ ไม่ใช่ NaN/Infinity เผื่อวันหน้ามีใครย้ายด่านนั้นออก
  const v = dtOverstate(100 * 60, 0);
  assert.equal(Number.isFinite(v), true, 'ต้องไม่เป็น Infinity/NaN');
  assert.equal(v, 100);
});

test('🛡️ ด่าน runSec > 0 ใน computeSessionOee ต้องยังอยู่ — ไม่งั้นกะที่ไม่มีเวลาเดินเครื่องจะได้ %P เพี้ยน', () => {
  // สูตรปิดกะย้ายจาก DailyReport.computeOEE → oee.js `computeSessionOee` เมื่อ 24/09/2026
  const src = readFileSync(new URL('../oee.js', import.meta.url), 'utf8');
  assert.ok(/if \(runSec > 0 && matPData\.length > 0\)/.test(src),
    'ด่าน `if (runSec > 0 && matPData.length > 0)` หายไปจาก computeSessionOee');
});
