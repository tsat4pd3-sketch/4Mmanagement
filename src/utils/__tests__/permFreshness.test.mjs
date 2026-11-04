// เทส permFreshness — แก้สิทธิ์/ขอบเขตแล้วเครื่องที่เปิดค้างต้องเห็นผล (2026-11-03 · ประชุมหน้างาน 02/11 ข้อ A5)
// + ด่านโครงสร้าง: App.jsx ต้องผูก usePermFreshness ไว้ (ถอดออก = อาการ "ต้องล้างเบราว์เซอร์" กลับมา)
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  permProbeSignature, diffPermSignature, mergePermSignature, shouldProbe, profileScopeKey,
} from '../permFreshness.js'

const base = {
  profileUpdatedAt: '2026-11-02T08:00:00Z', assignRows: [], today: '2026-11-03',
  permCount: 1135, permMaxUpdatedAt: '2026-11-01T10:00:00Z',
}

test('รอบแรก = baseline เท่านั้น ไม่สั่งโหลดอะไร', () => {
  const d = diffPermSignature(null, permProbeSignature(base))
  assert.deepEqual(d, { profile: false, perms: false })
})

test('แอดมินแก้บัญชีที่ /add-user (updated_at ขยับ) ⇒ โหลดโปรไฟล์ใหม่ ไม่แตะตารางสิทธิ์', () => {
  const a = permProbeSignature(base)
  const b = permProbeSignature({ ...base, profileUpdatedAt: '2026-11-03T09:15:00Z' })
  assert.deepEqual(diffPermSignature(a, b), { profile: true, perms: false })
})

test('ติ๊กสิทธิ์ที่ /permissions (max updated_at ขยับ) หรือลบแถว (จำนวนลด) ⇒ โหลดสิทธิ์ใหม่', () => {
  const a = permProbeSignature(base)
  assert.deepEqual(diffPermSignature(a, permProbeSignature({ ...base, permMaxUpdatedAt: '2026-11-03T09:00:00Z' })),
    { profile: false, perms: true })
  assert.deepEqual(diffPermSignature(a, permProbeSignature({ ...base, permCount: 1134 })),
    { profile: false, perms: true })
})

test('มอบหมายรักษาการเพิ่ม/ลบ ⇒ โหลดโปรไฟล์ใหม่ · ลำดับแถวจาก DB สลับ ≠ เปลี่ยน', () => {
  const r1 = { id: 'a', org_node_id: 5, kind: 'acting', scope_depth: 'unit', starts_on: '2026-11-01', ends_on: null }
  const r2 = { id: 'b', org_node_id: 9, kind: 'extra', scope_depth: 'dept', starts_on: '2026-11-01', ends_on: '2026-12-01' }
  const a = permProbeSignature({ ...base, assignRows: [r1, r2] })
  assert.deepEqual(diffPermSignature(a, permProbeSignature({ ...base, assignRows: [r2, r1] })),
    { profile: false, perms: false })
  assert.equal(diffPermSignature(a, permProbeSignature({ ...base, assignRows: [r1] })).profile, true)
})

test('ข้ามวันทำงาน: มีมอบหมาย ⇒ คิดใหม่ (วันเริ่ม/หมดอายุ) · ไม่มีมอบหมาย ⇒ ไม่ยิงฟรี', () => {
  const r1 = { id: 'a', org_node_id: 5, kind: 'acting', starts_on: '2026-11-04' }
  const withA = permProbeSignature({ ...base, assignRows: [r1] })
  assert.equal(diffPermSignature(withA, permProbeSignature({ ...base, assignRows: [r1], today: '2026-11-04' })).profile, true)
  const noA = permProbeSignature(base)
  assert.equal(diffPermSignature(noA, permProbeSignature({ ...base, today: '2026-11-04' })).profile, false)
})

test('probe อ่านไม่ได้ (null) = "ไม่รู้" — ไม่สั่งโหลด และไม่ลบ baseline เดิม', () => {
  const a = permProbeSignature(base)
  const broken = permProbeSignature({ ...base, profileUpdatedAt: null, permCount: null })
  assert.deepEqual(broken, { profile: null, perms: null })
  assert.deepEqual(diffPermSignature(a, broken), { profile: false, perms: false })
  const kept = mergePermSignature(a, broken)
  assert.deepEqual(kept, a)
  // เน็ตกลับมา + แอดมินแก้ระหว่างนั้น ⇒ ยังจับได้ (เพราะ baseline ไม่ถูกลบ)
  const after = permProbeSignature({ ...base, profileUpdatedAt: '2026-11-03T10:00:00Z' })
  assert.equal(diffPermSignature(kept, after).profile, true)
})

test('baseline ฝั่งสิทธิ์ถูกล้าง (realtime โหลดไปแล้ว) ⇒ รอบหน้าจดใหม่ ไม่โหลดซ้ำ', () => {
  const a = { ...permProbeSignature(base), perms: null }
  const b = permProbeSignature({ ...base, permMaxUpdatedAt: '2026-11-03T09:00:00Z' })
  assert.equal(diffPermSignature(a, b).perms, false)
  assert.equal(mergePermSignature(a, b).perms, b.perms)
})

test('shouldProbe — เพดานกัน focus+visibilitychange ยิงคู่', () => {
  assert.equal(shouldProbe(1_000, 0, 120_000), true)
  assert.equal(shouldProbe(100_000, 1_000, 120_000), false)
  assert.equal(shouldProbe(121_000, 1_000, 120_000), true)
})

test('profileScopeKey — รูป/ลายเซ็นเปลี่ยนไม่กระทบ · role/ขอบเขตเปลี่ยน = คนละคีย์ · ลำดับ array ไม่มีผล', () => {
  const p = { role: 'leader', lineId: 12, team: 'A', section: 'PD1', sections: ['PD1', 'PD2'], respCcs: [], isDeptAdmin: false }
  assert.equal(profileScopeKey(p), profileScopeKey({ ...p, sections: ['PD2', 'PD1'] }))
  assert.notEqual(profileScopeKey(p), profileScopeKey({ ...p, role: 'supervisor' }))
  assert.notEqual(profileScopeKey(p), profileScopeKey({ ...p, isDeptAdmin: true }))
  assert.notEqual(profileScopeKey(p), profileScopeKey({ ...p, respCcs: ['4110'] }))
})

test('ด่าน: App.jsx ต้องผูก usePermFreshness (ถอด = แท็บเปิดค้างถือสิทธิ์เก่าจนรีเฟรช)', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const app = readFileSync(join(here, '..', '..', 'App.jsx'), 'utf8')
  assert.match(app, /usePermFreshness\(\s*session\?\.user\?\.id/, 'App.jsx ต้องเรียก usePermFreshness(session?.user?.id …)')
  assert.match(app, /onProfile:\s*async/, 'ต้องมี onProfile ที่โหลดโปรไฟล์ใหม่ (fetchProfile)')
  assert.match(app, /onPerms:\s*async/, 'ต้องมี onPerms ที่โหลด role_permissions ใหม่')
})
