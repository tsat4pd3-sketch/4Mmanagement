/**
 * qualityBin — อายุแท็ก + ผลพิจารณา QA (WI-PD3-069 §5.4/§5.6 · WI-PD3-087)
 * ล็อกไว้เพราะเป็นตัวเลขที่มาจาก WI โดยตรง — แก้เมื่อไหร่ต้องรู้ตัวว่ากำลังขัดเอกสาร
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAG_MAX_DAYS, QA_DECISIONS, decisionOf, binTagAge, binClosed, overdueBins } from '../qualityBin.js';

test('อายุแท็กตาม WI: เหลือง 5 วัน · แดง 1 วัน', () => {
  assert.equal(TAG_MAX_DAYS.yellow, 5);
  assert.equal(TAG_MAX_DAYS.red, 1);
});

test('binTagAge นับวันจากวันที่ลงถัง และไม่กินเวลาเครื่อง', () => {
  assert.deepEqual(binTagAge({ bin: 'red', work_date: '2026-09-25' }, '2026-09-25'),
    { days: 0, limit: 1, over: false, overBy: 0 });
  // แดงอยู่ได้ 1 วัน ⇒ วันที่ 1 ยังไม่เกิน · วันที่ 2 เกิน 1 วัน
  assert.equal(binTagAge({ bin: 'red', work_date: '2026-09-24' }, '2026-09-25').over, false);
  assert.deepEqual(binTagAge({ bin: 'red', work_date: '2026-09-23' }, '2026-09-25'),
    { days: 2, limit: 1, over: true, overBy: 1 });
  // เหลืองอยู่ได้ 5 วัน
  assert.equal(binTagAge({ bin: 'yellow', work_date: '2026-09-20' }, '2026-09-25').over, false);
  assert.equal(binTagAge({ bin: 'yellow', work_date: '2026-09-19' }, '2026-09-25').over, true);
});

test('binTagAge ข้ามเดือน/ข้ามปี ไม่เพี้ยน', () => {
  assert.equal(binTagAge({ bin: 'yellow', work_date: '2026-08-30' }, '2026-09-02').days, 3);
  assert.equal(binTagAge({ bin: 'yellow', work_date: '2025-12-30' }, '2026-01-02').days, 3);
});

test('ข้อมูลไม่พอ = null (ห้ามเดาเป็น 0 วัน)', () => {
  assert.equal(binTagAge({ bin: 'red' }, '2026-09-25'), null);
  assert.equal(binTagAge({ bin: 'red', work_date: 'เมื่อวาน' }, '2026-09-25'), null);
  assert.equal(binTagAge({ bin: 'red', work_date: '2026-09-25' }, null), null);
  // ถังที่ไม่รู้จัก = ยังบอกจำนวนวันได้ แต่ไม่มีเพดาน (ห้ามแต่งเพดานให้)
  assert.deepEqual(binTagAge({ bin: 'blue', work_date: '2026-09-20' }, '2026-09-25'),
    { days: 5, limit: null, over: false, overBy: 0 });
});

test('วันที่ลงถังอยู่ในอนาคต = 0 วัน ไม่ใช่ติดลบ', () => {
  assert.equal(binTagAge({ bin: 'red', work_date: '2026-09-30' }, '2026-09-25').days, 0);
});

test('QA มี 4 ทางตาม WI §5.4 และ null = ยังไม่พิจารณา', () => {
  assert.deepEqual(QA_DECISIONS.map(d => d.value), ['good', 'repair', 'use_as_is', 'scrap']);
  assert.equal(decisionOf(null), null);
  assert.equal(decisionOf('scrap').value, 'scrap');
});

test('binClosed — ถังแดงปิดเมื่อเข้าสายขออนุมัติทำลายแล้ว', () => {
  assert.equal(binClosed({ bin: 'red' }), false);
  assert.equal(binClosed({ bin: 'red', scrap_report_id: 'x' }), true);
  // ผลพิจารณาของถังเหลืองไม่มีผลกับถังแดง
  assert.equal(binClosed({ bin: 'red', qa_decision: 'good' }), false);
});

test('binClosed — ถังเหลืองปิดได้ 4 ทาง', () => {
  assert.equal(binClosed({ bin: 'yellow' }), false);
  assert.equal(binClosed({ bin: 'yellow', return_date: '2026-09-25' }), true);
  assert.equal(binClosed({ bin: 'yellow', qa_decision: 'good' }), true);
  // "ขอใช้" ยังไม่ปิดจนกว่าจะมีเลขใบ FM-QA-042
  assert.equal(binClosed({ bin: 'yellow', qa_decision: 'use_as_is' }), false);
  assert.equal(binClosed({ bin: 'yellow', qa_decision: 'use_as_is', special_use_doc_no: '  ' }), false);
  assert.equal(binClosed({ bin: 'yellow', qa_decision: 'use_as_is', special_use_doc_no: 'QA042-01' }), true);
  // ชี้ทำลายอย่างเดียวยังไม่ปิด — ต้องย้ายลงถังแดงจริง
  assert.equal(binClosed({ bin: 'yellow', qa_decision: 'scrap' }), false);
  assert.equal(binClosed({ bin: 'yellow', qa_decision: 'scrap' }, { hasRedChild: true }), true);
});

test('overdueBins ตัดของที่จบแล้วออก และเรียงค้างนานสุดก่อน', () => {
  const rows = [
    { id: 'a', bin: 'red', work_date: '2026-09-20' },                       // ค้าง 5 วัน
    { id: 'b', bin: 'red', work_date: '2026-09-23' },                       // ค้าง 2 วัน
    { id: 'c', bin: 'red', work_date: '2026-09-10', scrap_report_id: 'r' },  // ออกใบแล้ว = ไม่ค้าง
    { id: 'd', bin: 'red', work_date: '2026-09-25' },                       // ยังไม่เกิน
  ];
  assert.deepEqual(overdueBins(rows, '2026-09-25').map(x => x.row.id), ['a', 'b']);
});

test('overdueBins — ใบเหลืองที่ย้ายลงถังแดงแล้ว ไม่นับเป็นของค้าง', () => {
  const rows = [{ id: 'y1', bin: 'yellow', work_date: '2026-09-01' }];
  assert.equal(overdueBins(rows, '2026-09-25').length, 1);
  assert.equal(overdueBins(rows, '2026-09-25', new Set(['y1'])).length, 0);
});
