/* เทส dedupeFetch — ยุบคำขอ GET ที่ซ้อนเวลากัน (2026-10-13)

   ของแบบนี้ "พลาดแล้วเงียบ": ยุบผิดคู่ = จอได้ข้อมูลของคำขออื่นโดยไม่มี error ให้เห็น
   ⇒ ล็อกทุกกติกาในหัวไฟล์ dedupeFetch.js ไว้ที่นี่ ห้ามถอดข้อใดข้อหนึ่ง                      */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDedupeFetch } from '../dedupeFetch.js';

const REST = 'https://x.supabase.co/rest/v1/prod_orders?select=*';

/** fetch ปลอมที่หน่วงได้ + นับจำนวนครั้งที่ถูกเรียกจริง */
function fakeFetch({ delay = 0, body = '[{"id":1}]', status = 200, headers = {} } = {}) {
  const f = async () => {
    if (delay) await new Promise(r => setTimeout(r, delay));
    f.calls++;
    return new Response(status === 204 ? null : body, { status, headers });
  };
  f.calls = 0;
  return f;
}

test('GET เหมือนกันที่วิ่งพร้อมกัน = ยิงจริงครั้งเดียว · ทุกคนได้ข้อมูลครบ', async () => {
  const base = fakeFetch({ delay: 10 });
  const fx = makeDedupeFetch(base);
  const [a, b, c] = await Promise.all([fx(REST), fx(REST), fx(REST)]);
  assert.equal(base.calls, 1, 'ต้องยิง DB ครั้งเดียว');
  assert.deepEqual(await a.json(), [{ id: 1 }]);
  assert.deepEqual(await b.json(), [{ id: 1 }], 'คนที่ 2 ต้องอ่าน body ได้ (ห้ามส่ง Response ตัวเดียวกัน)');
  assert.deepEqual(await c.json(), [{ id: 1 }]);
});

test('🔴 ไม่ใช่ cache — รอบที่วิ่งเสร็จแล้ว คำขอถัดไปต้องยิงจริงใหม่', async () => {
  const base = fakeFetch();
  const fx = makeDedupeFetch(base);
  await fx(REST);
  await fx(REST);
  assert.equal(base.calls, 2, 'settle แล้วต้องลบคีย์ทิ้ง ไม่งั้นจอจะโชว์ของเก่า');
});

test('🔴 คนละ querystring = คนละคำขอ ห้ามยุบ', async () => {
  const base = fakeFetch({ delay: 5 });
  const fx = makeDedupeFetch(base);
  await Promise.all([fx(REST), fx(REST + '&line=eq.A')]);
  assert.equal(base.calls, 2);
});

test('🔴 header ที่เปลี่ยนคำตอบ = คนละคำขอ (Authorization · Range · Prefer · Accept-Profile)', async () => {
  for (const h of [
    { Authorization: 'Bearer A' },
    { Range: '0-99' },
    { Prefer: 'count=exact' },
    { 'Accept-Profile': 'other' },
  ]) {
    const base = fakeFetch({ delay: 5 });
    const fx = makeDedupeFetch(base);
    await Promise.all([fx(REST), fx(REST, { headers: h })]);
    assert.equal(base.calls, 2, `header ${Object.keys(h)[0]} ต่างกันแล้วยังถูกยุบ = ข้อมูลผิดแบบเงียบ`);
  }
});

test('🔴 write ห้ามยุบเด็ดขาด (2 คนกดบันทึก = ต้องเขียน 2 ครั้ง)', async () => {
  for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
    const base = fakeFetch({ delay: 5 });
    const fx = makeDedupeFetch(base);
    await Promise.all([fx(REST, { method }), fx(REST, { method })]);
    assert.equal(base.calls, 2, `${method} ถูกยุบ = ข้อมูลหาย`);
  }
});

test('🔴 มี signal (ยกเลิกได้) = ไม่ยุบ — คนหนึ่งยกเลิกห้ามลากคนอื่นตาย', async () => {
  const base = fakeFetch({ delay: 5 });
  const fx = makeDedupeFetch(base);
  const ac = new AbortController();
  await Promise.all([fx(REST), fx(REST, { signal: ac.signal })]);
  assert.equal(base.calls, 2);
});

test('นอก /rest/v1/ ไม่แตะ (storage · auth · functions)', async () => {
  for (const u of [
    'https://x.supabase.co/storage/v1/object/public/a.webp',
    'https://x.supabase.co/auth/v1/token?grant_type=refresh_token',
    'https://x.supabase.co/functions/v1/send-notification',
  ]) {
    const base = fakeFetch({ delay: 5 });
    const fx = makeDedupeFetch(base);
    await Promise.all([fx(u), fx(u)]);
    assert.equal(base.calls, 2, `${u} ถูกยุบ — นอกขอบเขตที่ตั้งใจ`);
  }
});

test('🔴 ล้มเหลวต้องไม่ถูกจำไว้ให้คนถัดไป', async () => {
  let n = 0;
  const base = async () => { n++; if (n === 1) throw new Error('network'); return new Response('[]'); };
  const fx = makeDedupeFetch(base);
  await assert.rejects(() => fx(REST), /network/);
  const ok = await fx(REST);
  assert.equal(ok.status, 200, 'รอบถัดไปต้องยิงใหม่ ไม่ติด error เดิมค้าง');
  assert.equal(n, 2);
});

test('ทุกคนได้ error เดียวกันเมื่อคำขอร่วมล้ม', async () => {
  const base = async () => { await new Promise(r => setTimeout(r, 5)); throw new Error('boom'); };
  const fx = makeDedupeFetch(base);
  const rs = await Promise.allSettled([fx(REST), fx(REST)]);
  assert.deepEqual(rs.map(r => r.status), ['rejected', 'rejected']);
});

test('สถานะที่ห้ามมี body (204) ต้องไม่ throw', async () => {
  const base = fakeFetch({ status: 204, delay: 5 });
  const fx = makeDedupeFetch(base);
  const [a, b] = await Promise.all([fx(REST), fx(REST)]);
  assert.equal(a.status, 204);
  assert.equal(b.status, 204);
});

test('header ของคำตอบถูกส่งต่อครบ (count มากับ content-range)', async () => {
  const base = fakeFetch({ delay: 5, headers: { 'content-range': '0-24/137' } });
  const fx = makeDedupeFetch(base);
  const [a, b] = await Promise.all([fx(REST), fx(REST)]);
  assert.equal(a.headers.get('content-range'), '0-24/137');
  assert.equal(b.headers.get('content-range'), '0-24/137', 'คนที่ 2 ต้องได้ header ครบด้วย ไม่งั้น count หาย');
});

test('onDedupe ถูกเรียกเฉพาะตอนยุบจริง', async () => {
  const base = fakeFetch({ delay: 5 });
  const hits = [];
  const fx = makeDedupeFetch(base, { onDedupe: (u) => hits.push(u) });
  await Promise.all([fx(REST), fx(REST), fx(REST)]);
  assert.equal(hits.length, 2, 'ยิงจริง 1 + ยุบ 2');
});
