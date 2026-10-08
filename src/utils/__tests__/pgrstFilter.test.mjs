import test from 'node:test';
import assert from 'node:assert/strict';
import { orValue, orIlike } from '../pgrstFilter.js';

test('orIlike — ห่อค่าด้วย "…" ให้ , ( ) ไม่แตกเงื่อนไข', () => {
  assert.equal(orIlike(['a', 'b'], 'BRKT (RH), LOW'), 'a.ilike."%BRKT (RH), LOW%",b.ilike."%BRKT (RH), LOW%"');
});

test('orValue — escape " และ \\', () => {
  assert.equal(orValue('5" pipe'), '"5\\" pipe"');
  assert.equal(orValue('a\\b'), '"a\\\\b"');
});

test('orIlike — คำว่าง = สตริงว่าง', () => {
  assert.equal(orIlike(['a'], '   '), '');
  assert.equal(orIlike(['a'], null), '');
});
