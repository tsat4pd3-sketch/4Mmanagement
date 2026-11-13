/* 🔕 ตั้งค่าแจ้งเตือนของฉัน — กฎของจอ (03/11) · ตัวกรองจริงอยู่ฝั่ง DB (notify_recipients) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { myNotifyRows, groupNotifyRows, mutedSetOf, muteSummary, notifyCategoryLabel } from '../notifyPrefs.js';

const RULES = [
  { event_key: 'downtime', label: 'เครื่องจักร Downtime', category: 'production', is_enabled: true, inapp_roles: ['mtn', 'leader'], can_mute: true },
  { event_key: 'store_abnormal', label: 'เฝ้าระวังสโตร์', category: 'logistic', is_enabled: true, inapp_roles: ['planner_store'], can_mute: true },
  { event_key: 'mtn_pr_waiting', label: 'ใบ MO รอเปิด PR', category: 'maintenance', is_enabled: true, inapp_roles: ['mtn'], can_mute: false },
  { event_key: 'mtn_closed', label: 'ปิด MO', category: 'maintenance', is_enabled: false, inapp_roles: ['mtn'], can_mute: true },
  { event_key: 'no_roles', label: 'ไม่มีผู้รับ', category: 'quality', is_enabled: true, inapp_roles: [], can_mute: true },
];

test('เห็นเฉพาะเรื่องที่ role ตัวเองอยู่ในผู้รับ และทะเบียนเปิดอยู่', () => {
  const rows = myNotifyRows(RULES, 'mtn');
  assert.deepEqual(rows.map(r => r.event_key), ['downtime', 'mtn_pr_waiting'],
    'ปิดทะเบียน (mtn_closed) และเรื่องที่ไม่มี role ผู้รับ ต้องไม่โผล่');
  assert.deepEqual(myNotifyRows(RULES, 'planner_store').map(r => r.event_key), ['store_abnormal']);
  assert.deepEqual(myNotifyRows(RULES, 'qa'), [], 'role ที่ไม่อยู่ในผู้รับเรื่องไหนเลย = ไม่มีสวิตช์ให้กด');
});

test('🔒 can_mute=false = ล็อก แต่ยังต้องโชว์ (ซ่อน = คนงงว่าทำไมยังมีแจ้งเตือน)', () => {
  const rows = myNotifyRows(RULES, 'mtn');
  const pr = rows.find(r => r.event_key === 'mtn_pr_waiting');
  assert.equal(pr.locked, true);
  assert.equal(rows.find(r => r.event_key === 'downtime').locked, false);
});

test('ยังไม่มีคอลัมน์ can_mute (undefined) = ปิดได้ตามเดิม ไม่ใช่ล็อก', () => {
  const rows = myNotifyRows([{ event_key: 'x', label: 'x', category: 'production', is_enabled: true, inapp_roles: ['mtn'] }], 'mtn');
  assert.equal(rows[0].locked, false);
});

test('จัดกลุ่มตามหมวด คงลำดับเดิมของทะเบียน', () => {
  const g = groupNotifyRows(myNotifyRows(RULES, 'mtn'));
  assert.deepEqual(g.map(x => x.category), ['production', 'maintenance']);
  assert.equal(g[0].label, '🏭 Production');
  assert.equal(notifyCategoryLabel('ไม่รู้จัก'), 'ไม่รู้จัก', 'หมวดที่ไม่มีในแผนที่ = ใช้ชื่อดิบ ห้ามหาย');
  assert.equal(notifyCategoryLabel(''), 'อื่นๆ');
});

test('ไม่มีแถว prefs = รับตามปกติ · สรุปนับเฉพาะเรื่องที่ปิดได้', () => {
  const rows = myNotifyRows(RULES, 'mtn');
  assert.equal(mutedSetOf([]).size, 0);
  assert.deepEqual(muteSummary(rows, mutedSetOf([])), { total: 1, muted: 0, locked: 1 });
  const muted = mutedSetOf([{ event_key: 'downtime', muted: true }, { event_key: 'store_abnormal', muted: false }]);
  assert.deepEqual([...muted], ['downtime'], 'muted=false ไม่นับว่าปิด');
  assert.deepEqual(muteSummary(rows, muted), { total: 1, muted: 1, locked: 1 });
});

test('🔴 แถว prefs ที่ค้างอยู่บนเรื่องที่ถูกล็อกทีหลัง ต้องไม่ถูกนับว่า "ปิดอยู่"', () => {
  // admin ติ๊กล็อกทีหลัง ⇒ ทะเบียนชนะค่าที่ user เคยตั้ง (ฝั่ง DB ก็ไม่กรองให้แล้ว)
  const rows = myNotifyRows(RULES, 'mtn');
  const muted = mutedSetOf([{ event_key: 'mtn_pr_waiting', muted: true }]);
  assert.deepEqual(muteSummary(rows, muted), { total: 1, muted: 0, locked: 1 });
});
