// ✍️ ลงนามทบทวน AM รายเดือน — ขั้น 3 ของสาย AM (หัวหน้าแผนก/ส่วน · 2026-11-03)
// ⏱️ ทุกเคสตรึง `now` — ห้ามพึ่งนาฬิกาเครื่อง (รอบเทส +400 วัน)
import test from 'node:test'
import assert from 'node:assert/strict'
import { amMonthComplete, amNextMonthFirst, amSignoffSnapshot, amSignoffDrift, amSignoffDriftText, amSignoffAoa } from '../amMonthly.js'
import { amMonthlySignoffVerdict, amMonthlyRevokeVerdict, amMonthlySignoffText, AM_MONTHLY_SIGNOFF_MIN_RANK } from '../../utils/amApproval.js'

const LEAD = 40, SUP = 50, MGR = 60

test('amMonthComplete — เปิดลงนามหลังกะดึกวันสุดท้ายจบ (08:00 วันที่ 1 เดือนถัดไป เวลาไทย)', () => {
  assert.equal(amNextMonthFirst('2026-12'), '2027-01-01')
  assert.equal(amNextMonthFirst('2026-13'), null)
  // 31 ธ.ค. 23:00 ไทย = กะดึกของวันสุดท้ายยังเดิน
  assert.equal(amMonthComplete('2026-12', new Date('2026-12-31T16:00:00Z')).complete, false)
  // 1 ม.ค. 07:59 ไทย = ยังเป็นกะดึกของ 31 ธ.ค.
  assert.equal(amMonthComplete('2026-12', new Date('2027-01-01T00:59:00Z')).complete, false)
  // 1 ม.ค. 08:00 ไทย = จบ
  const c = amMonthComplete('2026-12', new Date('2027-01-01T01:00:00Z'))
  assert.equal(c.complete, true)
  assert.equal(c.opensOn, '2027-01-01 08:00')
  assert.equal(amMonthComplete('2026-11', new Date('2027-03-01T01:00:00Z')).complete, true)   // เดือนเก่า
  assert.equal(amMonthComplete('2027-02', new Date('2026-12-15T03:00:00Z')).complete, false)  // เดือนอนาคต
  assert.equal(amMonthComplete('bad', new Date('2027-01-01T01:00:00Z')).complete, false)
})

const base = { permitted: true, sharedAccount: false, scopeOk: true, signerRank: SUP, monthComplete: true, alreadySigned: false }

test('amMonthlySignoffVerdict — หัวหน้าแผนก/ส่วนขึ้นไปเท่านั้น · ผู้จัดการลงได้ (ขั้นสุดท้าย ไม่ใช่ข้ามขั้น)', () => {
  assert.equal(AM_MONTHLY_SIGNOFF_MIN_RANK, 50)
  assert.equal(amMonthlySignoffVerdict(base).ok, true)
  assert.equal(amMonthlySignoffVerdict({ ...base, signerRank: MGR }).ok, true)
  assert.equal(amMonthlySignoffVerdict({ ...base, signerRank: LEAD }).code, 'rank_too_low')
})

test('amMonthlySignoffVerdict — ลำดับด่าน: สิทธิ์ → บัญชีกลาง → ขอบเขต → ตำแหน่ง → เดือนจบ → ลงซ้ำ', () => {
  assert.equal(amMonthlySignoffVerdict({ ...base, permitted: false }).code, 'no_perm')
  assert.equal(amMonthlySignoffVerdict({ ...base, sharedAccount: true }).code, 'shared_account')
  assert.equal(amMonthlySignoffVerdict({ ...base, scopeOk: false }).code, 'scope')
  assert.equal(amMonthlySignoffVerdict({ ...base, monthComplete: false }).code, 'month_running')
  assert.equal(amMonthlySignoffVerdict({ ...base, alreadySigned: true }).code, 'already_signed')
  assert.equal(amMonthlySignoffVerdict({}).ok, false, 'ค่า default = ปิด')
  for (const code of ['no_perm', 'shared_account', 'scope', 'rank_too_low', 'month_running', 'already_signed']) {
    assert.ok(amMonthlySignoffText({ ok: false, code }, { opensOn: '2027-01-01 08:00' }), code)
  }
  assert.ok(amMonthlySignoffText({ ok: false, code: 'month_running' }, { opensOn: '2027-01-01 08:00' }).includes('2027-01-01'))
})

test('ไม่รู้ตำแหน่ง = ไม่บล็อก แต่ต้องติดธง assumed ให้จอเขียนบอก', () => {
  const v = amMonthlySignoffVerdict({ ...base, signerRank: null })
  assert.equal(v.ok, true)
  assert.deepEqual(v.assumed, ['approver'])
  assert.deepEqual(amMonthlySignoffVerdict(base).assumed, [])
})

test('amMonthlyRevokeVerdict — ผู้ลงนามถอนเองได้ · คนอื่นต้องตำแหน่ง ≥ ผู้ลงนาม · ต้องมีเหตุผล', () => {
  const r = { permitted: true, scopeOk: true, reason: 'ตัวเลขผิด ลงใหม่' }
  assert.equal(amMonthlyRevokeVerdict({ ...r, revokerRank: SUP, signerRank: SUP }).ok, true)
  assert.equal(amMonthlyRevokeVerdict({ ...r, revokerRank: SUP, signerRank: MGR }).code, 'rank_too_low')
  assert.equal(amMonthlyRevokeVerdict({ ...r, revokerRank: MGR, signerRank: SUP }).ok, true)
  assert.equal(amMonthlyRevokeVerdict({ ...r, revokerRank: LEAD, signerRank: null, isSigner: false }).code, 'rank_too_low')
  assert.equal(amMonthlyRevokeVerdict({ ...r, revokerRank: SUP, signerRank: MGR, isSigner: true }).ok, true)
  assert.equal(amMonthlyRevokeVerdict({ ...r, reason: 'สั้น', revokerRank: SUP, signerRank: SUP }).code, 'reason')
  assert.equal(amMonthlyRevokeVerdict({ ...r, permitted: false }).code, 'no_perm')
  assert.equal(amMonthlyRevokeVerdict({ ...r, sharedAccount: true }).code, 'shared_account')
  assert.equal(amMonthlyRevokeVerdict({ ...r, scopeOk: false }).code, 'scope')
})

const row = {
  line_name: 'HYDROFORM', ngN: 1,
  sum: { due: 10, done: 9, missed: 1, no_run: 2, unknown: 0, off: 4, pct: 90 },
  machines: [
    { jig_id: 'j1', name: 'PRESS 1', machine_no: 'P-01', ngN: 1, sum: { due: 5, done: 5, missed: 0, no_run: 1, unknown: 0, pct: 100 } },
    { jig_id: 'j2', name: 'PRESS 2', machine_no: 'P-02', ngN: 0, sum: { due: 5, done: 4, missed: 1, no_run: 1, unknown: 0, pct: 80 } },
  ],
}

test('amSignoffSnapshot + amSignoffDrift — ตรงกัน = ไม่มีความต่าง · แก้ย้อนหลัง = บอกตรงไหนต่าง', () => {
  const snap = JSON.parse(JSON.stringify(amSignoffSnapshot(row, { month: '2026-12', shift: 'day' })))   // ผ่าน jsonb จริง
  assert.equal(snap.v, 1)
  assert.equal(snap.sum.pct, 90)
  assert.equal(snap.machines.length, 2)
  assert.deepEqual(amSignoffDrift(snap, row), [])

  const later = JSON.parse(JSON.stringify(row))
  later.sum.done = 10; later.sum.missed = 0; later.sum.pct = 100
  later.machines[1].sum.done = 5; later.machines[1].sum.missed = 0
  const d = amSignoffDrift(snap, later)
  assert.ok(d.some(x => x.field === 'done' && x.was === 9 && x.now === 10))
  assert.ok(d.some(x => x.field === 'pct'))
  assert.ok(d.some(x => x.field === 'machine' && x.machine === 'P-02'))
  assert.ok(amSignoffDriftText(d).length > 0)

  const added = JSON.parse(JSON.stringify(row))
  added.machines.push({ jig_id: 'j3', name: 'PRESS 3', machine_no: 'P-03', ngN: 0, sum: { due: 0, done: 0, missed: 0 } })
  assert.ok(amSignoffDrift(snap, added).some(x => x.field === 'machine_added' && x.machine === 'P-03'))
  const removed = { ...row, machines: [row.machines[0]] }
  assert.ok(amSignoffDrift(snap, removed).some(x => x.field === 'machine_removed' && x.machine === 'P-02'))
})

test('amSignoffDrift — ไลน์หาย / snapshot เสีย = ห้ามถือว่าตรงกัน', () => {
  const snap = amSignoffSnapshot(row, { month: '2026-12', shift: 'day' })
  assert.equal(amSignoffDrift(snap, null)[0].field, 'line')
  assert.equal(amSignoffDrift(null, row)[0].field, 'snapshot')
  assert.equal(amSignoffDrift({}, row)[0].field, 'snapshot')
  assert.equal(amSignoffSnapshot(null), null)
})

test('amSignoffAoa — 1 แถวต่อไลน์ · ยังไม่ลงนามห้ามตัดทิ้ง · อ่านทะเบียนไม่ได้ต้องเขียนบอก', () => {
  const snap = amSignoffSnapshot(row, { month: '2026-12', shift: 'day' })
  const signed = { active: { signed_by_name: 'สมชาย', position: 'dept_head', signed_at: '2027-01-02T03:00:00Z', signature_url: 'https://x/s.png', note: 'ok', snapshot: snap }, revoked: [{}] }
  const by = new Map([['HYDROFORM', signed]])
  const lineB = { ...row, line_name: 'LINE B' }
  const aoa = amSignoffAoa([row, lineB], by, { positionLabel: v => (v === 'dept_head' ? 'หัวหน้าแผนก' : v) })
  assert.equal(aoa[0][0], 'ไลน์')
  assert.equal(aoa.length, 3)
  assert.deepEqual(aoa[1].slice(0, 6), ['HYDROFORM', 'ลงนามแล้ว', 'สมชาย', 'หัวหน้าแผนก', '2027-01-02T03:00:00Z', 'https://x/s.png'])
  assert.equal(aoa[1][7], '9/10')
  assert.equal(aoa[1][11], 'ตรงกัน')
  assert.equal(aoa[1][12], 1)
  assert.equal(aoa[2][1], 'ยังไม่ลงนาม')
  const un = amSignoffAoa([row], null, { unreadable: 'อ่านไม่ได้' })
  assert.equal(un[1][1], 'อ่านไม่ได้')
})
