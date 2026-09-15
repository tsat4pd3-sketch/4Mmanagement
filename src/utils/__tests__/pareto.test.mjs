import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAbc, cutoffIndex, isVagueLabel, vagueShare, PARETO_CUTOFF } from '../pareto.js';

const v = d => d.v;

test('classifyAbc — เรียงมาก→น้อย + % และ % สะสมถูกต้อง', () => {
  const r = classifyAbc([{ name: 'ข', v: 20 }, { name: 'ก', v: 70 }, { name: 'ค', v: 10 }], v);
  assert.deepEqual(r.map(x => x.name), ['ก', 'ข', 'ค']);
  assert.deepEqual(r.map(x => Math.round(x._pct)), [70, 20, 10]);
  assert.deepEqual(r.map(x => Math.round(x._cum)), [70, 90, 100]);
  // _cumPrev ของแถวถัดไป = _cum ของแถวก่อน — เส้นสะสมจึงต่อกันสนิท ไม่มีรอยขาด
  for (let i = 1; i < r.length; i++) assert.equal(r[i]._cumPrev, r[i - 1]._cum);
  assert.equal(r[0]._cumPrev, 0);
  assert.equal(Math.round(r[r.length - 1]._cum), 100);
});

test('🔴 ABC — A = สะสมถึง 80% แรก · B ถึง 95% · C ที่เหลือ', () => {
  const r = classifyAbc([{ v: 70 }, { v: 20 }, { v: 8 }, { v: 2 }], v);
  assert.deepEqual(r.map(x => x._cls), ['A', 'A', 'B', 'C']);
});

test('🔴 รายการเดียวกินเกิน 80% ต้องยังเป็น A (ไม่งั้นกราฟไม่มีกลุ่ม A เลย)', () => {
  // แถว 2 เริ่มนับที่สะสม 99% ซึ่งเลย 95% ไปแล้ว ⇒ C (หางยาว) ตามนิยาม — ไม่ใช่ B
  assert.deepEqual(classifyAbc([{ v: 99 }, { v: 1 }], v).map(x => x._cls), ['A', 'C']);
  assert.deepEqual(classifyAbc([{ v: 85 }, { v: 10 }, { v: 5 }], v).map(x => x._cls), ['A', 'B', 'C']);
  assert.deepEqual(classifyAbc([{ v: 5 }], v).map(x => x._cls), ['A']);
});

test('ยอดรวม 0 / ลิสต์ว่าง ต้องไม่ได้ NaN (ยังไม่มีข้อมูลก็ต้องวาดได้)', () => {
  assert.deepEqual(classifyAbc([], v), []);
  const r = classifyAbc([{ v: 0 }, { v: 0 }], v);
  assert.ok(r.every(x => x._pct === 0 && x._cum === 0 && x._cumPrev === 0));
});

test('ค่า null/undefined นับเป็น 0 ไม่พังทั้งกราฟ (คอลัมน์ในฐานเป็น nullable)', () => {
  const r = classifyAbc([{ v: null }, { v: 10 }, { v: undefined }], v);
  assert.equal(Math.round(r[0]._pct), 100);
  assert.ok(r.every(x => Number.isFinite(x._cum)));
});

test('cutoffIndex — ชี้รายการสุดท้ายที่ยังอยู่ใน 80% แรก (ตำแหน่งเส้น cut-off)', () => {
  const r = classifyAbc([{ v: 70 }, { v: 20 }, { v: 10 }], v);
  assert.equal(cutoffIndex(r), 1);                 // สะสม 90% ที่แถว 2 = แถวแรกที่ทะลุ 80
  assert.equal(cutoffIndex(classifyAbc([{ v: 100 }], v)), 0);
  assert.equal(cutoffIndex([]), -1);
  assert.equal(PARETO_CUTOFF, 80);
});

test('🔴 ป้ายที่ "บอกอะไรไม่ได้" ต้องถูกจับได้ทุกสะกด — ไทย/อังกฤษ/ว่าง', () => {
  for (const s of ['อื่นๆ', 'อื่น ๆ', 'ไม่ระบุ', 'ไม่ระบุกลุ่ม', 'ไม่ทราบ', 'Other', 'others', 'N/A', 'n/a', '-', '', '   ', 'etc.', 'unknown'])
    assert.equal(isVagueLabel(s), true, `"${s}" ต้องนับเป็นป้ายกำกวม`);
  for (const s of ['ลมรั่ว', 'สต็อปเปอร์ ชำรุด', 'PLC / HMI ผิดปกติ', 'เซนเซอร์ ชำรุด'])
    assert.equal(isVagueLabel(s), false, `"${s}" เป็นสาเหตุจริง ห้ามนับเป็นกำกวม`);
  assert.equal(isVagueLabel(null), true);          // ค่าว่างในฐาน = กำกวม
});

test('🔴 vagueShare — เคสจริง KPI ใบซ่อม 2026-09-15: ขยะ 98% ต้องวัดออกมาได้', () => {
  const rows = classifyAbc(
    [{ name: 'ไม่ระบุกลุ่ม', v: 224 }, { name: 'อื่นๆ', v: 89 }, { name: 'ระบบลม', v: 2 },
     { name: 'อาการที่ชิ้นงาน', v: 2 }, { name: 'ไฟฟ้า / ควบคุม', v: 1 }, { name: 'MTN ระบบ PLC HDF', v: 1 }], v);
  const s = vagueShare(rows);
  assert.equal(s.total, 319);
  assert.equal(s.vagueVal, 313);
  assert.equal(Math.round(s.pct), 98);
  assert.equal(s.names.length, 2);
  for (const n of ['ไม่ระบุกลุ่ม', 'อื่นๆ']) assert.ok(s.names.includes(n), `ต้องจับ "${n}" ได้`);
});

test('vagueShare — ไม่มีป้ายกำกวมเลย = 0% (ห้ามขึ้นคำเตือนกวน)', () => {
  const s = vagueShare(classifyAbc([{ name: 'ลมรั่ว', v: 5 }, { name: 'เซนเซอร์ ชำรุด', v: 3 }], v));
  assert.equal(s.pct, 0);
  assert.deepEqual(s.names, []);
});
