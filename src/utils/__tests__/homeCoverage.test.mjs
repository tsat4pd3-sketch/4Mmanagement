/**
 * เทส "ทุกหน้าในเมนูต้องเข้าถึงได้จากหน้า Home"
 *
 * ที่มา (2026-08-24): การ์ดในหน้า Home เคยเป็น array เขียนมือ 7 ใบ ที่ประกาศว่าตัวเองครอบหมวดไหน
 * พอเพิ่มหมวด 'วิศวกรรม (PE)' ทีหลัง ไม่มีใครมาเพิ่มการ์ด → `/pe-docs` **เข้าจากหน้า Home ไม่ได้เลย**
 * และไม่มีอะไรฟ้อง (build ผ่าน · lint ผ่าน · หน้าไม่พัง) จนผู้ใช้ทักว่า "หาหน้าไม่เจอ"
 *
 * เทสนี้อ่าน "ซอร์สจริง" เป็นข้อความ (NAV_ITEMS/NAV_GROUP_ORDER อยู่ใน App.jsx ที่ลาก react+router
 * มาทั้งก้อน import ตรงในเทสไม่ได้) แล้วตรวจ 3 ข้อ:
 *   1) ทุก group ที่ NAV_ITEMS ใช้ ต้องอยู่ใน NAV_GROUP_ORDER  (ไม่งั้นไม่มีทั้งการ์ดและ rail)
 *   2) DeptHub ต้อง derive การ์ดจาก NAV_GROUP_ORDER (ห้ามกลับไปเขียน array หมวดมือ)
 *   3) key ของ CARD_META ต้องเป็นชื่อหมวดจริง (พิมพ์ผิด = การ์ดตกไปใช้ไอคอน/สีสำรองเงียบๆ)
 *
 * รัน: node --test 'src/utils/__tests__/*.test.mjs'
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const appSrc = readFileSync(resolve(root, 'src/App.jsx'), 'utf8');
const hubSrc = readFileSync(resolve(root, 'src/pages/DeptHub.jsx'), 'utf8');

/** ดึงลิสต์สตริงจาก `export const NAV_GROUP_ORDER = [...]` */
function navGroupOrder() {
  const m = appSrc.match(/export const NAV_GROUP_ORDER\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(m, 'หา NAV_GROUP_ORDER ใน App.jsx ไม่เจอ (เปลี่ยนชื่อ/ย้ายไฟล์?)');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

/** ดึง group ที่ถูกใช้จริงใน NAV_ITEMS (นับ alsoIn ด้วย — หน้าที่โผล่ 2 หมวด) */
function groupsUsedByNavItems() {
  const m = appSrc.match(/export const NAV_ITEMS\s*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(m, 'หา NAV_ITEMS ใน App.jsx ไม่เจอ');
  return new Set([...m[1].matchAll(/(?:group|alsoIn):\s*'([^']+)'/g)].map(x => x[1]));
}

test('ทุกหมวดที่เมนูใช้จริง ต้องอยู่ใน NAV_GROUP_ORDER', () => {
  const order = new Set(navGroupOrder());
  for (const g of groupsUsedByNavItems()) {
    assert.ok(order.has(g), `หมวด "${g}" ถูกใช้ใน NAV_ITEMS แต่ไม่อยู่ใน NAV_GROUP_ORDER — จะไม่มีทั้งการ์ดหน้า Home และหมวดบน rail`);
  }
});

test('NAV_GROUP_ORDER ต้องไม่มีหมวดกำพร้า (ประกาศไว้แต่ไม่มีเมนูสักตัว)', () => {
  const used = groupsUsedByNavItems();
  for (const g of navGroupOrder()) {
    assert.ok(used.has(g), `หมวด "${g}" อยู่ใน NAV_GROUP_ORDER แต่ไม่มีเมนูสักรายการ — จะได้การ์ด/ปุ่ม rail เปล่า`);
  }
});

test('การ์ดหน้า Home ต้อง derive จาก NAV_GROUP_ORDER (ห้ามกลับไปเขียนรายชื่อหมวดมือ)', () => {
  assert.match(hubSrc, /NAV_GROUP_ORDER\.map\(/, 'DeptHub ต้องสร้าง DEPTS จาก NAV_GROUP_ORDER.map — ไม่งั้นหมวดใหม่จะเข้าจากหน้า Home ไม่ได้');
  assert.ok(!/navGroups\s*:/.test(hubSrc), 'พบ navGroups: ใน DeptHub — แปลว่ากลับไปประกาศเองว่าการ์ดครอบหมวดไหน (ต้นเหตุที่ /pe-docs เคยหลุด)');
});

test('key ของ CARD_META ต้องเป็นชื่อหมวดจริงทุกตัว (พิมพ์ผิด = ตกไปใช้ค่าสำรองเงียบๆ)', () => {
  const m = hubSrc.match(/const CARD_META\s*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(m, 'หา CARD_META ใน DeptHub.jsx ไม่เจอ');
  const order = new Set(navGroupOrder());
  const keys = [...m[1].matchAll(/^\s*'([^']+)'\s*:/gm)].map(x => x[1]);
  assert.ok(keys.length > 0, 'CARD_META ว่าง');
  for (const k of keys) {
    assert.ok(order.has(k), `CARD_META มี key "${k}" ที่ไม่ใช่ชื่อหมวดใน NAV_GROUP_ORDER`);
  }
});

/* `alsoIn` = หน้าที่ทำงานคาบ 2 หมวด (เช่น เฝ้าระวังสต๊อก ที่จับทั้งขาเข้า-ขาออก)
   sidebar/หน้า Home โชว์ซ้ำ 2 ที่ แต่สิทธิ์/ค้นหา/ตัวนับ ต้องนับครั้งเดียว (2026-09-03) */
test('alsoIn ต้องเป็นชื่อหมวดจริง และห้ามซ้ำกับ group ของตัวเอง', () => {
  const m = appSrc.match(/export const NAV_ITEMS\s*=\s*\[([\s\S]*?)\n\];/);
  const order = new Set(navGroupOrder());
  // จับคู่ (group, alsoIn) ที่อยู่ในรายการเดียวกัน — alsoIn เขียนต่อท้าย group เสมอ
  for (const mm of m[1].matchAll(/group:\s*'([^']+)'\s*,\s*alsoIn:\s*'([^']+)'/g)) {
    const [, grp, also] = mm;
    assert.ok(order.has(also), `alsoIn "${also}" ไม่อยู่ใน NAV_GROUP_ORDER — เมนูจะไม่โผล่ในหมวดนั้น`);
    assert.notEqual(also, grp, `alsoIn ซ้ำกับ group ของตัวเอง ("${grp}") — เมนูจะโผล่ 2 บรรทัดในหมวดเดียว`);
  }
});

test('Sidebar/DeptHub ต้องกรองหมวดผ่าน inNavGroup (ไม่งั้น alsoIn ไม่มีผล)', () => {
  assert.match(appSrc, /export const inNavGroup\s*=/, 'ไม่พบ inNavGroup ใน App.jsx');
  assert.ok(!/items:\s*visibleItems\.filter\(i\s*=>\s*i\.group === g\)/.test(appSrc),
    'Sidebar ยังกรองด้วย i.group === g ตรงๆ — หน้าที่ตั้ง alsoIn จะโผล่หมวดเดียว');
});
