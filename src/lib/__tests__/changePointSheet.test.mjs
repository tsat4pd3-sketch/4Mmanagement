// 📅 ใบ Changing Point Control Record (FM-PD2-037) — ปฏิทิน X/O/-/? + ตาราง detail (2026-11-05)
// ⏱️ ตรึง `today` ทุกเคส — ห้ามพึ่งนาฬิกาเครื่อง
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildChangePointSheet, changePointSheetHtml, cpcShiftOf } from '../changePointSheet.js'
import { CHECKLIST_ITEMS, matchChecklistItem } from '../changePointChecklist.js'

const TODAY = '2026-10-20'
const log = (o) => ({ id: o.id, work_date: '2026-10-12', category: 'Man', description: 'นาย ก ย้ายไปจุด SP-10',
  status: 'approved', created_at: '2026-10-12T03:00:00Z', line_name: 'Line 60', ...o })   // 10:00 ไทย = กะเช้า

test('หัวข้อตรงใบจริง 11 แถว — ไม่มี "อื่นๆ"', () => {
  assert.equal(CHECKLIST_ITEMS.length, 11)
  assert.ok(!CHECKLIST_ITEMS.some(i => /อื่นๆ/.test(i.label)))
})

test('ใบ Man "ย้ายไปจุด" = พนักงานทดแทนชั่วคราว · ไม่ตรงคำ = null (ห้าม fallback)', () => {
  assert.equal(matchChecklistItem({ category: 'Man', description: 'สมชาย ย้ายไปจุด INSPECTION 60' }).id, 'man_temp')
  assert.equal(matchChecklistItem({ category: 'Method', description: 'อะไรสักอย่าง' }), null)
})

test('กะของใบ — เวลาไทย 08:00-19:59 = D · นอกนั้น = N', () => {
  assert.equal(cpcShiftOf({ created_at: '2026-10-12T03:00:00Z' }), 'day')
  assert.equal(cpcShiftOf({ created_at: '2026-10-12T14:00:00Z' }), 'night')   // 21:00 ไทย
})

test('สัญลักษณ์: X มีเปลี่ยน · O เปิดกะ · - ไม่เปิดกะ · ? ไม่รู้ · ว่าง = อนาคต · rejected ไม่นับ', () => {
  const ranOn = (date, shift) => (date === '2026-10-13' ? null : date === '2026-10-14' ? false : shift === 'day')
  const s = buildChangePointSheet({ month: '2026-10', today: TODAY, ranOn, logs: [
    log({ id: 'a' }),
    log({ id: 'b', work_date: '2026-10-15', status: 'rejected' }),
    log({ id: 'c', work_date: '2026-10-16', category: 'Method', description: 'xyz' }),
    log({ id: 'd', work_date: '2026-10-16', status: 'pending_doc' }),
  ] })
  const temp = s.rows.find(r => r.item.id === 'man_temp')
  const day = temp.shifts[0].cells, night = temp.shifts[1].cells
  assert.equal(day[11].state, 'hit')        // 12 ต.ค. D
  assert.equal(night[11].state, 'no_run')   // 12 ต.ค. N (ranOn คืน false สำหรับ night)
  assert.equal(day[12].state, 'unknown')    // 13 ต.ค. อ่านไม่ได้ ≠ ไม่ทำงาน
  assert.equal(day[13].state, 'no_run')     // 14 ต.ค.
  assert.equal(day[14].state, 'ok')         // 15 ต.ค. — ใบ rejected ไม่นับ
  assert.equal(day[15].state, 'hit')        // 16 ต.ค. — ใบที่ยังรออนุมัติก็นับ
  assert.equal(day[25].state, 'future')     // 26 ต.ค. > today
  assert.equal(s.details.length, 3)         // rejected ไม่อยู่ใน detail
  assert.equal(s.unmatchedCount, 1)
  assert.equal(s.pendingCount, 1)
  assert.ok(s.days[2].weekend)              // 3 ต.ค. 2026 = เสาร์
})

test('HTML: escape ข้อความคน · มีตาราง detail ≥10 แถว · legend มี "-" · ปี พ.ศ.', () => {
  const s = buildChangePointSheet({ month: '2026-10', today: TODAY, ranOn: () => true,
    logs: [log({ id: 'a', description: '<script>x</script> ย้าย' })] })
  const html = changePointSheetHtml(s, { line: 'Line 60', names: {} })
  assert.ok(!html.includes('<script>x'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('ผู้เปลี่ยนแปลง') && html.includes('ประกันคุณภาพ'))
  assert.ok(html.includes('- = ไม่มีการทำงาน'))
  assert.ok(html.includes('2569'))
  assert.ok((html.match(/<tr>/g) || []).length > 30)
})
