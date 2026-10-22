/* ══ connGuard — "503 แล้วต้องถอย" (เหตุการณ์จริง 21/10 · ทั้งโรงงานใช้ไม่ได้ 25 นาที) ══
   สิ่งที่ต้องไม่พังอีก: ยิงไม่ผ่านแล้วยังยิงต่อจังหวะเดิม จนฐานข้อมูลฟื้นตัวไม่ได้ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeConnGuard, CONN } from '../connGuard.js';

const URL_GET = 'https://x.supabase.co/rest/v1/prod_orders?select=id';
const res = (status) => new Response(status === 204 ? null : '[]', { status });

/** ตัวช่วย: นาฬิกาปลอม + สุ่มคงที่ (เทสต้องตรึงเวลาได้ — npm test มีรอบนาฬิกา +400 วัน) */
const harness = (statuses) => {
  let t = 1_000_000;
  let i = 0;
  const calls = [];
  const base = (input, init) => {
    calls.push({ url: String(input), method: init?.method || 'GET' });
    const s = statuses[Math.min(i++, statuses.length - 1)];
    if (s === 'throw') return Promise.reject(new Error('network'));
    return Promise.resolve(res(s));
  };
  const changes = [];
  const f = makeConnGuard(base, {
    now: () => t, random: () => 0.5, onChange: (s) => changes.push({ ...s }),
  });
  return { f, calls, changes, tick: (ms) => { t += ms; }, at: () => t };
};

test('ปกติ = ส่งต่อทุกคำขอ ไม่แตะอะไร', async () => {
  const h = harness([200, 200, 200]);
  for (let i = 0; i < 3; i++) await h.f(URL_GET);
  assert.equal(h.calls.length, 3);
  assert.equal(h.f.state().paused, false);
});

test('🔴 ล้มครั้งเดียว/สองครั้ง ยังไม่ตัด (503 เดี่ยวๆ เป็นเรื่องปกติ)', async () => {
  const h = harness([503, 503]);
  await h.f(URL_GET); await h.f(URL_GET);
  assert.equal(h.calls.length, 2);
  assert.equal(h.f.state().paused, false);
});

test('🔴 ล้มติดกันครบเกณฑ์ = พัก แล้วคำขอถัดไปไม่ออกเน็ตเลย', async () => {
  const h = harness([503]);
  for (let i = 0; i < CONN.TRIP_AFTER; i++) await h.f(URL_GET);
  assert.equal(h.calls.length, CONN.TRIP_AFTER);
  assert.equal(h.f.state().paused, true);

  const r = await h.f(URL_GET);
  assert.equal(h.calls.length, CONN.TRIP_AFTER, 'ต้องไม่ยิงเพิ่มระหว่างพัก');
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.code, 'ESM_CONN_PAUSED', 'ต้องตอบ error ที่จออ่านออก ห้ามค้างเงียบ');
});

test('🔴 การเขียนต้องผ่านเสมอ แม้กำลังพัก (คนกดบันทึก ≠ polling)', async () => {
  const h = harness([503]);
  for (let i = 0; i < CONN.TRIP_AFTER; i++) await h.f(URL_GET);
  const before = h.calls.length;
  await h.f(URL_GET, { method: 'POST', body: '{}' });
  await h.f(URL_GET, { method: 'PATCH', body: '{}' });
  assert.equal(h.calls.length, before + 2, 'POST/PATCH ต้องถูกส่งออกไปจริง');
});

test('คำขอนอก /rest/v1/ (auth/storage) ไม่ถูกตัด', async () => {
  const h = harness([503]);
  for (let i = 0; i < CONN.TRIP_AFTER; i++) await h.f(URL_GET);
  const before = h.calls.length;
  await h.f('https://x.supabase.co/storage/v1/object/pic.jpg');
  await h.f('https://x.supabase.co/auth/v1/token');
  assert.equal(h.calls.length, before + 2);
});

test('🔴 ครบเวลาแล้วปล่อยผ่าน "คำขอเดียว" ไปวัด (half-open) ที่เหลือยังรอ', async () => {
  /* ฐานที่ "ค้าง" ได้ — เพื่อจำลองว่า probe ยังไม่ได้คำตอบ แล้วมีคำขออื่นเข้ามาพอดี */
  let t = 0, hits = 0, release = null;
  const base = () => {
    hits++;
    if (hits <= CONN.TRIP_AFTER) return Promise.resolve(res(503));
    return new Promise(r => { release = () => r(res(200)); });   // probe ค้างไว้
  };
  const f = makeConnGuard(base, { now: () => t, random: () => 0.5 });
  for (let i = 0; i < CONN.TRIP_AFTER; i++) await f(URL_GET);
  assert.equal(f.state().paused, true);

  t = f.state().until + 1;                    // ครบเวลาพัก
  const probe = f(URL_GET);                   // ออกเน็ต 1 คำขอ (ค้างอยู่)
  assert.equal(hits, CONN.TRIP_AFTER + 1);

  const other = await f(URL_GET);             // ระหว่าง probe ยังไม่เสร็จ
  assert.equal(hits, CONN.TRIP_AFTER + 1, 'ต้องออกเน็ตแค่คำขอเดียว ห้ามปล่อยทั้งฝูง');
  assert.equal(other.status, 503);

  release();
  assert.equal((await probe).status, 200);
  assert.equal(f.state().paused, false);
});

test('probe สำเร็จ = กลับมาปกติทันที', async () => {
  const h = harness([503, 503, 503, 200, 200]);
  for (let i = 0; i < CONN.TRIP_AFTER; i++) await h.f(URL_GET);
  h.tick(CONN.MAX_MS + 1);
  const r = await h.f(URL_GET);                 // probe → 200
  assert.equal(r.status, 200);
  assert.equal(h.f.state().paused, false);
  const before = h.calls.length;
  await h.f(URL_GET);
  assert.equal(h.calls.length, before + 1, 'หลังฟื้นต้องยิงได้ตามปกติ');
});

test('probe ล้มอีก = ถ่างเวลาออก (ไม่ใช่ค่าเดิม)', async () => {
  const h = harness([503]);
  for (let i = 0; i < CONN.TRIP_AFTER; i++) await h.f(URL_GET);
  const first = h.f.state().until - h.at();
  h.tick(first + 1);
  await h.f(URL_GET);                            // probe → 503 อีก
  const second = h.f.state().until - h.at();
  assert.ok(second > first, `ต้องถ่างออก (${first} → ${second})`);
});

test('🔴 เวลาพักต้องสุ่ม — ไม่งั้นทุกเครื่องกลับมายิงวินาทีเดียวกัน = ตันซ้ำ', async () => {
  const mk = (rnd) => {
    let t = 0;
    const f = makeConnGuard(() => Promise.resolve(res(503)), { now: () => t, random: () => rnd });
    return (async () => {
      for (let i = 0; i < CONN.TRIP_AFTER; i++) await f(URL_GET);
      return f.state().until;
    })();
  };
  const [lo, hi] = await Promise.all([mk(0), mk(0.99)]);
  assert.ok(hi > lo * 1.5, `ช่วงสุ่มต้องกว้างพอ (${lo} vs ${hi})`);
});

test('เน็ตหลุด (throw) นับเป็นล้มด้วย และต้องโยนต่อ ไม่กลืน', async () => {
  const h = harness(['throw']);
  for (let i = 0; i < CONN.TRIP_AFTER; i++) {
    await assert.rejects(() => h.f(URL_GET));
  }
  assert.equal(h.f.state().paused, true);
});

test('ปุ่ม "ลองใหม่" ล้างการพักทันที', async () => {
  const h = harness([503, 503, 503, 200]);
  for (let i = 0; i < CONN.TRIP_AFTER; i++) await h.f(URL_GET);
  assert.equal(h.f.state().paused, true);
  h.f.retryNow();
  assert.equal(h.f.state().paused, false);
  const before = h.calls.length;
  await h.f(URL_GET);
  assert.equal(h.calls.length, before + 1);
});

test('404/400 (ข้อมูลผิด ไม่ใช่เซิร์ฟเวอร์ล้น) ไม่ทำให้ตัด', async () => {
  const h = harness([404, 400, 404, 400]);
  for (let i = 0; i < 4; i++) await h.f(URL_GET);
  assert.equal(h.f.state().paused, false);
  assert.equal(h.calls.length, 4);
});

test('สถานะถูกแจ้งออกไปให้จอ (onChange) เมื่อเริ่มพักและเมื่อฟื้น', async () => {
  const h = harness([503, 503, 503, 200]);
  for (let i = 0; i < CONN.TRIP_AFTER; i++) await h.f(URL_GET);
  assert.ok(h.changes.some(c => c.paused), 'ต้องแจ้งตอนเริ่มพัก');
  h.tick(CONN.MAX_MS + 1);
  await h.f(URL_GET);
  assert.ok(h.changes.at(-1).paused === false, 'ต้องแจ้งตอนฟื้น');
});
