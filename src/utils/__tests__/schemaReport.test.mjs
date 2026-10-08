// เทสข้อความ "แจ้งบัคให้ตรงจุด" ของหน้า /schema — src/utils/schemaReport.js
// สิ่งที่ต้องมีเสมอ: ชื่อตาราง + **ฝั่งฐานข้อมูล** (2 project ชื่อตารางคล้ายกัน เคยรัน SQL ผิดฝั่ง)
// + PK + FK · และต้องไม่พังเมื่อโครงสร้างมาไม่ครบ (ตารางไม่มี PK / โหลด detail ไม่ทัน)
import test from 'node:test'
import assert from 'node:assert/strict'
import { fkLine, tableSummaryText, bugReportText } from '../schemaReport.js'

const DETAIL = {
  k: 'r', rls: true, pk: ['id'],
  fks: [{ c: ['session_id'], rt: 'production_sessions', rc: ['id'], del: 'c' }],
  refs: [{ t: 'defect_logs', c: ['prod_order_id'], rc: ['id'], del: 'a' }],
}

test('fkLine อ่านเป็น "คอลัมน์ → ตาราง.คอลัมน์"', () => {
  assert.equal(fkLine(DETAIL.fks[0]), 'session_id → production_sessions.id')
  assert.equal(fkLine(null), '')
})

test('สรุปตารางมีครบ: ชื่อ · ฝั่งฐานข้อมูล+id · PK · FK · ตารางที่ชี้มา · หน้าที่ใช้', () => {
  const txt = tableSummaryText({
    table: 'prod_orders', projectLabel: '🏭 ข้อมูลผลิต (Product DB)', projectId: 'eyhclzkifitbhbljgoav',
    detail: DETAIL, pages: ['/daily-report'], url: 'https://x/schema?t=dr.prod_orders',
  })
  assert.match(txt, /ตาราง: prod_orders/)
  assert.match(txt, /eyhclzkifitbhbljgoav/)
  assert.match(txt, /คีย์หลัก \(PK\): id/)
  assert.match(txt, /session_id → production_sessions\.id/)
  assert.match(txt, /defect_logs\.prod_order_id/)
  assert.match(txt, /\/daily-report/)
})

test('ตารางไม่มี PK / ยังไม่มี detail — ต้องบอกว่าไม่มี ไม่ใช่เงียบหรือพัง', () => {
  const txt = tableSummaryText({ table: 'line_stock_summary', projectLabel: 'DR', detail: null })
  assert.match(txt, /คีย์หลัก \(PK\): — ไม่มี/)
  assert.match(txt, /ชี้ออกไปหา \(FK\): — ไม่มี/)
  assert.equal(tableSummaryText({}), '')
})

test('VIEW ต้องติดป้ายว่าแก้ข้อมูลตรงๆ ไม่ได้ · RLS ปิดต้องบอก', () => {
  const txt = tableSummaryText({ table: 'v_x', projectLabel: 'DR', detail: { k: 'v', rls: false, pk: [] } })
  assert.match(txt, /VIEW/)
  assert.match(txt, /RLS: ปิดอยู่/)
})

test('bugReportText มีหัวข้อหน้า + เว้นช่องให้กรอกอาการ', () => {
  const txt = bugReportText({
    pagePath: '/daily-report', pageLabel: 'Daily Report',
    table: 'prod_orders', projectLabel: 'DR', detail: DETAIL,
  })
  assert.match(txt, /หน้าที่เจอปัญหา: Daily Report \/daily-report/)
  assert.match(txt, /อาการที่เจอ/)
  assert.match(txt, /ตาราง: prod_orders/)
})
