/* 🛡️ ทุกหน้าในเมนู (NAV_ITEMS ใน App.jsx) ต้องมีแถวในตาราง "การเข้าถึงหน้า" ของ /permissions (QC 05/10)
   ทำไม: PAGE_GROUPS ใน PermissionsManagement.jsx เป็นลิสต์มือที่ต้อง mirror NAV_ITEMS — หลุดแล้ว 3 หน้า
   (/monitoring /mtn-analysis /nm-board) ⇒ admin ตั้งสิทธิ์หน้านั้นจากจอไม่ได้เลย (ต้องไปแก้ SQL)
   อ่านเป็นข้อความ (App.jsx เป็น JSX — import ใน node ไม่ได้) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../../', import.meta.url).pathname;
const app  = readFileSync(`${ROOT}src/App.jsx`, 'utf8');
const perm = readFileSync(`${ROOT}src/pages/PermissionsManagement.jsx`, 'utf8');

/* หน้าที่ "piggyback" สิทธิ์หน้าอื่นใน canAccessPage (src/utils/permissions.js) — ไม่มีคีย์ของตัวเองโดยเจตนา */
const PIGGYBACK = {
  '/equipment': 'ศูนย์ทะเบียนอุปกรณ์ — piggyback page:/machine-database|/die-registry|/fixture|/mtn-repair',
};

test('NAV_ITEMS ทุกหน้ามีแถวใน PAGE_GROUPS ของ /permissions', () => {
  const start = app.indexOf('export const NAV_ITEMS = [');
  const end   = app.indexOf('export const NAV_GROUP_ORDER');
  assert.ok(start > 0 && end > start, 'หา NAV_ITEMS ใน App.jsx ไม่เจอ — ตัวเทสต้องอัพเดทตาม');
  const block = app.slice(start, end).split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
  const paths = [...block.matchAll(/\bto:\s*'([^']+)'/g)].map(m => m[1]);
  assert.ok(paths.length > 30, `อ่าน NAV_ITEMS ได้แค่ ${paths.length} หน้า — regex พัง?`);
  const keys = new Set([...perm.matchAll(/key:\s*'page:([^']+)'/g)].map(m => m[1]));
  const missing = paths.filter(p => !keys.has(p) && !PIGGYBACK[p]);
  assert.deepEqual(missing, [],
    `หน้าเหล่านี้อยู่ในเมนูแต่ไม่มีแถวใน PAGE_GROUPS (src/pages/PermissionsManagement.jsx): ${missing.join(', ')}\n`
    + "แก้: เพิ่ม { key: 'page:<path>', label } ในหมวดเดียวกับ NAV_ITEMS (+ seed permission ใน migration ถ้ายังไม่มี)");
});
