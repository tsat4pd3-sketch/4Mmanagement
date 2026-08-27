/* ── liveChannel — สร้าง Supabase realtime channel ที่ "ชื่อไม่ซ้ำกับตัวที่กำลังปิด" ──────────
   ใช้แทน `client.channel('ชื่อคงที่')` ทุกที่ที่ subscribe `postgres_changes`

   ⚠️⚠️ ทำไมต้องมี (พบ 2026-08-26 · feedback หน้างาน "หน้า line management เปิดไปเปิดมา
        โชว์สกิลพนักงาน ซักพักหน่วงๆ ละค้างไปเลย"):

   supabase-js มี 2 พฤติกรรมที่มาบรรจบกันแล้วกลายเป็นบั๊กสะสม
     1. `client.channel(topic)` **dedupe ตามชื่อ topic** — ถ้ามีตัวเดิมค้างอยู่ใน `client.channels`
        มันคืน **ตัวเดิม** ให้ ไม่ได้สร้างใหม่
     2. `client.removeChannel(ch)` เป็น **async** — `await ch.unsubscribe()` (รอ server ack ของ
        phx_leave ซึ่งกินเวลา 1 round trip หรือจนกว่าจะ timeout ~10 วิ) แล้ว**ค่อย** teardown()
        ซึ่งเป็นจังหวะที่ถูกถอดออกจาก `client.channels` จริงๆ

   React cleanup ไม่ได้ await → ลำดับที่เกิดจริงเมื่อ effect re-run (เปลี่ยนไลน์/เปลี่ยนกะ/นำทางกลับเข้าหน้า):
     cleanup: removeChannel(ch)      ← ยิง phx_leave แล้วรอ ack (ยังอยู่ใน client.channels)
     effect : channel('ชื่อเดิม')      ← เจอตัวเก่า → **คืนตัวเก่าที่กำลังจะตาย**
              .on(...).on(...)       ← `_on` **push binding เพิ่มเสมอ ไม่มี dedupe**
              .subscribe()           ← ไม่ทำอะไร (re-join เฉพาะตอน channel closed)

   ผลคือ **binding ทบทุกครั้งที่ effect re-run**: สลับไลน์ N ครั้ง = N ชุด binding บน channel เดียว
   → DB event เข้ามา 1 ครั้ง เรียก callback N ตัว (คนละ closure คนละ debounce timer)
   → N query + N setState + N render ต่อ 1 เหตุการณ์ → หน่วงขึ้นเรื่อยๆ จนค้าง
   และ closure เก่ายังถือ scope เดิม (ชื่อไลน์เก่า) → เขียนทับ state ของไลน์ที่กำลังดูอยู่ด้วย

   ⚠️ กฎเหล็ก: **ห้ามเรียก `client.channel('ชื่อคงที่')` กับ postgres_changes อีก** ให้ผ่าน liveChannel เสมอ
   ⚠️ ข้อยกเว้น: **broadcast/presence ห้ามใช้ตัวนี้** — topic คือ "ห้อง" ที่ 2 ฝั่งต้องตรงกัน
      (รีโมทจอ `esm-remote-<code>` ใน RemoteReceiver/RemoteControl) เปลี่ยนชื่อ = คุยกันไม่รู้เรื่อง
   ส่วน postgres_changes ชื่อ topic เป็นแค่ตัวระบุฝั่ง client (ตัวกรองตาราง/เงื่อนไขส่งไปใน payload
   ตอน join) → ตั้งไม่ซ้ำได้ปลอดภัย                                                          */

let seq = 0;

/** ชื่อ topic ที่ไม่มีทางชนกับตัวที่ค้างอยู่ (ไว้เทส/ใช้กรณีต้องการชื่อล้วน) */
export function uniqueTopic(name) {
  seq += 1;
  return `${name}-${seq.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * @param {object} client   supabase / supabaseDR
 * @param {string} name     ชื่อสื่อความหมาย (ยังเห็นใน devtools เพราะเป็น prefix ของ topic)
 * @param {object} [params] config เดิมของ client.channel (ไม่ค่อยได้ใช้กับ postgres_changes)
 */
export function liveChannel(client, name, params) {
  const topic = uniqueTopic(name);
  return params ? client.channel(topic, params) : client.channel(topic);
}

export default liveChannel;
