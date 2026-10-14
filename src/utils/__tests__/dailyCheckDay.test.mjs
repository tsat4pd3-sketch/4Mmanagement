/* ── "ช่องว่างในตารางตรวจรายวันแปลว่าอะไร" (2026-10-13 · คำสั่ง user) ──────────────────────
   *"ถ้าไม่มีเปิดกะไม่มีผลิต ต้องทำให้ข้อมูลแยกชัดเจนว่า ไม่ได้ตรวจ หรือไม่ได้ทำการผลิต
     หรือต้องตรวจในวันนั้น"*
   เทสนี้ล็อก 2 อย่างที่พลาดแล้วเจ็บที่สุด:
     1. **"ไม่รู้" ต้องไม่กลายเป็น "ไม่ต้องตรวจ"** — ไม่งั้นคิวรีล้มทีเดียว วันขาดตรวจทั้งเดือนหายเกลี้ยง
     2. **ตัวหารของ % ต้องไม่รวมวันที่ไม่ต้องตรวจ** — ไม่งั้น % ขยับตามวันหยุด/วันไม่ผลิต ไม่ใช่ตามงานจริง */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHECK_DAY, CHECK_DAY_META, CHECK_DAY_LEGEND, checkDayState, summarizeCheckDays, checkDaysNote, runKey, ranOn,
} from '../dailyCheckDay.js';

test('มีผลตรวจ = ตรวจแล้ว เสมอ — ชนะทุกเงื่อนไข (ตรวจในวันไม่ผลิต/วันหยุดก็ยังนับ)', () => {
  assert.equal(checkDayState({ hasResult: true, ran: false, isOff: true, planned: false }), CHECK_DAY.done);
});

test('ต้องตรวจแต่ไม่ได้ตรวจ = missed (มีการผลิต + อยู่ในแผน)', () => {
  assert.equal(checkDayState({ hasResult: false, ran: true, planned: true }), CHECK_DAY.missed);
});

test('ไม่ได้ผลิต = no_run — ไม่ใช่ขาดตรวจ', () => {
  assert.equal(checkDayState({ hasResult: false, ran: false, planned: true }), CHECK_DAY.no_run);
});

test('🔴 อ่านข้อมูลการผลิตไม่ได้ = unknown ห้ามกลายเป็น no_run', () => {
  assert.equal(checkDayState({ hasResult: false, ran: null, planned: true }), CHECK_DAY.unknown);
  assert.notEqual(checkDayState({ hasResult: false, ran: null, planned: true }), CHECK_DAY.no_run);
});

test('ลำดับความสำคัญ: อนาคต > วันหยุด > ไม่มีแผน > ไม่ได้ผลิต', () => {
  assert.equal(checkDayState({ hasResult: false, isFuture: true, isOff: true, planned: false, ran: false }), CHECK_DAY.future);
  assert.equal(checkDayState({ hasResult: false, isOff: true, planned: false, ran: false }), CHECK_DAY.off);
  assert.equal(checkDayState({ hasResult: false, planned: false, ran: false }), CHECK_DAY.not_planned);
});

test('ฟอร์มที่ไม่มีแผนรายวัน (planned = null) = ต้องตรวจทุกวันที่ผลิต', () => {
  assert.equal(checkDayState({ hasResult: false, planned: null, ran: true }), CHECK_DAY.missed);
  assert.equal(checkDayState({ hasResult: false, planned: null, ran: false }), CHECK_DAY.no_run);
});

test('🔴 ตัวหารของ % = ตรวจแล้ว + ขาดตรวจ เท่านั้น (วันไม่ผลิต/หยุด/อนาคต/ไม่รู้ ห้ามนับ)', () => {
  const s = summarizeCheckDays([
    CHECK_DAY.done, CHECK_DAY.done, CHECK_DAY.done,
    CHECK_DAY.missed,
    CHECK_DAY.no_run, CHECK_DAY.off, CHECK_DAY.not_planned, CHECK_DAY.future, CHECK_DAY.unknown,
  ]);
  assert.equal(s.due, 4, 'ตัวหาร = 3 ตรวจแล้ว + 1 ขาด');
  assert.equal(s.pct, 75);
  assert.equal(s.unknown, 1);
});

test('ไม่มีวันที่ต้องตรวจเลย → pct = null ห้ามคืน 0% หรือ 100%', () => {
  const s = summarizeCheckDays([CHECK_DAY.no_run, CHECK_DAY.off, CHECK_DAY.future]);
  assert.equal(s.due, 0);
  assert.equal(s.pct, null);
  assert.match(checkDaysNote(s), /ยังไม่มีวันที่ต้องตรวจ/);
});

test('ข้อความสรุปต้องเขียนจำนวน "ไม่รู้" บนจอ และบอกว่าตัวเลขขาดตรวจอาจต่ำกว่าจริง', () => {
  const note = checkDaysNote(summarizeCheckDays([CHECK_DAY.done, CHECK_DAY.missed, CHECK_DAY.unknown]));
  assert.match(note, /ไม่รู้ว่าผลิตหรือไม่ 1 วัน/);
  assert.match(note, /ต่ำกว่าจริง/);
});

test('ranOn: ยังไม่โหลด / โหลดไม่สำเร็จ = null · มีข้อมูลแล้วตอบ true/false', () => {
  assert.equal(ranOn(null, '2026-10-13', 'day'), null, 'ยังไม่โหลด');
  assert.equal(ranOn({ ok: false, days: null }, '2026-10-13', 'day'), null, 'โหลดไม่สำเร็จ');
  const runs = { ok: true, days: new Set([runKey('2026-10-13'), runKey('2026-10-13', 'day')]) };
  assert.equal(ranOn(runs, '2026-10-13', 'day'), true);
  assert.equal(ranOn(runs, '2026-10-13', 'night'), false, 'กะดึกไม่ได้เปิด');
  assert.equal(ranOn(runs, '2026-10-14', 'day'), false);
});

test('runKey: ถามระดับวัน กับ ระดับวัน+กะ ต้องเป็นคนละคีย์', () => {
  assert.notEqual(runKey('2026-10-13'), runKey('2026-10-13', 'day'));
  assert.equal(runKey('2026-10-13', null), '2026-10-13');
});

/* ── สัญลักษณ์ห้ามชน "คำตอบของการตรวจ" (คำสั่ง user 13/10) ────────────────────────────────
   ใบ LPA ตอบด้วย Y / N / T / N/A ซึ่งทุกตัวแปลว่า "ไปตรวจแล้ว เจอผลอย่างนี้"
   ⇒ สถานะวันยืมตัวอักษรพวกนั้น (หรือ ✗ / – ที่ตาอ่านเป็น N / N/A) = คนอ่านนึกว่าตรวจแล้วเจอผิดปกติ */
const ANSWER_TOKENS = ['Y', 'N', 'T', 'NA', 'N/A', '✓', '✗', '×', 'x', 'X', '–', '—', '-'];

test('CHECK_DAY_META: ทุกสถานะมี meta ครบ และ mark ไม่ยืมตัวอักษรของคำตอบ', () => {
  for (const key of Object.values(CHECK_DAY)) {
    const m = CHECK_DAY_META[key];
    assert.ok(m, `ไม่มี meta ของ ${key}`);
    assert.equal(typeof m.label, 'string');
    assert.ok(m.label.length > 0, `${key} ต้องมี label ให้ tooltip/legend`);
    assert.ok('tint' in m, `${key} ต้องประกาศ tint (null ก็ได้) — จอใช้ทาทั้งคอลัมน์`);
    assert.ok(!ANSWER_TOKENS.includes(m.mark), `mark ของ ${key} = "${m.mark}" ชนพจนานุกรมคำตอบ`);
  }
});

test('CHECK_DAY_META: 3 สถานะที่ต้องสะดุดตา ต้องมีทั้ง mark และ tint', () => {
  for (const key of [CHECK_DAY.missed, CHECK_DAY.no_run, CHECK_DAY.unknown]) {
    assert.ok(CHECK_DAY_META[key].mark, `${key} ต้องมี mark (ปล่อยว่าง = ปนกับ "ตรวจแล้ว")`);
    assert.ok(CHECK_DAY_META[key].tint, `${key} ต้องมี tint เพื่อทาทั้งคอลัมน์`);
  }
  assert.equal(CHECK_DAY_META[CHECK_DAY.no_run].mark, 'NP', 'Non-Production = NP (คำสั่ง user)');
});

test('CHECK_DAY_META: สถานะที่ "ไม่ต้องตรวจอยู่แล้ว" ห้ามทาสีให้ดูเหมือนมีปัญหา', () => {
  for (const key of [CHECK_DAY.done, CHECK_DAY.off, CHECK_DAY.future, CHECK_DAY.not_planned]) {
    assert.equal(CHECK_DAY_META[key].tint, null, `${key} ห้ามมี tint`);
  }
});

test('CHECK_DAY_LEGEND: ต้องครอบคลุมทุกสถานะที่เขียน mark ลงจอ', () => {
  const marked = Object.values(CHECK_DAY).filter(k => CHECK_DAY_META[k].mark);
  for (const k of marked) assert.ok(CHECK_DAY_LEGEND.includes(k), `legend ขาด ${k} — คนอ่านต้องเดาเอง`);
  assert.equal(CHECK_DAY_LEGEND.length, marked.length, 'legend มีตัวที่ไม่ได้วาด mark');
});
