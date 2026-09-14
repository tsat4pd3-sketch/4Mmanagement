/* ความลึกของลิสต์ที่ถูกกรอง (visibleDepths) — กันเคส "ไลน์แม่ลูกมั่ว" ที่หน้างานทักมา 2026-09-08
   /energy แยกตาราง "จุดที่มีมิเตอร์" / "ยังไม่มีมิเตอร์" → ลูกกับแม่อยู่คนละตารางได้
   ถ้าเยื้องตามต้นไม้ทั้งหมด ลูกจะไปเยื้องใต้ไลน์ที่ไม่เกี่ยวกันเลย (HDF1 ไปอยู่ใต้ GOR) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleDepths } from '../lineHierarchy.js';

/* โครงจริง: GOR (เดี่ยว) · HYDROFORM → HDF1/HDF2/LASER-789 · LINE APRON ASSY → Line 60/61 */
const PARENT = {
  'line::HDF1': 'line::HYDROFORM', 'line::HDF2': 'line::HYDROFORM', 'line::LASER-789': 'line::HYDROFORM',
  'line::Line 60': 'line::LINE APRON ASSY', 'line::Line 61': 'line::LINE APRON ASSY',
};
const par = (k) => PARENT[k] || null;

test('แม่ไม่อยู่ในลิสต์ → แบนราบ + บอกว่าอยู่ใต้ใคร (เคสที่ user ทัก)', () => {
  const d = visibleDepths(['line::GOR', 'line::HDF1', 'line::HDF2', 'zone::Airbooster'], par);
  assert.equal(d.get('line::HDF1').depth, 0, 'ห้ามเยื้อง — แม่ (HYDROFORM) ไม่ได้อยู่ตารางนี้');
  assert.equal(d.get('line::HDF1').outsideParent, 'line::HYDROFORM');
  assert.equal(d.get('line::GOR').depth, 0);
  assert.equal(d.get('line::GOR').outsideParent, null);
  assert.equal(d.get('zone::Airbooster').outsideParent, null);   // โซนไม่มีแม่
});

test('แม่อยู่ในลิสต์ → เยื้อง 1 ชั้น ไม่มีป้าย "ใต้"', () => {
  const d = visibleDepths(['line::HYDROFORM', 'line::HDF1', 'line::LASER-789'], par);
  assert.equal(d.get('line::HYDROFORM').depth, 0);
  assert.equal(d.get('line::HDF1').depth, 1);
  assert.equal(d.get('line::HDF1').outsideParent, null);
});

test('ข้ามชั้น — ปู่อยู่ในลิสต์ แต่พ่อถูกกรองออก: เยื้อง 1 ชั้นใต้ปู่ + ยังบอกชื่อพ่อ', () => {
  const p = (k) => ({ 'line::c': 'line::b', 'line::b': 'line::a' }[k] || null);
  const d = visibleDepths(['line::a', 'line::c'], p);
  assert.equal(d.get('line::c').depth, 1);
  assert.equal(d.get('line::c').outsideParent, 'line::b');
});

test('parent วนกันเอง ต้องไม่ค้าง', () => {
  const loop = (k) => ({ 'line::a': 'line::b', 'line::b': 'line::a' }[k] || null);
  const d = visibleDepths(['line::a', 'line::b'], loop);
  assert.equal(d.size, 2);
});

test('ลิสต์ว่าง / ไม่มี parentOfKey ต้องไม่พัง', () => {
  assert.equal(visibleDepths([], par).size, 0);
  assert.equal(visibleDepths(['line::x'], null).get('line::x').depth, 0);
});
