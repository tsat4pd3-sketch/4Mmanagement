import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveChannel, uniqueTopic } from '../liveChannel.js';

/* ── บั๊กจริงที่ user จับได้ (2026-08-26) ───────────────────────────────────────────
   "หน้า line management เปิดไปเปิดมา โชว์สกิลพนักงาน ซักพักหน่วงๆ ละค้างไปเลย"

   ต้นเหตุคือ 2 พฤติกรรมของ supabase-js ที่มาบรรจบกัน (ยืนยันจากซอร์สใน node_modules):
     • `client.channel(topic)` dedupe ตามชื่อ topic → เจอตัวเดิม = คืนตัวเดิม
     • `client.removeChannel(ch)` เป็น async — teardown (ถอดออกจาก client.channels)
       เกิดหลัง server ack ของ phx_leave เท่านั้น
   React cleanup ไม่ await → effect รอบใหม่ไปเจอ channel ตัวเก่าที่ยังไม่ถูกถอด แล้ว
   `.on()` push binding เพิ่มทับของเดิม (ไม่มี dedupe) → binding ทบทุกครั้งที่ effect re-run

   เทสนี้จำลอง client ตามพฤติกรรมจริงข้างบน แล้วยืนยันว่า liveChannel ตัดวงจรนั้น   */
function fakeClient() {
  const channels = [];
  return {
    channels,
    channel(topic) {
      const exists = channels.find(c => c.topic === topic);
      if (exists) return exists;                       // ← dedupe ตามชื่อ (พฤติกรรมจริงของ supabase-js)
      const ch = {
        topic, bindings: [], closed: false,
        on(...a) { this.bindings.push(a); return this; },   // ← push เสมอ ไม่มี dedupe
        subscribe() { return this; },
      };
      channels.push(ch);
      return ch;
    },
    // async: ยังไม่ถอดออกจาก channels จนกว่าจะ ack (จำลองด้วย microtask)
    async removeChannel(ch) {
      await Promise.resolve();
      const i = channels.indexOf(ch);
      if (i >= 0) channels.splice(i, 1);
      ch.closed = true;
    },
  };
}

test('ชื่อคงที่ = binding ทบทุกครั้งที่ effect re-run (พิสูจน์ว่าบั๊กมีจริง)', () => {
  const c = fakeClient();
  let ch = null;
  for (let i = 0; i < 5; i++) {                        // สลับไลน์ 5 ครั้ง (ไม่ await removeChannel)
    if (ch) c.removeChannel(ch);
    ch = c.channel('mgmt-dt-alarm').on('downtime_logs').on('production_sessions').subscribe();
  }
  assert.equal(c.channels.length, 1, 'ยังเป็น channel เดิมตัวเดียว');
  assert.equal(ch.bindings.length, 10, 'binding ทบเป็น 2×5 — DB event 1 ครั้งจะเรียก callback 10 ตัว');
});

test('liveChannel — สลับไลน์กี่ครั้ง binding ก็ไม่ทบ', () => {
  const c = fakeClient();
  let ch = null;
  for (let i = 0; i < 5; i++) {
    if (ch) c.removeChannel(ch);
    ch = liveChannel(c, 'mgmt-dt-alarm').on('downtime_logs').on('production_sessions').subscribe();
  }
  assert.equal(ch.bindings.length, 2, 'ทุกรอบได้ channel ใหม่ binding คงที่ 2 ตัวเสมอ');
});

test('liveChannel — ตัวเก่าถูกถอดออกจริงหลัง ack (ไม่สะสมใน client)', async () => {
  const c = fakeClient();
  let ch = null;
  for (let i = 0; i < 5; i++) {
    if (ch) c.removeChannel(ch);
    ch = liveChannel(c, 'mgmt-dt-alarm').on('downtime_logs').subscribe();
  }
  await Promise.resolve(); await Promise.resolve();    // ปล่อยให้ ack ที่ค้างอยู่ทำงานครบ
  assert.equal(c.channels.length, 1, 'เหลือ channel ที่ใช้งานอยู่ตัวเดียว');
  assert.equal(c.channels[0], ch);
  assert.equal(ch.closed, false, 'ตัวที่ใช้อยู่ต้องไม่ถูกปิด');
});

test('uniqueTopic — ยังอ่านออกว่ามาจากหน้าไหน และไม่ซ้ำกันเลย', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const t = uniqueTopic('mgmt-dt-alarm');
    assert.ok(t.startsWith('mgmt-dt-alarm-'), `topic ต้องขึ้นต้นด้วยชื่อเดิม: ${t}`);
    assert.ok(!seen.has(t), `topic ซ้ำ: ${t}`);
    seen.add(t);
  }
});
