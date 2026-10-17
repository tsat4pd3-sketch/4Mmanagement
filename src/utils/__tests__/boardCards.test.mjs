// เทส boardCards — บอร์ด Heijunka ย่อในกล่องรายละเอียดไลน์ (2026-10-16)
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBoardCards, cardState, cardMade, groupBoardRows, boardFrame } from '../boardCards.js'

const NOW = Date.parse('2026-10-16T03:00:00Z')   // 10:00 ไทย — ตรึงเวลา

test('ตัดใบ carry_over ต้นทาง · ใบเลยเวลา = ดีเลย์ · ใบ backfill ไม่ตัดสินดีเลย์', () => {
  const sessions = [{ shift: 'day', status: 'open', line_name: 'L1', orders: [
    { id: 1, status: 'open', mat_no: 'A', qty: 100, opened_at: '2026-10-16T01:00:00Z' },        // 08:00 + 100×10s = 08:16 < 10:00 → ดีเลย์
    { id: 2, status: 'open', mat_no: 'A', qty: 100, opened_at: '2026-10-16T02:59:00Z' },        // ยังไม่ครบเวลา
    { id: 3, status: 'carry_over', mat_no: 'A', qty: 50, opened_at: '2026-10-16T01:00:00Z' },
    { id: 4, status: 'open', mat_no: 'A', qty: 100, opened_at: '2026-10-16T01:00:00Z', is_backfill: true },
    { id: 5, status: 'open', mat_no: 'A', qty: 10 },                                             // ยังไม่เปิดใบ
  ] }]
  const cards = buildBoardCards(sessions, { ctByMat: { A: 10 }, nameByMat: { A: 'PART A' }, nowMs: NOW })
  assert.deepEqual(cards.map(c => c.id).sort(), [1, 2, 4, 5])
  assert.ok(!cards.some(c => c.id === 3))
  const by = Object.fromEntries(cards.map(c => [c.id, c]))
  assert.equal(by[1].isDelayed, true)
  assert.equal(by[2].isDelayed, false)
  assert.equal(by[4].isDelayed, false)
  assert.equal(cardState(by[1]), 'late')
  assert.equal(cardState(by[2]), 'running')
  assert.equal(cardState(by[5]), 'waiting')
})

test('ไม่รู้ CT = แท่ง 5 นาที (ไม่หายจากบอร์ด) · เสร็จ/เสร็จช้า ตาม positioned', () => {
  const [c] = buildBoardCards([{ shift: 'day', status: 'open', line_name: 'L1', orders: [
    { id: 9, status: 'confirmed', mat_no: 'X', qty: 10, qty_ok: 12, opened_at: '2026-10-16T01:00:00Z' }] }], { nowMs: NOW })
  assert.equal(c.orderEndMs - c.orderStartMs, 5 * 60000)
  assert.equal(cardState(c, { isLateDone: true }), 'late_done')
  assert.equal(cardState(c, {}), 'done')
  assert.equal(cardMade(c), 12)
  assert.equal(cardMade({ status: 'open', qty_actual: null }), 0)
})

test('พาร์ทเดียวกันคนละไลน์ลูก = คนละแถว · ไลน์เดียว = แถวตามพาร์ท', () => {
  const cards = [
    { productKey: 'A', productLabel: 'A', line_name: 'L1' },
    { productKey: 'A', productLabel: 'A', line_name: 'L2' },
    { productKey: 'B', productLabel: 'B', line_name: 'L1' },
  ]
  assert.equal(groupBoardRows(cards).length, 3)
  assert.equal(groupBoardRows(cards.filter(c => c.line_name === 'L1')).length, 2)
})

test('กรอบวันงาน 24 ชม. แบ่งรอบละ 2 ชม.', () => {
  const f = boardFrame('2026-10-16')
  assert.equal(f.gridEndMs - f.gridStartMs, 24 * 3600000)
  assert.equal(f.roundIndexOf(f.gridStartMs + 3 * 3600000), 1)
  assert.equal(f.roundStartOf(2) - f.gridStartMs, 4 * 3600000)
})
