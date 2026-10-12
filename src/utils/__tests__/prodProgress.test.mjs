// เทส prodProgress — แถบ "ยอดผลิตวันนี้ เทียบใบสั่งผลิต" (2026-10-12)
// เคสจากจอจริง 12/10 08:30: ทุกไลน์ 0–6% ขึ้นแดง "ตามหลัง" ทั้งที่กะเพิ่งเริ่ม
import test from 'node:test'
import assert from 'node:assert/strict'
import { countsInProgress, orderTargetQty, orderMadeQty, lineVerdict, PROGRESS_COLOR } from '../prodProgress.js'

test('ใบยกเลิกไม่นับ · ใบยกยอด/ถูกรับไปนับเฉพาะที่ทำจริง (กันยอดเหลือนับ 2 ที่)', () => {
  assert.equal(countsInProgress({ status: 'cancelled' }), false)
  assert.equal(countsInProgress({ status: 'carry_over' }), true)
  assert.equal(countsInProgress({ status: 'imported' }), true)
  assert.equal(countsInProgress({ status: 'open' }), true)
  assert.equal(countsInProgress(null), false)
  assert.equal(orderTargetQty({ status: 'carry_over', qty: 500, qty_actual: 120 }), 120)
  assert.equal(orderTargetQty({ status: 'imported', qty: 500, qty_actual: null }), 0)
  assert.equal(orderTargetQty({ status: 'open', qty: 500, qty_target: 450 }), 450)
  assert.equal(orderTargetQty({ status: 'open', qty: 500 }), 500)
})

test('ยอดที่ทำได้ — สูตรบังคับ confirmed ? (qty_ok ?? qty) : (qty_actual ?? 0)', () => {
  assert.equal(orderMadeQty({ status: 'confirmed', qty: 14, qty_ok: 35 }), 35)
  assert.equal(orderMadeQty({ status: 'confirmed', qty: 14 }), 14)
  assert.equal(orderMadeQty({ status: 'open', qty: 800, qty_actual: 108 }), 108)
  assert.equal(orderMadeQty({ status: 'open', qty: 800 }), 0)
})

test('กะยังไม่จบ = ไม่แดง ไม่นับว่าตามหลัง (ไม่รู้ความยาวกะ ห้ามเดา)', () => {
  const v = lineVerdict({ target: 364, made: 0, open: true })
  assert.equal(v.color, PROGRESS_COLOR.live)
  assert.equal(v.behind, false)
  assert.equal(v.final, false)
  assert.match(v.note, /ยังไม่ลงยอด/)
  assert.equal(lineVerdict({ target: 1200, made: 600, open: true }).note, 'กะยังไม่จบ')
})

test('ครบเป้า = เขียวทันทีแม้กะยังเปิด · ปิดกะแล้วไม่ครบ = ตัดสินสี', () => {
  assert.equal(lineVerdict({ target: 14, made: 35, open: true }).color, PROGRESS_COLOR.good)
  const bad = lineVerdict({ target: 100, made: 50, open: false })
  assert.equal(bad.color, PROGRESS_COLOR.bad); assert.equal(bad.behind, true)
  const warn = lineVerdict({ target: 100, made: 90, open: false })
  assert.equal(warn.color, PROGRESS_COLOR.warn); assert.equal(warn.behind, false)
})

test('ไม่มีใบสั่งผลิต = pct null ไม่ใช่ 0%', () => {
  const v = lineVerdict({ target: 0, made: 0, open: true })
  assert.equal(v.pct, null)
  assert.equal(v.behind, false)
})
