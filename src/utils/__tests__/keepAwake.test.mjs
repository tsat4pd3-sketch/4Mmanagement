import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldKeepAwake } from '../keepAwake.js';

test('📺 ทีวี LG webOS = กันจอดับทุกหน้า แม้ไม่ใช่เปลือก TV', () => {
  const lg = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.128 Safari/537.36 WebAppManager';
  assert.equal(shouldKeepAwake({ ua: lg }), true);
});
test('📺 เปลือก TV / หน้า kiosk = กันจอดับ', () => {
  assert.equal(shouldKeepAwake({ tvShell: true }), true);
  assert.equal(shouldKeepAwake({ kiosk: true }), true);
});
test('💻 คอม/มือถือปกติ = ไม่ยุ่ง (พฤติกรรมเดิม)', () => {
  assert.equal(shouldKeepAwake({ ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/157.0.0.0 Safari/537.36' }), false);
  assert.equal(shouldKeepAwake({ ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/156.0.0.0 Mobile Safari/537.36' }), false);
  assert.equal(shouldKeepAwake({}), false);
});
