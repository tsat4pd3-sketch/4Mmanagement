// 🏭 AM รายวัน — ตัวสรุปต่อไลน์ที่ผังรวมโรงงานกับ /daily-checker?tab=pm ใช้ร่วมกัน (2026-10-08)
// ⏱️ ทุกเคสตรึง `now` — ห้ามพึ่งนาฬิกาเครื่อง (รอบเทส +400 วัน)
import test from 'node:test'
import assert from 'node:assert/strict'
import { amShiftInfo, dailyAmLineStatus, dailyAmTargetsByLine, isDailyAmEquipment, openFamilyLines } from '../pmDailyStatus.js'

const jigs = [
  { id: 'j1', name: 'ROBOT 1', machine_no: 'RB-01', equipment_type: 'machine', equipment_category: 'production' },
  { id: 'j2', name: 'ROBOT 2', machine_no: 'RB-02', equipment_type: 'machine', equipment_category: 'production' },
  { id: 'j3', name: 'JIG X', machine_no: null, equipment_type: 'jig', equipment_category: 'production' },
]
// jigs ที่ผ่านขอบเขต AM แล้ว (loader กรองด้วย isDailyAmEquipment ก่อนส่งเข้า dailyAmLineStatus)
const amJigs = jigs.slice(0, 2)
const targets = [
  { line_name: 'ASSEMBLY 1', jig_id: 'j1', shift: null },
  { line_name: 'ASSEMBLY 1', jig_id: 'j2', shift: 'night' },   // เฉพาะกะดึก
  { line_name: 'ASSEMBLY 1', jig_id: 'j3', shift: null },      // อุปกรณ์ที่ถูกกรองออกจากขอบเขต AM
  { line_name: 'LINE B', jig_id: 'j2', shift: null },
]

test('amShiftInfo — กะ/วันทำงาน/เวลาเริ่มกะ คิดจาก now ที่ส่งมา (ก่อน 08:00 = กะดึกของเมื่อวาน)', () => {
  const d = amShiftInfo(new Date(2026, 9, 8, 9, 30))
  assert.equal(d.shift, 'day'); assert.equal(d.workDateStr, '2026-10-08')
  assert.equal(d.shiftStart.getTime(), new Date(2026, 9, 8, 8, 0).getTime())
  const n = amShiftInfo(new Date(2026, 9, 8, 3, 0))
  assert.equal(n.shift, 'night'); assert.equal(n.workDateStr, '2026-10-07')
  assert.equal(n.shiftStart.getTime(), new Date(2026, 9, 7, 20, 0).getTime())
})

test('isDailyAmEquipment — jig/die/facility ตัดออก เว้นแต่มี checklist AM อยู่แล้ว', () => {
  assert.equal(isDailyAmEquipment(jigs[2], new Set()), false)
  assert.equal(isDailyAmEquipment(jigs[2], new Set(['j3'])), true)
  assert.equal(isDailyAmEquipment({ id: 'x', equipment_type: null, equipment_category: null }, new Set()), true) // legacy ไม่ระบุ = อยู่
  assert.equal(isDailyAmEquipment({ id: 'y', equipment_type: 'machine', equipment_category: 'utility' }, new Set()), false)
})

test('dailyAmTargetsByLine — target กะอื่นและอุปกรณ์นอกขอบเขตถูกข้าม', () => {
  const day = dailyAmTargetsByLine({ targets, jigs: amJigs, shift: 'day' })
  assert.deepEqual(Object.keys(day).sort(), ['ASSEMBLY 1', 'LINE B'])
  assert.equal(day['ASSEMBLY 1'].length, 1)
  const night = dailyAmTargetsByLine({ targets, jigs: amJigs, shift: 'night' })
  assert.equal(night['ASSEMBLY 1'].length, 2)
})

test('dailyAmLineStatus — ยังไม่เริ่มผลิต = idle ไม่ใช่เขียว · hasSession แยกเคสเปิดกะแล้วแต่ยังไม่เปิดใบ', () => {
  const now = new Date(2026, 9, 8, 9, 0)
  const out = dailyAmLineStatus({ targets, jigs: amJigs, resultByJig: {}, firstOrderByLine: {}, openSessionLines: new Set(['LINE B']), shift: 'day', now })
  assert.equal(out['ASSEMBLY 1'].status, 'idle')
  assert.equal(out['ASSEMBLY 1'].notStarted, 1); assert.equal(out['ASSEMBLY 1'].late, 0); assert.equal(out['ASSEMBLY 1'].wait, 0)
  assert.equal(out['ASSEMBLY 1'].hasSession, false)
  assert.equal(out['LINE B'].hasSession, true)
})

test('dailyAmLineStatus — ในกรอบ 60 นาที = wait · เกินกรอบ = late · fail = แดงและนับ ngN', () => {
  const opened = new Date(2026, 9, 8, 8, 10).toISOString()
  const inWindow = dailyAmLineStatus({ targets, jigs: amJigs, firstOrderByLine: { 'ASSEMBLY 1': opened, 'LINE B': opened }, shift: 'day', now: new Date(2026, 9, 8, 8, 30) })
  assert.equal(inWindow['ASSEMBLY 1'].status, 'pending'); assert.equal(inWindow['ASSEMBLY 1'].wait, 1)
  const late = dailyAmLineStatus({ targets, jigs: amJigs, firstOrderByLine: { 'ASSEMBLY 1': opened, 'LINE B': opened }, shift: 'day', now: new Date(2026, 9, 8, 9, 30) })
  assert.equal(late['ASSEMBLY 1'].status, 'orange'); assert.equal(late['ASSEMBLY 1'].late, 1)
  const ng = dailyAmLineStatus({ targets, jigs: amJigs, resultByJig: { j1: { status: 'fail' }, j2: { status: 'pass' } },
    firstOrderByLine: { 'ASSEMBLY 1': opened, 'LINE B': opened }, shift: 'day', now: new Date(2026, 9, 8, 9, 30) })
  assert.equal(ng['ASSEMBLY 1'].status, 'red'); assert.equal(ng['ASSEMBLY 1'].ngN, 1); assert.equal(ng['ASSEMBLY 1'].checked, 1)
  assert.equal(ng['LINE B'].status, 'green'); assert.equal(ng['LINE B'].checked, 1); assert.equal(ng['LINE B'].total, 1)
  // pending (ยังไม่สรุปผล) ยังไม่ถือว่าตรวจแล้ว
  const pend = dailyAmLineStatus({ targets, jigs: amJigs, resultByJig: { j2: { status: 'pending' } }, firstOrderByLine: { 'LINE B': opened }, shift: 'day', now: new Date(2026, 9, 8, 9, 30) })
  assert.equal(pend['LINE B'].status, 'orange'); assert.equal(pend['LINE B'].checked, 0)
})

/* ══ openFamilyLines — "ไลน์ไหนเดินอยู่" ต้องนับไลน์แม่-ลูก (2026-10-13) ══════════════════
   เคสจริงที่วัดมา: ไลน์แม่ HYDROFORM / GOR / LWR BAR / LINE APRON ASSY เปิดกะ 0 ครั้งใน 45 วัน
   (ลูกเดินทุกวันแทน) แต่ถือแผน LPA รวม 30 แผน ⇒ เทียบชื่อตรงตัว = งานตรวจของไลน์แม่หายเงียบ */
const famLines = [
  { id: 1, name: 'HYDROFORM', parent_line_name: null },
  { id: 2, name: 'HDF1',      parent_line_name: 'HYDROFORM' },
  { id: 3, name: 'HDF2',      parent_line_name: 'HYDROFORM' },
  { id: 4, name: 'LINE SOLO', parent_line_name: null },
]

test('openFamilyLines: ลูกเปิดกะ ⇒ ไลน์แม่ต้องถือว่าเดินอยู่', () => {
  const open = openFamilyLines(famLines, new Set(['HDF1']))
  assert.ok(open.has('HDF1'), 'ตัวที่เปิดกะจริงต้องอยู่')
  assert.ok(open.has('HYDROFORM'), 'ไลน์แม่ต้องถูกนับ — ไม่งั้นแผน LPA ของแม่หายเงียบ')
})

test('openFamilyLines: ไลน์พี่น้องที่ไม่ได้เดิน ห้ามถูกลากเข้ามา', () => {
  const open = openFamilyLines(famLines, new Set(['HDF1']))
  assert.ok(!open.has('HDF2'), 'HDF2 ไม่ได้เปิดกะ ห้ามนับ (family ไม่รวมพี่น้อง)')
  assert.ok(!open.has('LINE SOLO'), 'ไลน์นอกครอบครัวห้ามนับ')
})

test('openFamilyLines: แม่เปิดกะ ⇒ ลูกนับด้วย (พื้นที่เดียวกันเดินอยู่)', () => {
  const open = openFamilyLines(famLines, new Set(['HYDROFORM']))
  assert.ok(open.has('HDF1') && open.has('HDF2'), 'ลูกต้องถูกนับเมื่อแม่เดิน')
})

test('openFamilyLines: ชื่อที่เปิดกะแต่ไม่อยู่ในทะเบียนไลน์ ต้องไม่หาย', () => {
  const open = openFamilyLines(famLines, new Set(['SW-10']))   // เปิดกะด้วยชื่อเครื่อง
  assert.ok(open.has('SW-10'))
  assert.equal(open.size, 1, 'ห้ามลากไลน์อื่นเข้ามา')
})

test('openFamilyLines: ไม่มีกะเปิดเลย / ไม่ส่งทะเบียนไลน์ = ชุดว่าง ไม่พัง', () => {
  assert.equal(openFamilyLines(famLines, new Set()).size, 0)
  assert.equal(openFamilyLines(null, new Set(['HDF1'])).size, 1)
  assert.equal(openFamilyLines(famLines, null).size, 0)
})

test('openFamilyLines: รับ array ได้ด้วย (ไม่ใช่ Set) — ห้ามคืนว่างเงียบ', () => {
  const open = openFamilyLines(famLines, ['HDF2'])
  assert.ok(open.has('HDF2') && open.has('HYDROFORM'))
})
