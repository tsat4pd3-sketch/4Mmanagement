// เทสกราฟถนนขนส่ง — โฟกัส T2-11: ถนนขาดช่วงกลางต้องไม่กลายเป็นเส้นทางปลอม
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAdj, shortestPath, routeThroughStops, bestStopOrder } from '../transportGraph.js'

// ผังเส้นตรง STORE(0,0) — A(10,0) — B(20,0) — C(30,0) — D(40,0)
const N = ['STORE', 'A', 'B', 'C', 'D'].map((id, i) => ({ id, x: i * 10, y: 0 }))
const E = (pairs) => pairs.map(([a, b], i) => ({ id: `e${i}`, a_node: a, b_node: b, bidir: true, weight: null }))
const FULL = E([['STORE', 'A'], ['A', 'B'], ['B', 'C'], ['C', 'D']])

test('shortestPath เดินตาม node เท่านั้น + ระยะจากพิกัด', () => {
  const { adj } = buildAdj(N, FULL)
  const r = shortestPath(adj, 'STORE', 'D')
  assert.deepEqual(r.path, ['STORE', 'A', 'B', 'C', 'D'])
  assert.equal(Math.round(r.distance), 40)
})

test('T2-11: segment กลางขาด — จุดปลายทางของ segment ที่ขาดต้องไม่หายจาก nodePath', () => {
  // ตัด A-B ทิ้ง: STORE→A ได้ · A→C ขาด · C→D ได้
  const edges = E([['STORE', 'A'], ['B', 'C'], ['C', 'D']])
  const r = routeThroughStops(N, edges, ['STORE', 'A', 'C', 'D'])
  assert.equal(r.ok, false)
  assert.equal(r.brokenAt, 1)                       // คู่ A→C คือช่วงที่ขาด
  // เดิม slice(1) เสมอ → nodePath = [STORE,A,D] (C หายทั้งจุด = เส้นปลอม A→D)
  assert.deepEqual(r.nodePath, ['STORE', 'A', 'C', 'D'])
  const broken = r.segments.filter(s => !s.ok)
  assert.equal(broken.length, 1)
  assert.deepEqual([broken[0].from, broken[0].to], ['A', 'C'])
})

test('เส้นทางต่อเนื่องปกติ — จุดเชื่อมระหว่าง segment ไม่ซ้ำ', () => {
  const r = routeThroughStops(N, FULL, ['STORE', 'B', 'D'])
  assert.equal(r.ok, true)
  assert.deepEqual(r.nodePath, ['STORE', 'A', 'B', 'C', 'D'])
  assert.equal(Math.round(r.distance), 40)
})

test('bestStopOrder: ล็อกจุดแรก แล้วเรียงที่เหลือให้สั้นสุด', () => {
  const r = bestStopOrder(N, FULL, ['STORE', 'D', 'B'])   // เรียงมั่ว
  assert.deepEqual(r.order, ['STORE', 'B', 'D'])          // ที่ถูก: ไล่ตามถนน
})

test('bestStopOrder: มีคู่ที่หากันไม่ถึง = คืน null ห้ามเดา', () => {
  const edges = E([['STORE', 'A']])                        // C/D ลอยเดี่ยว
  assert.equal(bestStopOrder(N, edges, ['STORE', 'A', 'D']), null)
})
