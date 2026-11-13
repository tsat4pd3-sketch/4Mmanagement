/* 📋 ความครบของใบตรวจ + ตัวกรองตามมุม (2026-11-10 · คำสั่ง user เรื่องแพทเทินการสร้างใบตรวจ)
 * 🔴 เป็น "ตัวบอก" ไม่ใช่ "ด่าน" — ห้ามเอาไปบล็อกการบันทึก */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetCompleteness, cpInFrameFilter, cpFrameKey, UNPINNED }
  from '../inspectSheetQuality.js';

const FR = [{ _key: 'f1', title: 'หน้าเครื่อง' }, { _key: 'f2' }, { _key: 'f3' }];
const pin = (k, extra = {}) => ({ x_pos: 0.5, y_pos: 0.5, _frameKey: k, ...extra });

test('นับจุด/หมุด/รูปขยาย และแจกแจงรายมุม', () => {
  const cps = [
    pin('f1', { image_path: 'a.jpg' }),
    pin('f1'),
    pin('f2', { image_path: 'b.jpg' }),
    { x_pos: null, y_pos: null },               // ยังไม่ปักหมุด
  ];
  const s = sheetCompleteness(cps, FR);
  assert.equal(s.cps, 4);
  assert.equal(s.frames, 3);
  assert.equal(s.pinned, 3);
  assert.equal(s.unpinned, 1);
  assert.equal(s.withPhoto, 2);
  assert.equal(s.noPhoto, 2);
  assert.deepEqual(s.byFrame.map(f => f.n), [2, 1, 0]);
  assert.equal(s.byFrame[0].title, 'หน้าเครื่อง', 'มีชื่อมุมให้ใช้ชื่อ');
  assert.equal(s.byFrame[1].title, 'มุมที่ 2', 'ไม่มีชื่อ = เรียกตามลำดับ');
  assert.equal(s.done, false);
});

test('จุดที่ไม่ระบุมุม = ผูกมุมแรก (กติกาเดียวกับตัวปักหมุด)', () => {
  assert.equal(cpFrameKey({}, FR), 'f1');
  assert.equal(cpFrameKey({ _frameKey: 'f3' }, FR), 'f3');
  assert.equal(cpFrameKey({ image_id: 'f2' }, FR), 'f2');
  assert.equal(cpFrameKey({}, []), null, 'ไม่มีรูปเลย = ตอบไม่ได้ ไม่ใช่เดา');
  const s = sheetCompleteness([pin(undefined)], FR);
  assert.deepEqual(s.byFrame.map(f => f.n), [1, 0, 0]);
});

test('ใบที่ทำครบตามแพทเทิน = done', () => {
  const s = sheetCompleteness(
    [pin('f1', { image_path: 'a' }), pin('f2', { image_path: 'b' })], FR.slice(0, 2));
  assert.equal(s.done, true);
  assert.deepEqual(s.missing, []);
});

test('🔴 ยังไม่มีรูปเครื่อง = "ยังไม่เริ่ม" ไม่ใช่ "ทำไม่ครบ" — ข้อความต้องต่างกัน', () => {
  const s = sheetCompleteness([{ x_pos: null }], []);
  assert.equal(s.started, false);
  assert.equal(s.done, false);
  assert.equal(s.missing.length, 1);
  assert.match(s.missing[0], /ยังไม่มีรูปเครื่อง/);
  assert.ok(!s.missing.some(m => /ปักหมุด/.test(m)), 'ไม่มีรูปแล้วไปบอกให้ปักหมุด = สั่งสิ่งที่ทำไม่ได้');
});

test('บอกด้วยว่ามุมไหนยังไม่มีหมุดเลย (แต่เฉพาะเมื่อเริ่มปักแล้ว)', () => {
  const some = sheetCompleteness([pin('f1', { image_path: 'a' })], FR);
  assert.ok(some.missing.some(m => /มุมที่ยังไม่มีหมุดเลย 2 มุม/.test(m)));
  /* ยังไม่ปักสักจุด = บอกว่า "ยังไม่ปักหมุด N จุด" พอ ไม่ต้องซ้ำว่าทุกมุมว่าง */
  const none = sheetCompleteness([{ x_pos: null }], FR);
  assert.ok(!none.missing.some(m => /มุมที่ยังไม่มีหมุด/.test(m)));
});

test('ตัวกรองตามมุม', () => {
  const a = pin('f1'), b = pin('f2'), u = { x_pos: null, y_pos: null };
  assert.equal(cpInFrameFilter(a, null, FR), true, 'null = ทุกมุม');
  assert.equal(cpInFrameFilter(u, null, FR), true);
  assert.equal(cpInFrameFilter(a, 'f1', FR), true);
  assert.equal(cpInFrameFilter(b, 'f1', FR), false);
  assert.equal(cpInFrameFilter(u, 'f1', FR), false, '🔴 จุดยังไม่ปัก ห้ามโผล่ในมุมใดมุมหนึ่ง');
  assert.equal(cpInFrameFilter(u, UNPINNED, FR), true);
  assert.equal(cpInFrameFilter(a, UNPINNED, FR), false);
  /* จุดที่ปักแต่ไม่ระบุมุม ต้องอยู่ในมุมแรก ไม่ใช่หายไปจากทุกตัวกรอง */
  assert.equal(cpInFrameFilter(pin(undefined), 'f1', FR), true);
});

test('ของเข้าแปลกๆ ไม่ทำให้ล้ม', () => {
  for (const bad of [null, undefined, 'x', 42]) {
    const s = sheetCompleteness(bad, bad);
    assert.equal(s.cps, 0); assert.equal(s.frames, 0); assert.equal(s.done, false);
  }
  assert.equal(cpInFrameFilter(null, 'f1', FR), false);
});
