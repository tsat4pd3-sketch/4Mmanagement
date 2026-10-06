/* ดัชนี EC — เทสกับเคสจริงในฐาน (วัด 05/10: EC 4 ครั้ง · 10100333→10105770 · 10100379→10105769) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEcIndex, ecOf, countSuperseded } from '../ecRevisions.js';

/* เคสจริงจาก dr_products (RB3B-8C306 rev BB → BC · มีผล 14/08) */
const REAL = [
  { id: 'a', mat_no: '10100333', name: 'REINF ASY RAD SUPT LWR(RB3B-8C306-BB)', superseded_by: 'b', superseded_at: '2026-08-14' },
  { id: 'b', mat_no: '10105770', name: 'REINF ASY RAD SUPT LWR(RB3B-8C306-BC)', superseded_by: null, superseded_at: null },
  { id: 'c', mat_no: '10100379', name: 'REINF ASY RAD SUPT LWR(306)(AAT)', superseded_by: 'd', superseded_at: '2026-08-14' },
  { id: 'd', mat_no: '10105769', name: 'REINF ASY RAD SUPT LWR(306)(AAT)', superseded_by: null, superseded_at: null },
  { id: 'e', mat_no: '10100381', name: 'REINF ASY RAD SUPT LWR (FVL)', superseded_by: null, superseded_at: null },
];
const IX = buildEcIndex(REAL);

test('เลขเก่ารู้ว่าถูกแทนด้วยเลขไหน + เมื่อไหร่', () => {
  const e = ecOf(IX, '10100333');
  assert.equal(e.supersededByMat, '10105770');
  assert.equal(e.supersededAt, '2026-08-14');
  assert.equal(e.isLatest, false);
  assert.equal(e.latestMat, '10105770');
});

test('เลขใหม่รู้ว่าไปแทนเลขไหนมา และเป็นตัวล่าสุด', () => {
  const e = ecOf(IX, '10105770');
  assert.equal(e.replacesMat, '10100333');
  assert.equal(e.isLatest, true);
  assert.equal(e.supersededByMat, null);
});

test('เลขที่ไม่เคยมี EC = ตัวล่าสุดเฉยๆ ไม่มีคำว่าแทน/ถูกแทน', () => {
  const e = ecOf(IX, '10100381');
  assert.equal(e.isLatest, true);
  assert.equal(e.supersededByMat, null);
  assert.equal(e.replacesMat, null);
});

test('🔴 mat ที่ไม่มีใน Products = null ห้ามเดาว่า "ล่าสุด"', () => {
  assert.equal(ecOf(IX, '30046428'), null);
  assert.equal(ecOf(IX, ''), null);
  assert.equal(ecOf(null, '10100333'), null);
});

test('ตัวพิมพ์/ช่องว่างไม่ทำให้หาไม่เจอ', () => {
  assert.equal(ecOf(IX, ' 10100333 ')?.supersededByMat, '10105770');
});

test('สาย 3 ชั้น (A→B→C) — ตัวแรกต้องชี้ปลายสายได้ ไม่ใช่แค่ตัวถัดไป', () => {
  const ix = buildEcIndex([
    { id: '1', mat_no: 'A1', superseded_by: '2', superseded_at: '2026-01-01' },
    { id: '2', mat_no: 'B2', superseded_by: '3', superseded_at: '2026-02-01' },
    { id: '3', mat_no: 'C3', superseded_by: null },
  ]);
  const a = ecOf(ix, 'A1');
  assert.equal(a.supersededByMat, 'B2', 'ตัวถัดไปตรงๆ');
  assert.equal(a.latestMat, 'C3', 'ปลายสายล่าสุด');
  assert.equal(ecOf(ix, 'C3').isLatest, true);
});

test('🔴 สายวนลูป = chainBroken ห้ามวนค้าง และห้ามตอบ latest มั่ว', () => {
  const ix = buildEcIndex([
    { id: '1', mat_no: 'X1', superseded_by: '2' },
    { id: '2', mat_no: 'Y2', superseded_by: '1' },
  ]);
  assert.equal(ecOf(ix, 'X1').chainBroken, true);
  assert.equal(ecOf(ix, 'X1').latestMat, null, 'ไล่ไม่สุด = ไม่ตอบ');
});

test('🔴 ตัวที่มาแทนไม่มีเลข MAT (เช่นชั้น OP) = ยังบอกว่าถูกแทนแล้ว แต่ไล่ต่อไม่ได้', () => {
  // เคสจริง 05/10: 50031625 ถูกแทนด้วยแถวชื่อ "BENDING LWR BAR 306"
  const ix = buildEcIndex([
    { id: '1', mat_no: '50031625', superseded_by: '2', superseded_at: '2026-10-01' },
    { id: '2', mat_no: 'BENDING LWR BAR 306', superseded_by: null },
  ]);
  const e = ecOf(ix, '50031625');
  assert.equal(e.supersededByMat, 'BENDING LWR BAR 306');
  assert.equal(e.isLatest, false);
});

test('นับจำนวนแถวที่ถูกแทนแล้ว — ใช้เขียนบนจอว่าซ่อนไปกี่รายการ', () => {
  assert.equal(countSuperseded(IX, ['10100333', '10100379', '10105770', '30046428']), 2);
  assert.equal(countSuperseded(IX, []), 0);
  assert.equal(countSuperseded(IX, null), 0);
});

test('แถวที่ไม่มี mat_no ไม่ทำให้ดัชนีพัง', () => {
  const ix = buildEcIndex([{ id: '1', mat_no: null }, { id: '2', mat_no: '  ' }, null, undefined]);
  assert.equal(ix.size, 0);
});
