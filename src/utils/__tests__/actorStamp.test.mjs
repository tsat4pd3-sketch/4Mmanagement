// เทส actorStamp — ล็อกพฤติกรรมการเทียบชื่อคน (2026-09-16)
// ⚠️ เคสในไฟล์นี้ถอดจากข้อมูลจริงในฐานข้อมูล ไม่ใช่ตัวอย่างสมมติ
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  setActor, getActor, actorFields,
  normPersonName, personKey, samePerson, countPeople,
} from '../actorStamp.js'

test('normPersonName — ยุบช่องว่างซ้ำ (เคสจริง: employees เก็บ "ฉัตรชัย  ใจรักเรียน" 2 ช่อง)', () => {
  assert.equal(normPersonName('ฉัตรชัย  ใจรักเรียน'), 'ฉัตรชัย ใจรักเรียน')
  assert.equal(normPersonName('มนตรี  งะสกุล'), 'มนตรี งะสกุล')
  assert.equal(normPersonName('  ชลทิตย์ วิฬุละหิต  '), 'ชลทิตย์ วิฬุละหิต')
})

test('normPersonName — ตัดคำนำหน้า (เคสจริง: mtn_technicians ใส่ "นาย" แต่ profiles ไม่ใส่)', () => {
  assert.equal(normPersonName('นายณัฐพงศ์  เฟื่องสวัสดิ์'), 'ณัฐพงศ์ เฟื่องสวัสดิ์')
  assert.equal(normPersonName('นางสาวกัญญารัตน์'), 'กัญญารัตน์')
  assert.equal(normPersonName('น.ส. วรดา ขอกลาง'), 'วรดา ขอกลาง')
  assert.equal(normPersonName('Mr. John Smith'), 'John Smith')
})

test('normPersonName — ตัด zero-width ที่ติดมาจากการก๊อปจาก Excel', () => {
  assert.equal(normPersonName('​กรกฎ แสงอาวุธ﻿'), 'กรกฎ แสงอาวุธ')
})

test('normPersonName — รับค่าว่าง/null ได้ ไม่ throw', () => {
  assert.equal(normPersonName(null), '')
  assert.equal(normPersonName(undefined), '')
  assert.equal(normPersonName('   '), '')
})

test('🔴 normPersonName ต้อง "ไม่" แก้สะกดผิดให้ — การรวมคนเป็นการตัดสินใจของคน', () => {
  // เคสจริง: ทะเบียนช่างพิมพ์ "จำปาต้น" แต่ profiles คือ "จำปาต้า"
  assert.notEqual(normPersonName('นายอภิสิทธิ์ จำปาต้น'), normPersonName('อภิสิทธิ์ จำปาต้า'))
  // เคสจริง: ถ vs ฐ
  assert.notEqual(normPersonName('นายณัฐภัทร  ถานันต๊ะ'), normPersonName('ณัฐภัทร ฐานันต๊ะ'))
  // เคสจริง: พันแก่น vs พันธ์แก่น
  assert.notEqual(normPersonName('ทินวัฒน์ พันแก่น'), normPersonName('ทินวัฒน์ พันธ์แก่น'))
})

test('personKey — uid ชนะชื่อเสมอ (ชื่อสะกดต่างแต่ uid เดียวกัน = คนเดียวกัน)', () => {
  const uid = '7bb96db8-d5f8-4c95-a33c-ef6f6f0c35c2'
  assert.equal(personKey(uid, 'ณัฐพล สีพิมพ์ขัด'), personKey(uid, 'ณัฐพล สีพิมขัด'))
  assert.equal(personKey(uid, null), `u:${uid}`)
})

test('personKey — ไม่มี uid ก็ยังจับคู่ชื่อที่ต่างเชิงกลไกได้', () => {
  assert.equal(personKey(null, 'นายณัฐพงศ์  เฟื่องสวัสดิ์'), personKey(null, 'ณัฐพงศ์ เฟื่องสวัสดิ์'))
})

test('personKey — ไม่มีทั้ง uid และชื่อ → คืนค่าว่าง (ผู้เรียกต้องตัดทิ้ง ห้ามนับเป็นคน)', () => {
  assert.equal(personKey(null, null), '')
  assert.equal(personKey('', '  '), '')
})

test('samePerson', () => {
  assert.equal(samePerson({ uid: 'a' }, { uid: 'a' }), true)
  assert.equal(samePerson({ name: 'นายสมชาย ใจดี' }, { name: 'สมชาย  ใจดี' }), true)
  assert.equal(samePerson({ name: '' }, { name: '' }), false)   // ว่าง ≠ ว่าง
  assert.equal(samePerson({ uid: 'a' }, { uid: 'b' }), false)
})

test('countPeople — บอกได้ว่าส่วนไหนเชื่อถือได้ (byUid) ส่วนไหนเป็นค่าประมาณ (byName)', () => {
  const rows = [
    { uid: 'u1', name: 'ก ข' },
    { uid: 'u1', name: 'ก  ข' },        // คนเดิม (uid ซ้ำ)
    { uid: null, name: 'นายค ง' },
    { uid: null, name: 'ค ง' },          // คนเดิม (ชื่อ norm ตรงกัน)
    { uid: null, name: null },           // ไม่รู้ว่าใคร — ต้องไม่ถูกนับ
  ]
  const r = countPeople(rows, x => x.uid, x => x.name)
  assert.equal(r.people, 2)
  assert.equal(r.byUid, 1)
  assert.equal(r.byName, 1)
})

test('countPeople — รับ array ว่าง/undefined ได้', () => {
  assert.deepEqual(countPeople([], x => x.uid, x => x.name), { people: 0, byUid: 0, byName: 0 })
  assert.deepEqual(countPeople(undefined, x => x.uid, x => x.name), { people: 0, byUid: 0, byName: 0 })
})

test('setActor / getActor / actorFields', () => {
  setActor('uid-1', 'สมชาย ใจดี')
  assert.deepEqual(getActor(), { uid: 'uid-1', name: 'สมชาย ใจดี' })
  assert.deepEqual(actorFields(), { updated_by_name: 'สมชาย ใจดี', updated_by_uid: 'uid-1' })
  assert.deepEqual(actorFields('opened_by'), { opened_by_name: 'สมชาย ใจดี', opened_by_uid: 'uid-1' })
})

test('actorFields — ยังไม่ login คืน {} (ห้ามไปทับค่าเดิมในแถวด้วย null)', () => {
  setActor(null, null)
  assert.deepEqual(actorFields(), {})
  setActor('uid-2', null)
  assert.deepEqual(actorFields(), { updated_by_uid: 'uid-2' })   // มีแค่ uid ก็ stamp เท่าที่มี
  setActor(null, null)
})

test('getActor คืน object ใหม่ทุกครั้ง — แก้จากภายนอกไม่ได้', () => {
  setActor('uid-3', 'ทดสอบ')
  const a = getActor(); a.uid = 'HACKED'
  assert.equal(getActor().uid, 'uid-3')
  setActor(null, null)
})
