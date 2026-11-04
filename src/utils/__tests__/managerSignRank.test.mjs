/* 🔒 "ระดับที่เซ็นช่องผู้จัดการ/อนุมัติได้" ต้องมีแหล่งเดียว (2026-11-02)
   ใช้ 2 โมดูล: ใบ MO (mtnStepPerm.APPROVAL_MIN_RANK) · ใบอบรม OJT (ช่องระดับจัดการอนุมัติ)
   เลขนี้หลุดจากกันเมื่อไหร่ = จอหนึ่งปล่อยคนที่อีกจอบล็อก แล้วไม่มีอะไรบอก */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MANAGER_SIGN_MIN_RANK } from '../signRank.js';
import { APPROVAL_MIN_RANK } from '../mtnStepPerm.js';

test('🔴 2 โมดูลต้องใช้เลขเดียวกัน — หลุดจากกันแล้วด่านไม่ตรงกันเงียบๆ', () => {
  assert.equal(MANAGER_SIGN_MIN_RANK, APPROVAL_MIN_RANK);
});

test('เกณฑ์ = หัวหน้าแผนกขึ้นไป (50) ไม่ใช่ผู้จัดการเท่านั้น (60)', () => {
  assert.equal(MANAGER_SIGN_MIN_RANK, 50);
});

test('🔴 ไฟล์ต้อง pure — เทส node:test ต้อง import ได้ (positions.js import supabaseClient)', async () => {
  const src = await import('node:fs').then(m => m.readFileSync(new URL('../signRank.js', import.meta.url), 'utf8'));
  assert.ok(!/^\s*import\s/m.test(src), 'signRank.js ห้าม import อะไรเลย');
});
