import test from 'node:test';
import assert from 'node:assert/strict';
import { urlParam, urlPick, urlBool, urlNum } from '../urlInit.js';

test('urlInit — ค่าผิด/ไม่มี = fallback ของหน้า (ลิงก์พิมพ์ผิดห้ามทำหน้าพัง)', () => {
  globalThis.window = { location: { search: '?metric=oee&tour=1&lbl=9&bad=&x=zz' } };
  try {
    assert.equal(urlParam('metric'), 'oee');
    assert.equal(urlParam('bad'), null);
    assert.equal(urlPick('metric', ['health', 'oee'], 'health'), 'oee');
    assert.equal(urlPick('x', ['a'], 'a'), 'a');
    assert.equal(urlBool('tour', false), true);
    assert.equal(urlBool('none', false), false);
    assert.equal(urlNum('lbl', 0.6, 1.6, 1), 1.6);
    assert.equal(urlNum('x', 0, 1, 0.5), 0.5);
  } finally { delete globalThis.window; }
});
