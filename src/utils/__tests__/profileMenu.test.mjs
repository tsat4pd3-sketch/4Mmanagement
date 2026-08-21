/**
 * เทส buildProfileMenu — สัญญาว่า "เมนูโปรไฟล์ของ sidebar กับหน้า Home ต้องเป็นชุดเดียวกัน"
 * (drift เดิม: หน้า Home ไม่มี 💬 แจ้งปัญหา / 🎭 จำลองมุมมอง / รีโมทจอ · sidebar ไม่มี 📷 เปลี่ยนรูป)
 * รัน: node --test 'src/utils/__tests__/*.test.mjs'
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProfileMenu } from '../profileMenu.js';

// handler ครบชุดเหมือนที่ host จริงส่งให้ (sidebar และ DeptHub ส่งเหมือนกันทุกตัว)
const ALL = {
  avatar: () => {}, signature: () => {}, password: () => {}, feedback: () => {},
  viewAs: () => {}, toggleRemote: () => {}, toggleTheme: () => {}, logout: () => {},
};
const keys = (opts) => buildProfileMenu(opts).map(i => i.key);

test('admin + มีสิทธิ์รีโมท = ได้เมนูครบทุกรายการ เรียงคงที่', () => {
  assert.deepEqual(
    keys({ realRole: 'admin', canRemote: true, on: ALL }),
    ['avatar', 'signature', 'password', 'feedback', 'viewAs', 'remoteLink', 'remoteRecv', 'theme', 'logout'],
  );
});

test('sidebar กับหน้า Home ต้องได้ชุดเดียวกันเป๊ะเมื่อส่ง handler ครบเท่ากัน', () => {
  const ctx = { realRole: 'admin', canRemote: true, remoteCode: '123456', theme: 'dark', on: ALL };
  assert.deepEqual(keys(ctx), keys({ ...ctx }));   // ทั้ง 2 host เรียก builder ตัวเดียวกัน
});

test('🎭 จำลองมุมมอง เห็นเฉพาะ admin จริง (ไม่ใช่ role ที่กำลังถูกจำลอง)', () => {
  assert.ok(keys({ realRole: 'admin', on: ALL }).includes('viewAs'));
  assert.ok(!keys({ realRole: 'leader', on: ALL }).includes('viewAs'));
  assert.ok(!keys({ realRole: 'mtn', on: ALL }).includes('viewAs'));
});

test('ไม่มีสิทธิ์ page:/remote = ไม่มีรายการรีโมททั้งคู่', () => {
  const k = keys({ realRole: 'leader', canRemote: false, on: ALL });
  assert.ok(!k.includes('remoteLink'));
  assert.ok(!k.includes('remoteRecv'));
});

test('host ที่ไม่ส่ง handler มา = ตัดรายการนั้นทิ้ง (ห้ามโชว์ปุ่มที่กดแล้วไม่มีอะไรเกิด)', () => {
  const k = keys({ realRole: 'admin', canRemote: true, on: { ...ALL, avatar: undefined, feedback: undefined } });
  assert.ok(!k.includes('avatar'));
  assert.ok(!k.includes('feedback'));
  assert.ok(k.includes('signature'));   // ตัวอื่นยังอยู่ครบ
});

test('รายการรีโมทจอบอกสถานะรับรีโมทอยู่ + ลิงก์ /remote เป็น to ไม่ใช่ onClick', () => {
  const items = buildProfileMenu({ realRole: 'admin', canRemote: true, remoteCode: '482913', on: ALL });
  const link = items.find(i => i.key === 'remoteLink');
  const recv = items.find(i => i.key === 'remoteRecv');
  assert.equal(link.to, '/remote');
  assert.equal(link.onClick, undefined);
  assert.match(recv.label, /482913/);
});

test('สวิตช์ธีมสะท้อนธีมปัจจุบัน (dark = เสนอสลับเป็น Light)', () => {
  const dark = buildProfileMenu({ realRole: 'leader', theme: 'dark', on: ALL }).find(i => i.key === 'theme');
  const light = buildProfileMenu({ realRole: 'leader', theme: 'light', on: ALL }).find(i => i.key === 'theme');
  assert.equal(dark.kind, 'toggle');
  assert.match(dark.label, /Light/);
  assert.equal(dark.on, true);
  assert.match(light.label, /Dark/);
  assert.equal(light.on, false);
});

test('ออกจากระบบอยู่ท้ายสุดเสมอ + ทำเครื่องหมาย danger', () => {
  const items = buildProfileMenu({ realRole: 'admin', canRemote: true, on: ALL });
  const last = items[items.length - 1];
  assert.equal(last.key, 'logout');
  assert.equal(last.danger, true);
});
