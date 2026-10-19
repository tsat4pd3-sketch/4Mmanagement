import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcOf, calcNumber, calcFormula, calcProblems, remapCalc, pmCalcResults, qaCalcDraft } from '../inspectCalc.js'

const C = { op: 'diff', a: 'A', b: 'B', abs: false }

test('calcOf: ข้อมูลเพี้ยน/ไม่ครบ = ไม่ใช่จุดคำนวณ', () => {
  assert.equal(calcOf({}), null)
  assert.equal(calcOf({ calc: { op: 'sum', a: 'A', b: 'B' } }), null)
  assert.equal(calcOf({ calc: { op: 'diff', a: 'A' } }), null)
  assert.deepEqual(calcOf({ calc: C }), C)
})

test('calcNumber: A − B · |A − B| · ปัดเศษลอย · ค่าว่าง = null ห้ามเป็น 0', () => {
  assert.equal(calcNumber(C, '10.5', '10.2'), 0.3)
  assert.equal(calcNumber(C, 0.1, 0.3), -0.2)
  assert.equal(calcNumber({ ...C, abs: true }, 0.1, 0.3), 0.2)
  assert.equal(calcNumber(C, '', 3), null)
  assert.equal(calcNumber(C, 'abc', 3), null)
  assert.equal(calcNumber(C, 0, 0), 0)
})

test('calcFormula', () => {
  assert.equal(calcFormula(C, id => `#${id}`), '#A − #B')
  assert.equal(calcFormula({ ...C, abs: true }, id => `#${id}`), '|#A − #B|')
})

test('calcProblems: อ้างตัวเอง / จุดหาย / จุดคำนวณ / ไม่ใช่ตัวเลข / A=B / ไม่มีเกณฑ์', () => {
  const opt = { keyOf: p => p.k, isNumeric: p => p.t === 'v', hasLimit: p => p.usl != null }
  const pts = [
    { k: 'A', t: 'v' }, { k: 'B', t: 'v' }, { k: 'T', t: 'a' },
    { k: 'ok', t: 'v', usl: 1, calc: C },
    { k: 'self', t: 'v', usl: 1, calc: { op: 'diff', a: 'self', b: 'A' } },
    { k: 'gone', t: 'v', usl: 1, calc: { op: 'diff', a: 'X', b: 'A' } },
    { k: 'chain', t: 'v', usl: 1, calc: { op: 'diff', a: 'ok', b: 'A' } },
    { k: 'attr', t: 'v', usl: 1, calc: { op: 'diff', a: 'T', b: 'A' } },
    { k: 'same', t: 'v', usl: 1, calc: { op: 'diff', a: 'A', b: 'A' } },
    { k: 'nolim', t: 'v', calc: C },
  ]
  const keys = new Set(calcProblems(pts, opt).map(x => x.key))
  assert.equal(keys.has('ok'), false)
  for (const k of ['self', 'gone', 'chain', 'attr', 'same', 'nolim']) assert.ok(keys.has(k), k)
})

test('remapCalc: ชี้ id ใหม่ · อ้างจุดที่ไม่ได้ไปด้วย = null', () => {
  assert.deepEqual(remapCalc(C, { A: 'a2', B: 'b2' }), { ...C, a: 'a2', b: 'b2' })
  assert.equal(remapCalc(C, { A: 'a2' }), null)
  assert.equal(remapCalc(null, {}), null)
})

test('pmCalcResults: ผลต่างรายครั้ง v1–v3 · ไม่แตะผลของจุดอื่น · ไม่มีจุดคำนวณ = object เดิม', () => {
  const cps = [{ id: 'A', type: 'variable' }, { id: 'B', type: 'variable' }, { id: 'D', type: 'variable', calc: C }]
  const res = { A: { v1: '10', v2: '11', v3: '' }, B: { v1: '9.5', v2: '10', v3: '1' } }
  const out = pmCalcResults(cps, res)
  assert.deepEqual(out.D, { v1: '0.5', v2: '1', v3: '' })
  assert.equal(out.A, res.A)
  assert.equal(pmCalcResults(cps.slice(0, 2), res), res)
})

test('qaCalcDraft: ค่า = A − B · ต้นทางข้าม = ข้าม · ยังไม่ครบ = ว่าง · เก็บ note', () => {
  const items = [{ id: 'A' }, { id: 'B' }, { id: 'D', calc: C }]
  assert.equal(qaCalcDraft(items, { A: { value: '5' }, B: { value: '2' } }).D.value, '3')
  assert.equal(qaCalcDraft(items, { A: { value: '5' }, B: { judge: 'na' } }).D.judge, 'na')
  assert.equal(qaCalcDraft(items, { A: { value: '5' } }).D.value, '')
  assert.equal(qaCalcDraft(items, { A: { value: '5' }, B: { value: '9' }, D: { note: 'แคบ' } }).D.note, 'แคบ')
})
