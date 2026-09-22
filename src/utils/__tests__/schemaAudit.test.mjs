// เทสตัวตรวจสุขภาพโครงสร้าง (แท็บ 🩺 ใน /schema) — src/utils/schemaAudit.js
// เคสจริงทั้งหมดมาจากรอบทำความสะอาด 2026-09-22 (ตารางสำรองค้างใน public 37 ตัว)
import test from 'node:test'
import assert from 'node:assert/strict'
import { auditProject, auditText, isBackupName, fmtBytes } from '../schemaAudit.js'

const pick = (res, id) => res.checks.find(c => c.id === id)

test('isBackupName ครอบทุกแบบที่เคยมีจริงในฐาน · ไม่จับตารางจริงผิด', () => {
  for (const n of ['_bak_20260921_862_longrange', '_reclass_dt_20260826', 'bk_notifications_link_20260916',
    'pm_plans_bak_test1_20260909', 'kanban_rounds_bak_20260827', 'production_sessions_empty_backup_20260916',
    'oee_break_overlap_backfill_20260915', 'purchase_req_bak_lotbug_20260821']) {
    assert.ok(isBackupName(n), `ต้องจับได้: ${n}`)
  }
  // 🔴 ห้าม false positive — ชื่อพวกนี้คือตารางจริงที่ใช้งานอยู่
  for (const n of ['bom_items', 'bbs_sheets', 'backup_plan', 'mtn_orders', 'kanban_standards',
    'bk', 'pm_plans', 'production_sessions']) {
    assert.ok(!isBackupName(n), `ห้ามจับ: ${n}`)
  }
})

const T = (t, o = {}) => ({ t, k: 'r', cols: 5, rows: 10, bytes: 1024, rls: true, pk: ['id'], ...o })

test('ตารางสำรองค้าง public = 🔴 และไม่ถูกนับซ้ำในหมวดอื่น', () => {
  const res = auditProject({
    tables: [T('jigs'), T('jigs_bak_test1_20260909', { rls: false, pk: [], rows: 0 })],
    used: new Set(['jigs']),
  })
  assert.equal(pick(res, 'backup').level, 'bad')
  assert.deepEqual(pick(res, 'backup').rows.map(r => r.t), ['jigs_bak_test1_20260909'])
  // ตัวสำรองต้องไม่ไปโผล่ซ้ำในหมวด RLS ปิด / ไม่มี PK / ไม่มีใครใช้ (ไม่งั้นอ่านเหมือนมีปัญหา 4 เรื่อง)
  for (const id of ['no_rls', 'no_pk', 'orphan']) {
    assert.deepEqual(pick(res, id).rows.map(r => r.t), [], `${id} ต้องไม่นับตารางสำรองซ้ำ`)
  }
})

test('RLS ปิดฝั่ง DR = 🔴 (anon เขียนได้) · ฝั่ง Main = 🟡', () => {
  const tables = [T('x', { rls: false })]
  assert.equal(pick(auditProject({ tables, side: 'dr' }), 'no_rls').level, 'bad')
  assert.equal(pick(auditProject({ tables, side: 'main' }), 'no_rls').level, 'warn')
})

test('วิวไม่ถูกฟ้องเรื่อง PK/RLS (วิวไม่มีทั้งคู่โดยธรรมชาติ)', () => {
  const res = auditProject({ tables: [T('v_store_abnormal', { k: 'v', rls: false, pk: [] })] })
  assert.deepEqual(pick(res, 'no_pk').rows, [])
  assert.deepEqual(pick(res, 'no_rls').rows, [])
})

test('"ไม่มีใครใช้" ต้องนับ FK ขาเข้าด้วย — ตารางที่ถูกตารางอื่นชี้มา ไม่ใช่ของกำพร้า', () => {
  const res = auditProject({
    tables: [T('ppe_items'), T('machine_types'), T('used_one')],
    fks: [{ t: 'ppe_requirements', c: ['ppe_item_id'], rt: 'ppe_items', rc: ['id'] },
          { t: 'machines', c: ['machine_type_id'], rt: 'machine_types', rc: ['id'] }],
    used: new Set(['used_one']),
  })
  assert.deepEqual(pick(res, 'orphan').rows.map(r => r.t), [])
})

test('ตารางที่โค้ดใช้แต่ 0 แถว = แจ้งเพื่อทราบ (ไม่ใช่ของกำพร้า)', () => {
  const res = auditProject({ tables: [T('safety_events', { rows: 0 })], used: new Set(['safety_events']) })
  assert.deepEqual(pick(res, 'empty_used').rows.map(r => r.t), ['safety_events'])
  assert.deepEqual(pick(res, 'orphan').rows.map(r => r.t), [])
})

test('Top ขนาด เรียงจากใหญ่ไปเล็ก สูงสุด 5 · ไม่พังเมื่อ bytes หาย', () => {
  const tables = Array.from({ length: 8 }, (_, i) => T(`t${i}`, { bytes: i === 3 ? null : i * 1000 }))
  const rows = pick(auditProject({ tables }), 'big').rows
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.map(r => r.t), ['t7', 't6', 't5', 't4', 't2'])
})

test('ฐานสะอาด = ทุกหมวดที่เป็นปัญหาขึ้น ok', () => {
  const res = auditProject({ tables: [T('a'), T('b')], used: new Set(['a', 'b']) })
  for (const id of ['backup', 'no_rls', 'no_pk']) assert.equal(pick(res, id).level, 'ok')
})

test('auditText อ่านรู้เรื่อง + ตัดรายการยาวแล้วบอกว่าเหลืออีกเท่าไหร่', () => {
  const tables = Array.from({ length: 45 }, (_, i) => T(`x_bak_2026090${i % 10}`, { rls: false }))
  const txt = auditText(auditProject({ tables }), '🏭 ข้อมูลผลิต')
  assert.match(txt, /🏭 ข้อมูลผลิต/)
  assert.match(txt, /อีก \d+/)
  assert.equal(auditText(null), '')
})

test('fmtBytes อ่านง่าย', () => {
  assert.equal(fmtBytes(97771520), '93 MB')
  assert.equal(fmtBytes(1024), '1 KB')
  assert.equal(fmtBytes(null), '0 B')
})
