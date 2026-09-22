/* เทส "ใบที่ค้างต้องดันใบต่อท้ายออกไป" — computeQueuedPositionsFull / projectedFinishMs
   ที่มา (user 2026-09-22 · ดูจอจริงแล้วทัก):
     "ตอนนี้มีดีเลย์ตั้งหลายใบ แต่ไม่สามารถประเมินได้ว่าใบสุดท้ายจะจบกี่โมง
      ที่จริงถ้าใบแรกแดง ควรจะยืดดันใบที่ต่อท้ายออกไป เพื่อให้เห็นว่าจะ recovery ยังไง"

   🔴 บั๊กเดิม: `queueEndMs = isLateDone ? occupiedEndMs : endMs`
      ใบ **ปิดช้า** ดันคิวต่อ แต่ใบ **ยังไม่ปิด+เลยกำหนด** เดินคิวจาก endMs (เวลาทฤษฎีในอดีต)
      ⇒ ดีเลย์ไม่ถูกส่งต่อ · ใบถัดไปวาดทับอยู่ในอดีต · ใบสุดท้ายยังจบที่เวลาทฤษฎี
      ⇒ บอร์ดตอบไม่ได้ว่า "จะไปจบกี่โมง"

   เทสชุดนี้ล็อกไว้ว่า **คิวต้องเดินด้วย occupiedEndMs เสมอ** และ "ใบปกติต้องไม่ขยับ"
   ⏱️ ตรึงเวลาเองทุกเคส ไม่มี Date.now() */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeQueuedPositionsFull as queue, projectedFinishMs } from '../heijunkaQueue.js';

const T0 = Date.parse('2026-09-22T01:00:00Z');        // 08:00 ไทย
const M = 60_000, H = 3_600_000;
const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);

/* ใบ 60 ชิ้น × CT 60 วิ = 60 นาที/ใบ */
const card = (id, startMs, o = {}) => ({
  id, mat_no: 'M1', line_name: 'L1', qty: 60, qty_actual: 0,
  orderStartMs: startMs, orderEndMs: startMs + 60 * M,
  isDone: false, isCarry: false, ...o,
});
/* คิวเลนเดียว รอบเดียว — แยกผลของ "การดัน" ออกจากกติการอบ 2 ชม. */
const run = (cards, nowMs) => queue(cards, {
  breaks: [], ctByMat: { M1: 60 }, nowMs,
  roundIndexOf: () => 0, roundStartOf: () => T0,
});
const byId = (items) => Object.fromEntries(items.map(i => [i.o.id, i]));

test('🔴 หัวใจ — ใบแรกค้างเลยกำหนด ต้องดันใบถัดไปไปเริ่มที่ "ตอนนี้"', () => {
  // ใบ a ควรจบ 09:00 แต่ตอนนี้ 11:00 ยังไม่ปิด → ใบ b ต้องเริ่ม 11:00 ไม่ใช่ 09:00
  const now = T0 + 3 * H;
  const r = byId(run([card('a', T0), card('b', T0 + 1 * H)], now));
  assert.equal(r.a.isDelayed, true);
  assert.equal(r.a.occupiedEndMs, now, 'หางแดงยืดถึงตอนนี้');
  assert.equal(r.b.startMs, now, 'ใบถัดไปต้องถูกดันมาเริ่มที่ "ตอนนี้"');
  assert.equal(r.b.endMs, now + 60 * M);
});

test('🔴 ใบสุดท้ายต้องจบที่เวลาที่ดันแล้ว — projectedFinishMs ตอบ "จะจบกี่โมง" ได้', () => {
  const now = T0 + 3 * H;                                    // 11:00
  const items = run([card('a', T0), card('b', T0 + 1 * H), card('c', T0 + 2 * H)], now);
  // a ค้างถึง 11:00 → b 11:00-12:00 → c 12:00-13:00
  assert.equal(hhmm(projectedFinishMs(items)), hhmm(now + 2 * H));
});

test('ใบที่ปิดแล้วไม่ถือเป็น "งานที่เหลือ" — ไม่ลากเวลาจบ', () => {
  const now = T0 + 3 * H;
  const done = card('done', T0, { isDone: true, status: 'confirmed', qty_ok: 60,
    confirmed_at: new Date(T0 + 90 * M).toISOString() });
  const items = run([done, card('b', T0 + 1 * H)], now);
  const fin = projectedFinishMs(items);
  assert.ok(fin >= now, 'เวลาจบมาจากใบ b ที่ยังค้าง');
  assert.equal(projectedFinishMs(run([done], now)), null, 'ไม่มีงานค้าง = ไม่มีเวลาจบให้ตอบ');
});

test('ไม่มีงานค้างเลย → null (ห้ามคืน 0 หรือเวลามั่ว)', () => {
  assert.equal(projectedFinishMs([]), null);
});

test('🔴 ใบปกติที่ยังไม่ถึงกำหนด ต้องไม่ถูกขยับ (พฤติกรรมเดิมเป๊ะ)', () => {
  // ตอนนี้ 08:30 — ใบ a ยังไม่เลยกำหนด (จบ 09:00)
  const now = T0 + 30 * M;
  const r = byId(run([card('a', T0), card('b', T0 + 1 * H)], now));
  assert.equal(r.a.isDelayed, false);
  assert.equal(r.a.occupiedEndMs, r.a.endMs, 'ยังไม่เลยกำหนด = ไม่มีหาง');
  assert.equal(r.b.startMs, T0 + 1 * H, 'ใบถัดไปอยู่ที่เวลาเปิดของตัวเองตามเดิม');
});

test('ใบปิดช้ายังดันคิวเหมือนเดิม (ของเดิมที่ทำงานอยู่แล้ว ห้ามพัง)', () => {
  const now = T0 + 5 * H;
  const late = card('late', T0, {
    isDone: true, status: 'confirmed', qty_ok: 60,
    confirmed_at: new Date(T0 + 2 * H).toISOString(),     // ควรจบ 09:00 ปิดจริง 10:00
  });
  const r = byId(run([late, card('b', T0 + 1 * H)], now));
  assert.equal(r.late.isLateDone, true);
  assert.equal(r.b.startMs, T0 + 2 * H, 'ใบถัดไปเริ่มที่เวลาปิดจริงของใบก่อนหน้า');
});

test('การ์ดห้ามซ้อนทับกันเอง — ใบถัดไปเริ่มไม่ก่อนหางของใบค้าง', () => {
  const now = T0 + 4 * H;
  const items = run([card('a', T0), card('b', T0 + 1 * H), card('c', T0 + 2 * H)], now);
  for (let i = 1; i < items.length; i++) {
    assert.ok(items[i].startMs >= items[i - 1].occupiedEndMs,
      `ใบที่ ${i + 1} เริ่มก่อนใบก่อนหน้าจะว่าง — การ์ดจะทับกันบนจอ`);
  }
});

test('ค้างหลายใบติดกัน — แดงเหลือใบเดียว ที่เหลือกลายเป็นคิวในอนาคต', () => {
  const now = T0 + 5 * H;
  const items = run([card('a', T0), card('b', T0 + 1 * H), card('c', T0 + 2 * H)], now);
  assert.equal(items.filter(i => i.isDelayed).length, 1,
    'ใบที่ "ค้างอยู่จริง" มีใบเดียว — ที่เหลือคือคิวที่ยังไม่ถึงตา ไม่ใช่ดีเลย์ซ้อนกัน');
  assert.equal(items[0].isDelayed, true);
});
