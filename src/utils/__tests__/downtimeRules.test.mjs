/* กฎ Andon / "หยุดมาแล้วกี่นาที" — ล็อกไว้กัน regress (2026-08-26)
   ที่มา: จอ 3 ตัวเคยตอบคนละเลข (ผังรวม 52 น. · Dashboard 194 นาที · จอห้องช่าง 3 ชม. 14 น.)
          และไซเรนผูกกับธง `open_alerted_at` ซึ่ง edge stamp ให้เฉพาะตอนแจ้ง Telegram สำเร็จ
          ⇒ Telegram ล่ม = ไซเรนไม่เคยดัง + จอห้องช่างอ่าน 3 ชม. เป็น "เพิ่งหยุด"                */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isOpenDT, isPlannedDT, isAlarmingDT, dtElapsedMin, fmtDtElapsed,
  isOverDtThreshold, DT_OPEN_ALERT_MIN_DEFAULT,
} from '../downtimeRules.js';

const NOW = Date.parse('2026-08-26T10:00:00+07:00');
const startedMinAgo = (m, extra = {}) => ({ started_at: new Date(NOW - m * 60000).toISOString(), ...extra });

test('เปิดค้าง = ไม่มีทั้งเวลาจบและจำนวนนาที', () => {
  assert.equal(isOpenDT(startedMinAgo(10)), true);
  assert.equal(isOpenDT(startedMinAgo(10, { ended_at: '2026-08-26T09:30:00Z' })), false);
  assert.equal(isOpenDT(startedMinAgo(10, { duration_min: 20 })), false);
});

test('หยุดตามแผนไม่ Andon แดง (แต่ยัง "เปิดค้าง")', () => {
  const planned = startedMinAgo(300, { dr_downtime_types: { category: 'planned' } });
  assert.equal(isPlannedDT(planned), true);
  assert.equal(isOpenDT(planned), true);
  assert.equal(isAlarmingDT(planned), false, 'planned ห้ามเข้า Andon แดง/ไซเรน');
});

test('ไม่มี join ประเภทมาด้วย = ถือว่านอกแผนไว้ก่อน (fail-safe)', () => {
  assert.equal(isAlarmingDT(startedMinAgo(30)), true);
});

test('🔴 "เกินเกณฑ์" ตัดสินจากเวลาที่ผ่านไปจริง ไม่ใช่ธง open_alerted_at', () => {
  // เคสจริงที่ทำให้ต้องแก้: หยุดมา 194 นาที แต่ Telegram ยิงไม่สำเร็จ → ธงว่าง
  const noFlag = startedMinAgo(194);
  assert.equal(noFlag.open_alerted_at, undefined);
  assert.equal(isOverDtThreshold(noFlag, DT_OPEN_ALERT_MIN_DEFAULT, NOW), true,
    'Telegram ล่มต้องไม่ทำให้ไซเรนบนจอเงียบ');
  assert.equal(isOverDtThreshold(startedMinAgo(14), 15, NOW), false);
  assert.equal(isOverDtThreshold(startedMinAgo(15), 15, NOW), true, 'ครบพอดี = เกินเกณฑ์แล้ว');
});

test('ไม่รู้เวลาเริ่ม = "ไม่รู้" ห้ามตีเป็น 0 และห้ามนับว่าเกินเกณฑ์', () => {
  const noStart = { duration_min: null, ended_at: null };
  assert.equal(dtElapsedMin(noStart, NOW), null);
  assert.equal(fmtDtElapsed(null), '—');
  assert.equal(isOverDtThreshold(noStart, 15, NOW), false);
});

test('รูปแบบเวลาเดียวกันทุกจอ', () => {
  assert.equal(fmtDtElapsed(0), '0 น.');
  assert.equal(fmtDtElapsed(52), '52 น.');
  assert.equal(fmtDtElapsed(60), '1 ชม. 0 น.');
  assert.equal(fmtDtElapsed(194), '3 ชม. 14 น.', 'เลขจากเคสจริงที่ 3 จอเคยตอบไม่ตรงกัน');
});

test('dtElapsedMin ใช้ created_at เมื่อไม่มี started_at', () => {
  assert.equal(dtElapsedMin({ created_at: new Date(NOW - 30 * 60000).toISOString() }, NOW), 30);
});
