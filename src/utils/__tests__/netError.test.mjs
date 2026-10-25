import { test } from 'node:test';
import assert from 'node:assert/strict';
import { explainNetError, isNetError, NET_HINT } from '../netError.js';

test('เน็ตหลุดทุกรูปแบบของเบราว์เซอร์ = ต่อท้ายคำอธิบาย ไม่ลบข้อความเดิม', () => {
  for (const m of ['บันทึกไม่สำเร็จ: TypeError: Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.']) {
    assert.equal(isNetError(m), true);
    const out = explainNetError(m);
    assert.ok(out.startsWith(m) && out.includes(NET_HINT));
  }
});

test('error อื่น (RLS/ข้อมูลซ้ำ) = คืนเดิมเป๊ะ · เรียกซ้ำไม่ต่อซ้อน', () => {
  const m = 'new row violates row-level security policy';
  assert.equal(explainNetError(m), m);
  const once = explainNetError('Failed to fetch');
  assert.equal(explainNetError(once), once);
  assert.equal(explainNetError(null), '');
});
