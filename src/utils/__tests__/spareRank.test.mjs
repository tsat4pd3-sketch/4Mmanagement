// เทส Rank อะไหล่ (WI-JIG-010) — โฟกัสกับดักที่เคยพลาดจริง
//   T2-10: แถวสร้างวันนี้ + ประวัติ Excel 6 เดือน → ตัวหารต้องเป็นจำนวนเดือนที่มีข้อมูล ไม่ใช่อายุแถว
//   "ไม่มีประวัติ = ไม่รู้" ห้ามตีเป็น 0 (Number(null) === 0)
import test from 'node:test'
import assert from 'node:assert/strict'
import { avgMonthlyUsage, computeSpareRank, monthKeysBack } from '../spareRank.js'

const ref = new Date(2026, 7, 15) // 2026-08-15
const keys = monthKeysBack(6, ref)
const rowsMonthly = (perMonth) => keys.map(k => ({ month_key: k, qty_out: perMonth, qty_in: 0 }))

test('T2-10: แถว import วันนี้ + ประวัติ 6 เดือน (เดือนละ 2) → avg = 2 ไม่ใช่ 12', () => {
  const { avg, months } = avgMonthlyUsage(rowsMonthly(2), { ref, createdAt: '2026-08-15' })
  assert.equal(months, 6)
  assert.equal(avg, 2)
})

test('อะไหล่ใหม่จริง (สร้างเดือนนี้ ยังไม่มีประวัติ) → hasHistory=false ไม่จัด Rank', () => {
  const r = computeSpareRank({ created_at: '2026-08-15', lead_time_days: 10 }, [], { ref })
  assert.equal(r.rank, null) // avg=null + LT<15 → ตารางตัดสินไม่ได้
})

test('อะไหล่อายุ 3 เดือน มีข้อมูลแค่เดือนเดียว → หารด้วยอายุ (3) ไม่ใช่ 1', () => {
  const { avg, months } = avgMonthlyUsage(
    [{ month_key: keys[5], qty_out: 6, qty_in: 0 }],
    { ref, createdAt: '2026-06-01' })
  assert.equal(months, 3)
  assert.equal(avg, 2)
})

test('ไม่มีประวัติแต่ LT > 45 วัน → Rank A จากแกน leadtime อย่างเดียว', () => {
  const r = computeSpareRank({ created_at: '2026-08-15', lead_time_days: 60 }, [], { ref })
  assert.equal(r.rank, 'A')
})

test('override ชนะค่าคำนวณ', () => {
  const r = computeSpareRank(
    { created_at: '2026-01-01', lead_time_days: 5, rank_override: 'A', rank_note: 'สำรองวิกฤต' },
    rowsMonthly(1), { ref })
  assert.equal(r.rank, 'A')
})
