import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSignedDecimal, toggleSign } from '../signedDecimal.js';

test('cleanSignedDecimal keeps a leading minus and one dot', () => {
  assert.equal(cleanSignedDecimal('-0.05'), '-0.05');
  assert.equal(cleanSignedDecimal('-'), '-');
  assert.equal(cleanSignedDecimal('1,25'), '1.25');
  assert.equal(cleanSignedDecimal('1.2.3'), '1.23');
  assert.equal(cleanSignedDecimal('1-2'), '12');
  assert.equal(cleanSignedDecimal(' 3a '), '3');
  assert.equal(cleanSignedDecimal(null), '');
});

test('toggleSign flips the sign, including empty input', () => {
  assert.equal(toggleSign('0.5'), '-0.5');
  assert.equal(toggleSign('-0.5'), '0.5');
  assert.equal(toggleSign(''), '-');
  assert.equal(toggleSign('-'), '');
});
