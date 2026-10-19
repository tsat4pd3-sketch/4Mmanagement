import { test } from 'node:test'
import assert from 'node:assert/strict'
import { qaViewScope } from '../qaViewScope.js'

const L = [
  { id: 1, name: 'GOR', section: 'PD4' }, { id: 2, name: 'Laser GOR', section: 'PD4', parent_line_name: 'GOR' },
  { id: 3, name: 'Line 61', section: 'PD3' },
]
test('ส่วนงานที่ไม่มีไลน์ผลิต (QA) = เห็นทั้งโรงงาน ไม่ใช่ว่างทั้งหน้า', () => {
  const s = qaViewScope(L, { role: 'supervisor', sections: ['QA'] })
  assert.equal(s.names, null); assert.equal(s.lines.length, 3)
})
test('ส่วนงานผลิต = เฉพาะไลน์ในส่วนงาน', () => {
  const s = qaViewScope(L, { role: 'supervisor', sections: ['PD4'] })
  assert.deepEqual([...s.names].sort(), ['GOR', 'Laser GOR']); assert.equal(s.names.has('Line 61'), false)
})
test('ไม่มีขอบเขต = ไม่จำกัด', () => { assert.equal(qaViewScope(L, { role: 'qa' }).names, null) })

import { qaWriteCtx } from '../qaViewScope.js'
test('qaWriteCtx: บ้านเป็นหน่วยไม่มีไลน์ (QA) = แก้ข้อมูลคุณภาพได้ทุกไลน์ · บ้านมีไลน์ = เหมือนเดิม · ไลน์ยังไม่โหลด = ไม่ยก', () => {
  assert.equal(qaWriteCtx({ section: 'QA', allUnits: false }, L).allUnits, true)
  assert.equal(qaWriteCtx({ section: 'PD4', allUnits: false }, L).allUnits, false)
  assert.equal(qaWriteCtx({ section: 'QA', allUnits: false }, []).allUnits, false)
  assert.equal(qaWriteCtx({ section: '', allUnits: false }, L).allUnits, false)
})
