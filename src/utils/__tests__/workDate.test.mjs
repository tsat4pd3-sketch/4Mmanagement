import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWorkDate, getCurrentShift, localDateStr, WORK_DAY_START_HOUR } from '../workDate.js';

/* 📅 วันทำงาน — ทุกเคสส่ง `now` เองเสมอ ห้ามอ้างเวลาจริง (กันเทสระเบิดเวลา) */

const at = (s) => new Date(s);   // สร้างตามเวลาเครื่อง (เจตนา — ฟังก์ชันนี้ทำงานตามเวลาเครื่อง)

test('ก่อน 08:00 นับเป็นวันก่อนหน้า (กะดึกข้ามเที่ยงคืน)', () => {
  assert.equal(getWorkDate(at('2026-09-23T07:59:00')), '2026-09-22');
  assert.equal(getWorkDate(at('2026-09-23T08:00:00')), '2026-09-23');
  assert.equal(getWorkDate(at('2026-09-23T03:00:00')), '2026-09-22');
  assert.equal(getWorkDate(at('2026-09-23T23:59:00')), '2026-09-23');
});

test('🔴 ข้ามเดือน/ข้ามปี — ตี 3 ของวันที่ 1 ต้องได้วันสุดท้ายของเดือนก่อน', () => {
  assert.equal(getWorkDate(at('2026-03-01T03:00:00')), '2026-02-28');
  assert.equal(getWorkDate(at('2024-03-01T03:00:00')), '2024-02-29');   // อธิกสุรทิน
  assert.equal(getWorkDate(at('2026-01-01T03:00:00')), '2025-12-31');
});

test('🔴 ไม่ใช้ UTC — เที่ยงคืนครึ่งตามเวลาเครื่องต้องไม่เด้งไปอีกวัน', () => {
  /* กับดักที่กฎ CLAUDE.md ห้ามไว้: `toISOString().slice(0,10)` ที่เวลาไทย 00:30
     จะได้ "เมื่อวาน 17:30 UTC" = วันก่อนหน้า ซึ่งบังเอิญตรงกับคำตอบที่ถูก
     ⇒ เคสที่แยกออกจริงคือ **08:30** (ไทย = วันนี้ · UTC = 01:30 วันเดียวกันก็จริง
        แต่ถ้าเครื่องอยู่โซนอื่นจะเพี้ยน) จึงล็อกด้วย localDateStr แทนการเทียบ ISO */
  assert.equal(getWorkDate(at('2026-09-23T08:30:00')), localDateStr(at('2026-09-23T08:30:00')));
  assert.equal(localDateStr(at('2026-09-05T00:30:00')), '2026-09-05', 'ต้องเป็นวันตามเครื่อง ไม่ใช่ UTC');
});

test('กะ: เช้า 08:00–19:59 · ดึก 20:00–07:59', () => {
  assert.equal(getCurrentShift(at('2026-09-23T08:00:00')), 'day');
  assert.equal(getCurrentShift(at('2026-09-23T19:59:00')), 'day');
  assert.equal(getCurrentShift(at('2026-09-23T20:00:00')), 'night');
  assert.equal(getCurrentShift(at('2026-09-23T07:59:00')), 'night');
  assert.equal(WORK_DAY_START_HOUR, 8);
});
