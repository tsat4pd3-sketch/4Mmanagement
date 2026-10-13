/* เทส "ทะเบียนตรวจแล้วไม่ต้องบีบ" ของแผงบีบรูป (2026-10-13)

   เคสที่ล็อกไว้ — user ทักว่า *"ทำไมบีบแล้วก็ยังค้างว่ายังไม่ได้บีบอีก 495"*:
   คิวคัดด้วย "path ยังไม่ใช่ .webp" ⇒ ไฟล์หลุดคิวได้ทางเดียวคือถูกแปลงจริง
   แต่ใบที่ **ตั้งใจไม่แตะ** (เล็กกว่าเกณฑ์ / บีบแล้วไม่เล็กลงพอ) ไม่มีวันเปลี่ยนสภาพ
   ⇒ ค้างในคิวตลอดกาล **และถูกดาวน์โหลดซ้ำทุกครั้งที่กด** บนหน้าที่ตั้งมาเพื่อลด egress

   เทสนี้อ่านโค้ดเป็นข้อความ (ไฟล์จริง import ไม่ได้ใน node — ลาก browser-image-compression
   + canvas เข้ามาทั้งก้อน) จับเฉพาะ "โครงที่ถ้าหายแล้วบั๊กเดิมกลับมาทันที"               */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const src = readFileSync(join(ROOT, 'src/utils/recompressLayouts.js'), 'utf8');

test('🔴 คำตัดสินถาวรทุกทางต้องติดธง mark (ไม่งั้นค้างคิวตลอดกาล)', () => {
  // 'เล็กอยู่แล้ว' มี 2 ทาง (จาก HEAD และจากขนาด blob จริง) + 'บีบแล้วไม่เล็กลงพอ' อีก 1
  const small = [...src.matchAll(/msg: 'เล็กอยู่แล้ว'[^}]*}/g)];
  assert.equal(small.length, 2, 'ทางที่ตัดสิน "เล็กอยู่แล้ว" ต้องมี 2 ทางเท่าเดิม');
  small.forEach((m, i) => assert.match(m[0], /mark: 'small'/,
    `ทาง "เล็กอยู่แล้ว" ตัวที่ ${i + 1} ไม่ได้ติดธง mark ⇒ ใบนั้นจะกลับมาเข้าคิว + ถูกโหลดซ้ำทุกครั้งที่กด`));

  const noGain = src.match(/msg: 'บีบแล้วไม่เล็กลงพอ'[^}]*}/);
  assert.ok(noGain && /mark: 'no_gain'/.test(noGain[0]),
    '"บีบแล้วไม่เล็กลงพอ" ไม่ได้ติดธง mark ⇒ ใบนั้นถูกดาวน์โหลดเต็มก้อนซ้ำทุกครั้งเพื่อได้คำตอบเดิม');
});

test('🔴 โหมดสำรวจกับโหมดรันต้องใช้คิวชุดเดียวกัน (queue ไม่ใช่ jobs)', () => {
  assert.match(src, /const queue = jobs\.filter\(j => !marked\(j\)\)/,
    'ต้องกรองใบที่ตรวจแล้วออกจากคิว');
  assert.match(src, /queue\.forEach\(j => \{ byGroup/,
    'โหมดสำรวจต้องนับจาก queue — นับจาก jobs = เลขบนจอไม่ตรงกับงานที่ทำจริง (ต้นเรื่องของรอบนี้)');
  assert.match(src, /const batch = limit > 0 \? queue\.slice/,
    'โหมดรันต้องหยิบจาก queue');
  assert.ok(!/jobs\.slice\(0, limit\)/.test(src), 'ยังมีที่หยิบจาก jobs ตรงๆ อยู่');
});

test('🔴 ทุก job ต้องมี bucket (คีย์ของทะเบียนคือ bucket + path)', () => {
  const pushes = [...src.matchAll(/jobs\.push\(\{[\s\S]*?\n\s{4,6}\}\);/g)];
  assert.ok(pushes.length >= 6, `ควรมีอย่างน้อย 6 กลุ่มงาน พบ ${pushes.length}`);
  pushes.forEach((m) => {
    const g = m[0].match(/group: '([^']+)'/)?.[1] || '?';
    assert.match(m[0], /bucket: '[^']+'/, `งานกลุ่ม "${g}" ไม่ได้ระบุ bucket ⇒ คีย์ทะเบียนชนกันข้ามถัง`);
  });
});

test('🔴 ไฟล์ปลายทางที่มีอยู่แล้ว = ของค้างรอบก่อน ห้ามนับเป็น error ถาวร', () => {
  assert.match(src, /already exists/i,
    'ไม่ได้ดักเคส "The resource already exists" ⇒ ใบที่ DB อัปเดตพลาดรอบก่อนจะพังซ้ำตลอดไป');
  // ดูเฉพาะ "ตัวเลือกของ storage.upload" — ห้ามจับคำว่า upsert ในคอมเมนต์/ในการเขียนตาราง
  assert.ok(!/uploadOpts\(\{[^}]*upsert/.test(src),
    '🔴 ห้ามแก้ด้วย upsert ตอนอัปไฟล์ — path ที่ทับได้ต้องเป็น mutable (cache 1 ชม.) = ล้มเหตุผลทั้งหมดของงานนี้');
});

test('🔴 ทะเบียนล้ม ต้องดังบนจอ ห้ามเงียบ', () => {
  assert.match(src, /markError/, 'ต้องส่งผลการจดทะเบียนกลับไปให้จอ');
  assert.match(src, /sum\.errors\.push\('จดทะเบียน/, 'ล้มแล้วต้องเข้า errors ด้วย — เงียบ = เลขไม่ลดแล้วไม่มีใครรู้ว่าทำไม');
});

test('ทะเบียนโหลดไม่ได้ = ทำงานเหมือนเดิม ห้ามล้มทั้งงาน', () => {
  assert.match(src, /catch \{ \/\* ไม่มีทะเบียน/, 'การอ่านทะเบียนต้องอยู่ใน try/catch');
});
