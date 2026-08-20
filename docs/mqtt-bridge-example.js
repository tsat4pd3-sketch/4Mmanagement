#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   📡 MQTT Bridge (ตัวอย่างอ้างอิง) — อ่านค่ามิเตอร์จาก MQTT broker → ส่งเข้า ESM

   ⚠️ ไฟล์นี้ **ไม่ได้เป็นส่วนหนึ่งของเว็บแอป** — เป็นโปรแกรมแยกที่ต้องรันบน
      "เครื่องในโรงงาน" ที่มองเห็น MQTT broker ได้ (Raspberry Pi / mini PC / VM ก็ได้)
      แอปบนเบราว์เซอร์ต่อ broker ในโรงงานตรงไม่ได้ และ key ต้องไม่อยู่ในเบราว์เซอร์

   ใช้ยังไง:
     npm init -y && npm install mqtt
     export MQTT_URL=mqtt://192.168.1.50:1883
     export INGEST_URL=https://<DR-project>.supabase.co/functions/v1/ingest-energy
     export INGEST_SECRET=<ต้องตรงกับที่ตั้งใน edge function>
     node mqtt-bridge-example.js

   แบบเต็ม + เหตุผลของทุกข้อ: docs/ENERGY_MONITORING_DESIGN.md §14
   ═══════════════════════════════════════════════════════════════════════════ */

const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');

const MQTT_URL      = process.env.MQTT_URL || 'mqtt://localhost:1883';
const INGEST_URL    = process.env.INGEST_URL;
const INGEST_SECRET = process.env.INGEST_SECRET;
/* ⚠️⚠️ หัวใจของทั้งไฟล์: **สรุปเป็นช่วงก่อนส่ง ห้ามส่งทุก message**
   power meter publish ทุก 1-5 วินาที → 20 มิเตอร์ = 1.7 ล้าน message/วัน
   ยิงเข้าฐานตรงๆ = พื้นที่เต็มในไม่กี่สัปดาห์ (ดู §14.2)
   15 นาทีเป็นหน่วยที่ถูกต้องอยู่แล้ว เพราะ demand charge ของ TOU คิดจากค่าเฉลี่ย 15 นาที */
const FLUSH_MS      = Number(process.env.FLUSH_MS || 15 * 60 * 1000);
const TOPICS        = (process.env.TOPICS || 'plant/#').split(',');
const BUFFER_FILE   = path.join(__dirname, '.mqtt-bridge-buffer.json');

if (!INGEST_URL || !INGEST_SECRET) {
  console.error('ต้องตั้ง INGEST_URL และ INGEST_SECRET ก่อน'); process.exit(1);
}

/* สะสมค่าระหว่างรอบไว้ในหน่วยความจำ — 1 ช่องต่อ topic
   เก็บทั้ง last (ค่าล่าสุด) / max (ค่าสูงสุดในรอบ) / n (จำนวน sample)
   ⚠️ max สำคัญกับ kW — peak ที่โผล่แวบเดียวคือตัวที่ทำให้โดน demand charge
      ถ้าเก็บแต่ค่าเฉลี่ย จะมองไม่เห็น peak เลย */
const buf = new Map();

const onMessage = (topic, payloadBuf) => {
  const raw = payloadBuf.toString().trim();
  const b = buf.get(topic) || { topic, last: null, max: null, n: 0, sample: raw.slice(0, 200) };
  // ค่าตัวเลขล้วน → ใช้เลย · JSON → ส่ง raw ไปให้ฝั่ง server แกะตาม json_path ที่ตั้งไว้ในทะเบียน
  const num = Number(raw);
  if (Number.isFinite(num)) {
    b.last = num;
    b.max = b.max == null ? num : Math.max(b.max, num);
  } else {
    b.json = raw;      // เก็บ payload ดิบล่าสุด (server แกะด้วย json_path จากตาราง energy_meter_topics)
  }
  b.n++; b.sample = raw.slice(0, 200); b.at = new Date().toISOString();
  buf.set(topic, b);
};

/* ⚠️ เน็ตโรงงานหลุดเป็นเรื่องปกติ — ส่งไม่ได้ต้องเก็บลง disk แล้วส่งใหม่รอบหน้า ห้ามทิ้ง */
const loadBacklog = () => {
  try { return JSON.parse(fs.readFileSync(BUFFER_FILE, 'utf8')); } catch { return []; }
};
const saveBacklog = (arr) => {
  // กันไฟล์โตไม่จำกัดตอนเน็ตหลุดยาว — เก็บล่าสุดพอ (ของเก่ากว่านั้นได้จากบิลอยู่แล้ว)
  try { fs.writeFileSync(BUFFER_FILE, JSON.stringify(arr.slice(-2000))); } catch (e) { console.warn('saveBacklog:', e.message); }
};

const flush = async () => {
  const batch = [...buf.values()];
  buf.clear();
  const pending = [...loadBacklog(), ...batch];
  if (!pending.length) return;

  try {
    const res = await fetch(INGEST_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-secret': INGEST_SECRET },
      // bucket_at = เวลาปิดรอบ · ฝั่ง server ใช้ dedup (ยิงซ้ำได้ไม่พัง — idempotent)
      body: JSON.stringify({ bucket_at: new Date().toISOString(), readings: pending }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    saveBacklog([]);
    console.log(`[${new Date().toISOString()}] ส่งแล้ว ${pending.length} topic`);
  } catch (e) {
    // ⚠️ ห้ามทิ้งข้อมูลเมื่อส่งไม่สำเร็จ — เก็บไว้ส่งรอบหน้า
    saveBacklog(pending);
    console.warn(`ส่งไม่สำเร็จ (เก็บไว้ ${pending.length} รายการ):`, e.message);
  }
};

const client = mqtt.connect(MQTT_URL, { reconnectPeriod: 5000 });
client.on('connect', () => {
  console.log('ต่อ broker ได้แล้ว:', MQTT_URL);
  TOPICS.forEach(t => client.subscribe(t.trim(), err => {
    if (err) console.error('subscribe ไม่ได้:', t, err.message);
    else console.log('subscribe:', t.trim());
  }));
});
client.on('message', onMessage);
client.on('error', e => console.error('MQTT error:', e.message));
client.on('reconnect', () => console.log('กำลังต่อ broker ใหม่…'));

setInterval(flush, FLUSH_MS);
process.on('SIGINT', async () => { console.log('\nกำลังส่งค่าที่ค้าง…'); await flush(); process.exit(0); });

console.log(`bridge เริ่มทำงาน · สรุปและส่งทุก ${Math.round(FLUSH_MS / 60000)} นาที`);
