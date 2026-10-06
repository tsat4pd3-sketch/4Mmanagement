/* เทส "สแกนป้ายแม่พิมพ์ → หมุดบนผังจัดเก็บ" — findDieByScan (src/utils/qrCode.js · 2026-10-06)
   🔴 ล็อก: ทุกทางที่หาไม่เจอต้องคืนเหตุผล (ห้าม null เงียบ) · นอกขอบเขต ≠ ไม่มีในทะเบียน */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQrPayload, findDieByScan } from '../qrCode.js';

const dies = [
  { id: 'u-1', machine_no: 'HDF01-HYDRO1', line_name: 'HDF', is_active: true },
  { id: 'u-2', machine_no: 'TD-210', line_name: 'LINE 2', is_active: true },
  { id: 'u-3', machine_no: 'OLD-01', line_name: 'HDF', is_active: false },
];

test('ป้ายระบบ ESM:M:<uuid> และลิงก์ /scan → เจอตัวนั้น', () => {
  assert.equal(findDieByScan(parseQrPayload('ESM:M:u-2'), dies).die.id, 'u-2');
  assert.equal(findDieByScan(parseQrPayload('https://x.app/scan?c=ESM:M:u-1'), dies).die.id, 'u-1');
});

test('เลขเปล่า (บาร์โค้ดเดิม/พิมพ์มือ) ไม่แคร์ขีด-ตัวพิมพ์', () => {
  assert.equal(findDieByScan(parseQrPayload('td210'), dies).die.id, 'u-2');
});

test('หาไม่เจอทุกแบบต้องมีเหตุผล', () => {
  assert.match(findDieByScan(null, dies).error, /อ่านรหัส/);
  assert.match(findDieByScan(parseQrPayload('ESM:P:1001'), dies).error, /ไม่ใช่ป้ายแม่พิมพ์/);
  assert.match(findDieByScan(parseQrPayload('ESM:J:abc'), dies).error, /ป้ายจิ๊ก/);
  assert.match(findDieByScan(parseQrPayload('ESM:M:machine-x'), dies).error, /เครื่องจักร/);
  assert.match(findDieByScan(parseQrPayload('ZZZ-9'), dies).error, /ZZZ-9/);
  assert.match(findDieByScan(parseQrPayload('ESM:M:u-3'), dies).error, /ปิดใช้งาน/);
});

test('นอกขอบเขตไลน์ ≠ ไม่มีในทะเบียน', () => {
  const r = findDieByScan(parseQrPayload('ESM:M:u-2'), dies, d => d.line_name === 'HDF');
  assert.equal(r.die, undefined);
  assert.match(r.error, /นอกขอบเขต.*LINE 2/);
});
