import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityOf, activitySummary, activitySummaryText, activityTone,
  DORMANT_DAYS, ACT_UNKNOWN, ACT_NEVER, ACT_DORMANT, ACT_ACTIVE,
} from '../accountActivity.js';

// ⏱️ ตรึงนาฬิกา — ด่าน "+400 วัน" ของ npm test ต้องผ่านด้วย
const NOW = Date.parse('2026-10-29T09:00:00+07:00');
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();

test('undefined = ยังไม่รู้ · null = ไม่เคยเข้า — ห้ามปนกัน', () => {
  assert.equal(activityOf(undefined, { now: NOW }).state, ACT_UNKNOWN);
  assert.equal(activityOf(null,      { now: NOW }).state, ACT_NEVER);
  // ข้อความต้องต่างกันด้วย ไม่ใช่แค่ state
  assert.notEqual(activityOf(undefined, { now: NOW }).text, activityOf(null, { now: NOW }).text);
});

test('แบ่งถัง active / dormant ที่เส้น DORMANT_DAYS', () => {
  assert.equal(activityOf(daysAgo(0),   { now: NOW }).state, ACT_ACTIVE);
  assert.equal(activityOf(daysAgo(89),  { now: NOW }).state, ACT_ACTIVE);
  assert.equal(activityOf(daysAgo(90),  { now: NOW }).state, ACT_DORMANT);
  assert.equal(activityOf(daysAgo(138), { now: NOW }).days,  138);
});

test('วันนี้ = "วันนี้" ไม่ใช่ "0 วันก่อน"', () => {
  assert.equal(activityOf(daysAgo(0), { now: NOW }).text, 'วันนี้');
  assert.equal(activityOf(daysAgo(3), { now: NOW }).text, '3 วันก่อน');
});

test('ค่าพังรูป / ไม่ส่ง now = unknown ห้ามเดาเป็น never', () => {
  assert.equal(activityOf('ไม่ใช่วันที่', { now: NOW }).state, ACT_UNKNOWN);
  assert.equal(activityOf(daysAgo(5)).state,                   ACT_UNKNOWN);
});

test('เวลาในอนาคต (นาฬิกาเครื่องเพี้ยน) = active ไม่ติดลบ', () => {
  const r = activityOf(new Date(NOW + 5 * 86400000).toISOString(), { now: NOW });
  assert.equal(r.state, ACT_ACTIVE);
  assert.equal(r.days, 0);
});

test('เกณฑ์ปรับได้ แต่ default = DORMANT_DAYS', () => {
  assert.equal(DORMANT_DAYS, 90);
  assert.equal(activityOf(daysAgo(40), { now: NOW, dormantDays: 30 }).state, ACT_DORMANT);
});

test('summary นับ unknown แยกจาก never', () => {
  const rows = [
    { last_sign_in_at: daysAgo(1) },
    { last_sign_in_at: daysAgo(200) },
    { last_sign_in_at: null },
    { last_sign_in_at: null },
    {},                                 // undefined = อ่านไม่ได้
  ];
  const s = activitySummary(rows, { now: NOW });
  assert.deepEqual(s, { total: 5, unknown: 1, never: 2, dormant: 1, active: 1 });
});

test('อ่านไม่ได้ทั้งลิสต์ = ห้ามสรุปว่า "ไม่มีบัญชีค้าง"', () => {
  const s = activitySummary([{}, {}, {}], { now: NOW });
  const txt = activitySummaryText(s);
  assert.match(txt, /อ่าน.*ไม่ได้/);
  assert.doesNotMatch(txt, /ไม่เคยเข้าใช้ 3/);
});

test('ไม่มีอะไรต้องเตือน = null (ลิสต์ว่างก็ null)', () => {
  assert.equal(activitySummaryText(activitySummary([{ last_sign_in_at: daysAgo(1) }], { now: NOW })), null);
  assert.equal(activitySummaryText(activitySummary([], { now: NOW })), null);
});

test('สีของ unknown ต้องไม่ใช่สีเตือน', () => {
  const warn = [activityTone(ACT_NEVER), activityTone(ACT_DORMANT)];
  assert.ok(!warn.includes(activityTone(ACT_UNKNOWN)));
  assert.equal(activityTone(ACT_UNKNOWN), 'var(--muted)');
});
