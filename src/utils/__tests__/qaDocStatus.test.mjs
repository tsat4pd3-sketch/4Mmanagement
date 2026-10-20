import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isOpenQaDoc, isCancelledQaDoc, qaDocInFilter, QA_DONE_IN } from '../qaDocStatus.js'

test('ใบยกเลิกไม่ใช่งานค้าง และไม่ใช่ใบปิด', () => {
  assert.equal(isOpenQaDoc('open'), true)
  assert.equal(isOpenQaDoc({ status: 'investigating' }), true)
  assert.equal(isOpenQaDoc('closed'), false)
  assert.equal(isOpenQaDoc('cancelled'), false)
  assert.equal(isCancelledQaDoc({ status: 'cancelled' }), true)
  assert.equal(qaDocInFilter({ status: 'cancelled' }, 'closed'), false)
  assert.equal(qaDocInFilter({ status: 'cancelled' }, 'active'), false)
  assert.equal(qaDocInFilter({ status: 'cancelled' }, 'cancelled'), true)
  assert.equal(qaDocInFilter({ status: 'cancelled' }, 'all'), true)
  assert.equal(QA_DONE_IN, '(closed,cancelled)')
})
