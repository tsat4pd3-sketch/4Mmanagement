/**
 * เทส "ทะเบียนหมวดเมนูในฐาน (nav_groups) ต้องตรงกับ NAV_GROUP_ORDER ใน App.jsx"
 *
 * ที่มา (2026-09-07): permission_catalog.group_name ต้องเป็นชื่อหมวดใน NAV_GROUP_ORDER เท่านั้น
 * ไม่งั้นได้ "หมวดกำพร้า" กลางตาราง /permissions — หลุดมาแล้ว 2 ครั้ง เพราะตัวตรวจฝั่ง SQL เป็น do-block
 * ที่ลิสต์ชื่อหมวด hardcode ในแต่ละ migration (ลิสต์ 9 หมวด แต่ nav โตเป็น 12 = เตือนผิด)
 *
 * ตอนนี้ฝั่งฐานมีตาราง `nav_groups` + FK จาก permission_catalog (migration 20260907_nav_groups_registry.sql)
 * → seed ชื่อหมวดผิด = error ทันที · แต่ FK รู้จักแค่ "ทะเบียนในฐาน" ไม่รู้จัก App.jsx
 * เทสนี้ปิดช่องที่เหลือ: **ทะเบียนในฐาน (= migration *_nav_groups_* ตัวล่าสุด) ต้องเท่ากับ NAV_GROUP_ORDER**
 * → แก้หมวดใน App.jsx โดยไม่เขียน migration ใหม่ = build ไม่ผ่าน (แทนที่จะ drift เงียบ)
 *
 * อ่านซอร์สเป็นข้อความเหมือน homeCoverage.test.mjs (App.jsx import ตรงในเทสไม่ได้)
 * format ที่อ่าน: บรรทัด `('ชื่อหมวด', seq, sort_lo, sort_hi),` บรรทัดละหมวดใน migration
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const appSrc = readFileSync(resolve(root, 'src/App.jsx'), 'utf8');
const migDir = resolve(root, 'supabase/migrations');

function navGroupOrder() {
  const m = appSrc.match(/export const NAV_GROUP_ORDER\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, 'หา NAV_GROUP_ORDER ใน App.jsx ไม่เจอ');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

/** migration ทะเบียนหมวดตัวล่าสุด (ชื่อไฟล์ขึ้นด้วยวันที่ → เรียงตามชื่อ = เรียงตามเวลา) */
function latestRegistryMigration() {
  const files = readdirSync(migDir).filter(f => /_nav_groups_.*\.sql$/.test(f)).sort();
  assert.ok(files.length > 0, 'ไม่พบ migration *_nav_groups_*.sql — ทะเบียนหมวดในฐานหายไป?');
  return { file: files.at(-1), src: readFileSync(resolve(migDir, files.at(-1)), 'utf8') };
}

function registryRows(src) {
  return [...src.matchAll(/^\s*\('([^']+)',\s*(\d+),\s*(\d+),\s*(\d+)\)/gm)]
    .map(m => ({ name: m[1], seq: +m[2], lo: +m[3], hi: +m[4] }));
}

test('nav_groups seed ตัวล่าสุด ต้องมีชื่อ+ลำดับหมวดเท่ากับ NAV_GROUP_ORDER เป๊ะ', () => {
  const { file, src } = latestRegistryMigration();
  const rows = registryRows(src).sort((a, b) => a.seq - b.seq);
  assert.ok(rows.length > 0, `${file}: อ่านแถว seed ไม่ได้ — ต้องเป็นบรรทัด ('ชื่อหมวด', seq, lo, hi) บรรทัดละหมวด`);
  assert.deepEqual(
    rows.map(r => r.name),
    navGroupOrder(),
    `หมวดใน ${file} ไม่ตรงกับ NAV_GROUP_ORDER ใน App.jsx — เปลี่ยนหมวดเมนูต้องเขียน migration *_nav_groups_* ใหม่ (upsert ทั้งชุด) ในคอมมิทเดียวกัน`,
  );
  rows.forEach((r, i) => assert.equal(r.seq, i + 1, `${file}: seq ของ "${r.name}" ต้องเป็น ${i + 1} (ไล่ 1..n ไม่มีช่องว่าง)`));
});

test('ช่วง sort ของแต่ละหมวด ต้องไม่ซ้อนกัน และไล่ตามลำดับหมวด', () => {
  const { file, src } = latestRegistryMigration();
  const rows = registryRows(src).sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    assert.ok(r.lo <= r.hi, `${file}: "${r.name}" sort_lo ${r.lo} > sort_hi ${r.hi}`);
    if (i > 0) {
      const p = rows[i - 1];
      assert.ok(r.lo > p.hi, `${file}: ช่วง sort ของ "${r.name}" (${r.lo}-${r.hi}) ซ้อน/ย้อนกับ "${p.name}" (${p.lo}-${p.hi}) — หมวดจะเรียงสลับในตาราง /permissions`);
    }
  }
});

test('migration ทะเบียนหมวดต้องมี FK จาก permission_catalog (ไม่งั้นทะเบียนเป็นแค่ตารางประดับ)', () => {
  const src = readFileSync(resolve(migDir, '20260907_nav_groups_registry.sql'), 'utf8');
  assert.match(src, /permission_catalog_group_name_fkey/, 'ไม่พบ constraint permission_catalog_group_name_fkey');
  assert.match(src, /on update cascade/, 'FK ต้อง on update cascade — เปลี่ยนชื่อหมวดใน nav_groups แล้ว catalog ต้องตามเอง');
});
