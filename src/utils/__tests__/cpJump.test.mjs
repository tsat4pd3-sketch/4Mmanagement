import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpJumpMatches } from '../cpJump.js'

const cps = [
  { _key: 'a', name: 'LP1', group_name: 'Locate Pin' },
  { _key: 'b', name: 'LP2', group_name: 'Locate Pin' },
  { _key: 'c', name: 'Clamp A', group_name: 'Clamp' },
  { _key: 'd', name: '', group_name: '' },
  { _key: 'e', name: 'ตรวจรอยร้าว 1.1', group_name: '' },
]
const labels = { a: '1.1', b: '1.2', c: '2.1', d: '3', e: '4' }

test('คำค้นว่าง = ทุกจุดตามลำดับเดิม', () => {
  assert.deepEqual(cpJumpMatches('', cps, labels).map(c => c._key), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(cpJumpMatches('  ', cps, labels).length, 5)
})

test('เลขจุดตรงตัวมาก่อนชื่อที่มีเลขเดียวกัน', () => {
  assert.deepEqual(cpJumpMatches('1.1', cps, labels).map(c => c._key), ['a', 'e'])
})

test('เลข Item = ทั้งกลุ่ม · ไม่ปนเลข 1x', () => {
  const many = [...cps, { _key: 'f', name: 'X', group_name: '' }]
  assert.deepEqual(cpJumpMatches('1', many, { ...labels, f: '12' }).map(c => c._key), ['a', 'b', 'e'])
})

test('ค้นชื่อจุด/ชื่อกลุ่ม ไม่สนตัวพิมพ์', () => {
  assert.deepEqual(cpJumpMatches('lp', cps, labels).map(c => c._key), ['a', 'b'])
  assert.deepEqual(cpJumpMatches('clamp', cps, labels).map(c => c._key), ['c'])
})

test('ข้อมูลเพี้ยนไม่พัง', () => {
  assert.deepEqual(cpJumpMatches('x', null, null), [])
  assert.deepEqual(cpJumpMatches(null, cps, undefined).length, 5)
})
