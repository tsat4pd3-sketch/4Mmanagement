/* 🎯 หมวดกิจกรรม (25/11) — ทะเบียน activityPages.js ต้องตรงกับเมนู + ตารางสิทธิ์ (path คนละที่ = หน้าหาย/ตั้งสิทธิ์ไม่ได้) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIVITIES, ACTIVITY_TABS, ACTIVITY_GROUP } from '../activityPages.js';
import { NAV_SUB_TABS } from '../navSubTabs.js';

const app = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8');
const perm = readFileSync(new URL('../../pages/PermissionsManagement.jsx', import.meta.url), 'utf8');

test('กิจกรรมทุกตัวอยู่ใน NAV_ITEMS หมวดกิจกรรม + PAGE_GROUPS + มีข้อย่อย 3 ส่วน', () => {
  assert.equal(ACTIVITIES.length, 9);
  for (const a of ACTIVITIES) {
    assert.match(app, new RegExp(`to: '${a.path}'[^\\n]*group: '${ACTIVITY_GROUP}'`), `${a.path} ไม่อยู่ใน NAV_ITEMS หมวด ${ACTIVITY_GROUP}`);
    assert.ok(perm.includes(`'page:${a.path}'`), `${a.path} ไม่มีแถวใน PAGE_GROUPS (/permissions)`);
    assert.deepEqual(NAV_SUB_TABS[a.path]?.tabs.map(t => t.key), ACTIVITY_TABS.map(t => t.key), `${a.path} ข้อย่อยไม่ครบ`);
  }
  assert.deepEqual(ACTIVITY_TABS.map(t => t.label), ['Dashboard', 'Edit Data', 'Setting']);
});

test('หมวดกิจกรรมอยู่ต่อจากคุณภาพ และหัวเพจค้างทั้งก้อน', () => {
  assert.match(app, /'คุณภาพ & วิศวกรรม', 'กิจกรรม'/, 'หมวดกิจกรรมต้องต่อจากคุณภาพ & วิศวกรรม ใน NAV_GROUP_ORDER');
  assert.match(app, /export const FULL_STICKY_GROUPS = \['กิจกรรม'\]/);
  assert.match(app, /export const STICKY_TAB_GROUPS = \[[^\]]*'กิจกรรม'/);
});
