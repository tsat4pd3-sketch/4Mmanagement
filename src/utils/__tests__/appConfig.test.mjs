/* เทส buildFnUrl — ตัวประกอบ URL ของ edge function (src/utils/appConfig.js)
 * ทำไมต้องล็อกไว้: หลังย้ายมา server บริษัท ค่า base URL จะถูกตั้งด้วยมือโดยไอที
 * ซึ่งมักติด `/` ท้ายมา — ถ้าไม่ตัดจะได้ `//functions/v1/…` แล้วแจ้งเตือนเงียบหายทั้งระบบ
 * (edge ตอบ 404 แต่ทุกจุดเป็น fire-and-forget = ไม่มีใครเห็น error) */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFnUrl } from '../appConfig.js'

test('ประกอบ URL ปกติได้ถูกต้อง', () => {
  assert.equal(buildFnUrl('https://abc.supabase.co', 'send-notification'),
               'https://abc.supabase.co/functions/v1/send-notification')
})

test('base มี / ท้าย ต้องไม่เกิด //', () => {
  assert.equal(buildFnUrl('https://abc.supabase.co/', 'send-push'),
               'https://abc.supabase.co/functions/v1/send-push')
  assert.equal(buildFnUrl('https://abc.supabase.co///', 'send-push'),
               'https://abc.supabase.co/functions/v1/send-push')
})

test('รองรับ server ภายในที่มี port/path (self-host)', () => {
  assert.equal(buildFnUrl('http://10.10.1.20:8000', 'create-user'),
               'http://10.10.1.20:8000/functions/v1/create-user')
})

test('base ว่าง/undefined ต้องไม่โยน (ป้ายเตือนบนจอเป็นตัวบอกแทน)', () => {
  assert.equal(buildFnUrl(undefined, 'x'), '/functions/v1/x')
  assert.equal(buildFnUrl('', 'x'), '/functions/v1/x')
})
