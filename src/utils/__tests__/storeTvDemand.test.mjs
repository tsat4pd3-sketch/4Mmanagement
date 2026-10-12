// เทส storeTvDemand — จอ TV สโตร์ (2026-10-12)
// เคสถอดจากข้อมูลจริง 12/10: เคส A 106 แถว line_name ว่างทุกแถว · ของบางตัวอยู่แค่ STORE/FG WAREHOUSE
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRequestCards, requestLinesOf, matLinesOf, scopeShortMats, waitMinOf, waitText,
} from '../storeTvDemand.js'

const NOW = Date.parse('2026-10-12T02:00:00Z')   // 09:00 ไทย — ตรึงเวลา (ด่าน "นาฬิกา +400 วัน")

test('waitMinOf — ไม่รู้เวลา = null ไม่ใช่ 0', () => {
  assert.equal(waitMinOf(null, NOW), null)
  assert.equal(waitMinOf('xx', NOW), null)
  assert.equal(waitMinOf('2026-10-12T01:30:00Z', NOW), 30)
  assert.equal(waitText(null), null)
  assert.equal(waitText(45), '45 นาที')
  assert.equal(waitText(125), '2 ชม. 5 นาที')
  assert.equal(waitText(120), '2 ชม.')
  assert.equal(waitText(1664 * 60 + 53), '69 วัน 8 ชม.')
  assert.equal(waitText(2880), '2 วัน')
})

test('buildRequestCards — suggested/hold/delivered ไม่ขึ้นจอสโตร์ (กฎเหล็ก 1)', () => {
  const wip = ['suggested', 'hold', 'delivered', 'received', 'pending', 'preparing']
    .map((s, i) => ({ id: i, status: s, line_name: 'Line 60', mat_no: '20058483', request_qty: 10, requested_at: '2026-10-12T01:00:00Z' }))
  const { cards } = buildRequestCards({ wip, nowMs: NOW })
  assert.deepEqual(cards.map(c => c.status), ['pending', 'preparing'])
})

test('buildRequestCards — กรองส่วนงาน · ใบไม่มีไลน์ห้ามหาย (นับ noLine)', () => {
  const inScope = (l) => l === 'Line 60'
  const wip = [
    { id: 1, status: 'pending', line_name: 'Line 60', mat_no: '2001', request_qty: 5, requested_at: '2026-10-12T01:50:00Z' },
    { id: 2, status: 'pending', line_name: 'LINE A ( 800 Ton )', mat_no: '2002', request_qty: 5, requested_at: '2026-10-12T01:00:00Z' },
    { id: 3, status: 'pending', line_name: null, mat_no: '2003', request_qty: 5, requested_at: '2026-10-12T01:00:00Z' },
  ]
  const raw = [{ id: 9, status: 'pending', lot_request_id: 'L1', raw_mat_no: '5001', qty: 3, created_at: '2026-10-12T00:00:00Z' }]
  const { cards, noLine } = buildRequestCards({ wip, raw, lotById: { L1: { source_line: 'Line 60', child_mat_no: '3001' } }, inScope, nowMs: NOW })
  assert.deepEqual(cards.map(c => c.key), ['r:9', 'w:3', 'w:1'])   // รอนานสุดก่อน
  assert.equal(noLine, 1)
  assert.equal(cards[0].line, 'Line 60')
  assert.equal(cards[0].useFor, '3001')
})

test('buildRequestCards — ไลน์เพิ่งเรียกขึ้นก่อนกำลังเตรียม · เลข 1xxx ติดธงเตือน', () => {
  const wip = [
    { id: 1, status: 'preparing', line_name: 'A', mat_no: '2001', requested_at: '2026-10-11T20:00:00Z' },
    { id: 2, status: 'pending', line_name: 'B', mat_no: '10086024', requested_at: '2026-10-12T01:59:00Z' },
  ]
  const { cards } = buildRequestCards({ wip, nowMs: NOW })
  assert.deepEqual(cards.map(c => c.key), ['w:2', 'w:1'])
  assert.equal(cards[0].fgWarn, true)
  assert.equal(cards[1].fgWarn, false)
  const by = requestLinesOf(cards)
  assert.deepEqual(by.B, { line: 'B', n: 1, pending: 1 })
  assert.deepEqual(by.A, { line: 'A', n: 1, pending: 0 })
})

test('scopeShortMats — จอ PD1 ไม่เห็นพาร์ทของส่วนงานอื่น · ของที่อยู่แต่ STORE นับเป็น unbound', () => {
  const a = [
    { mat_no: 'M1', sev: 2, qty_on_hand: 5, min_qty: 10 },
    { mat_no: 'M2', sev: 3, qty_on_hand: 0, min_qty: 10 },
    { mat_no: 'M3', sev: 2, qty_on_hand: 1, min_qty: 10 },
    { mat_no: 'M4', sev: 2, qty_on_hand: 1, min_qty: 10 },
  ]
  const ml = matLinesOf(
    [{ mat_no: 'M1', line_name: 'Line 60' }, { mat_no: 'M1', line_name: 'STORE' },
     { mat_no: 'M2', line_name: 'Line 61' }, { mat_no: 'M3', line_name: 'ASSEMBLY 1' },
     { mat_no: 'M4', line_name: 'STORE' }],
    [{ mat_no: 'M3', line_name: 'Line 60' }],
  )
  const known = new Set(['Line 60', 'Line 61', 'ASSEMBLY 1'])
  const inScope = (l) => l === 'Line 60' || l === 'Line 61'
  const { rows, unbound } = scopeShortMats(a, ml, inScope, known)
  assert.deepEqual(rows.map(r => r.mat_no), ['M2', 'M3', 'M1'])   // หมดเกลี้ยงก่อน → สัดส่วนต่ำสุด
  assert.deepEqual(rows.find(r => r.mat_no === 'M3').lines, ['Line 60'])
  assert.equal(unbound, 1)                                          // M4 อยู่แต่ STORE
})

test('scopeShortMats — จอไม่กรอง = ทั้งหมด ไม่มี unbound', () => {
  const { rows, unbound } = scopeShortMats([{ mat_no: 'X', sev: 2 }], new Map(), null, new Set())
  assert.equal(rows.length, 1)
  assert.equal(unbound, 0)
})
