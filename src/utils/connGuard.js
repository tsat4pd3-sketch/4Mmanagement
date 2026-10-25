/* ── connGuard — "ฐานข้อมูลตอบ 503 แล้วต้องหยุดยิงชั่วคราว" (2026-10-21 · เหตุการณ์จริง) ────
   ═══ ที่มา: เหตุการณ์ 21/10 เวลา 20:20–20:44 (ทั้งโรงงานใช้งานไม่ได้ 25 นาที) ═══════
   เปลี่ยนกะ ⇒ จอ/คอม/มือถือกลับมาทำงานพร้อมกัน (เฉพาะเน็ตในโรงงาน IP เดียว 224 คำขอ/นาที)
   ⇒ ช่องต่อฐานข้อมูลของ Product DB เต็ม ⇒ PostgREST ตอบ **503 `PGRST003 Timed out
   acquiring connection from connection pool`** ทุกคำขอ (วัดได้ 9,441 ครั้งใน 30 นาที)

   🔴 **ตัวที่ทำให้ลากยาว 25 นาที ไม่ใช่การตันครั้งแรก แต่คือระบบซ้ำเติมตัวเอง:**
     · ยิงไม่ผ่าน แต่ทุกจอยังยิงต่อตามจังหวะเดิม **ไม่มีการถอย**
     · realtime หลุด → ต่อกลับ → **โหลดใหม่ทั้งชุด** → หลุดอีก วนไป
     · จอขึ้น "กำลังโหลด..." ค้างโดยไม่บอกว่าพัง → คนกดรีเฟรชซ้ำ = ยิงใหม่ทั้งหน้า
   ⇒ โหลดสูงสุดตกตอนที่ฐานข้อมูลอ่อนแรงที่สุดพอดี · ฟื้นเองไม่ได้จนคนเลิกกด

   ═══ กติกา (ห้ามลัด) ══════════════════════════════════════════════════════════
   1. 🔴 **ตัดเฉพาะ GET ของ `/rest/v1/` — การเขียนต้องผ่านเสมอ**
      คนกดบันทึกคือเจตนาของมนุษย์ ไม่ใช่ polling · บล็อกไว้ = งานหาย/คนไม่รู้ว่าสำเร็จไหม
      (ตัวที่ถล่มฐานข้อมูลคือ GET ของจอทั้งหมดอยู่แล้ว ตัดแค่นั้นก็พอ)
   2. 🔴 **ตัดแล้วต้องตอบกลับเป็น error ที่จออ่านออก ห้ามค้างเงียบ** — คืน 503 + body แบบ
      PostgREST ⇒ supabase-js คืน `{ data: null, error }` ตามปกติ ⇒ `checkWrite`/`loadFail`
      ของทุกหน้าทำงานเหมือนเดิม และแถบเตือนบนจอขึ้นให้คนเห็น (`<ConnBanner>` ใน App.jsx)
   3. **ล้มครั้งเดียวไม่ตัด** — ต้องล้มติดกัน `TRIP_AFTER` ครั้ง (503 เดี่ยวๆ เป็นเรื่องปกติ)
   4. **เปิดช่องให้ลองทีละ 1 คำขอ (half-open)** — ครบเวลาแล้วปล่อยผ่าน **คำขอเดียว** ไปวัด
      ถ้ารอด = คืนปกติทันที · ถ้าล้มอีก = ถ่างเวลาออก (ห้ามปล่อยทั้งฝูงไปพร้อมกัน = ตันซ้ำ)
   5. 🔴 **ต้องสุ่มเวลา (jitter)** — 40 เครื่องนับถอยหลังพร้อมกัน แล้วกลับมายิงวินาทีเดียวกัน
      = ตันซ้ำทันที · สุ่ม ±50% ให้กระจาย
   6. 🔴 **`now`/`random` ฉีดได้** (เทสตรึงค่าได้ · `npm test` มีรอบ "นาฬิกา +400 วัน")      */

export const CONN = {
  /** สถานะที่แปลว่า "ฝั่งเซิร์ฟเวอร์รับไม่ไหว" — ไม่ใช่ข้อมูลผิด */
  BUSY: new Set([429, 502, 503, 504]),
  /** ล้มติดกันกี่ครั้งถึงตัด */
  TRIP_AFTER: 3,
  /** พักครั้งแรกกี่ ms แล้วถ่างเป็น ×2 ไปเรื่อยๆ จนชน MAX */
  BASE_MS: 10_000,
  MAX_MS: 120_000,
  /** 🔴 นับ "ล้มติดกัน" เฉพาะที่เกิดใกล้กัน — ห่างเกินนี้ถือว่าคนละเรื่อง เริ่มนับใหม่
      (503 เดี่ยวๆ ตอนเช้า + ตอนบ่าย + ตอนเย็น ไม่ใช่ "ฐานข้อมูลรับไม่ไหว") */
  WINDOW_MS: 30_000,
  /** 🔴 กันคำขอทดลอง (probe) ค้าง — ถ้าไม่ได้คำตอบในเวลานี้ ปล่อยให้ตัวอื่นลองได้
      ไม่งั้น probe ที่ไม่มีวัน settle = ทุกคำขอถูกตัดถาวรจนกว่าจะรีเฟรชหน้า */
  PROBE_MAX_MS: 15_000,
};

const OFFLINE_BODY = JSON.stringify({
  code: 'ESM_CONN_PAUSED',
  message: 'หยุดยิงชั่วคราว — เชื่อมต่อฐานข้อมูลไม่ได้',
  details: 'ฐานข้อมูลตอบว่ารับไม่ไหว (503) ระบบพักการเรียกข้อมูลไว้ชั่วคราวเพื่อให้ฟื้นตัว',
  hint: null,
});

const offlineRes = () => new Response(OFFLINE_BODY, {
  status: 503, statusText: 'Service Unavailable',
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

/**
 * ห่อ fetch ให้ "ถอย" เมื่อฐานข้อมูลตอบว่ารับไม่ไหว
 * @param {Function} baseFetch fetch จริง (หรือ dedupeFetch)
 * @param {object} [o]
 * @param {Function} [o.now] คืนเวลาปัจจุบัน (ms) — ฉีดเพื่อเทส
 * @param {Function} [o.random] คืน 0..1 — ฉีดเพื่อเทส
 * @param {Function} [o.onChange] เรียกเมื่อสถานะเปลี่ยน ({ paused, until, failures })
 */
export function makeConnGuard(baseFetch, { now = Date.now, random = Math.random, onChange } = {}) {
  let failures = 0;      // ล้มติดกันกี่ครั้ง
  let lastFailAt = 0;    // ล้มครั้งล่าสุดเมื่อไหร่ (ใช้ตัดสินว่า "ติดกัน" จริงไหม)
  let until = 0;         // พักถึงเมื่อไหร่ (0 = ไม่ได้พัก)
  let probing = false;   // มีคำขอทดลองวิ่งอยู่ไหม
  let probeAt = 0;       // ออกไปเมื่อไหร่ (คู่กับ probing — ห้ามตัดสินจาก probeAt ลอยๆ now() = 0 ได้)
  let step = 0;          // ถ่างมาแล้วกี่ครั้ง

  const emit = () => { try { onChange?.(state()); } catch { /* ตัวแจ้งพังห้ามลาม */ } };
  const state = () => ({ paused: until > now(), until, failures });

  const trip = () => {
    const base = Math.min(CONN.BASE_MS * (2 ** step), CONN.MAX_MS);
    // กฎ 5 — สุ่ม ±50% กันทุกเครื่องกลับมาพร้อมกัน
    until = now() + Math.round(base * (0.5 + random()));
    step++;
    emit();
  };

  const ok = () => {
    const was = until > 0 || failures > 0;
    failures = 0; lastFailAt = 0; until = 0; step = 0;
    if (was) emit();
  };

  const bad = () => {
    const t = now();
    // กฎ 3 — ล้มที่ห่างกันเกิน WINDOW = คนละเรื่อง เริ่มนับใหม่ (ไม่สะสมข้ามวัน)
    failures = (failures > 0 && t - lastFailAt <= CONN.WINDOW_MS) ? failures + 1 : 1;
    lastFailAt = t;
    if (failures >= CONN.TRIP_AFTER) trip();
    else emit();
  };

  /** ผลลัพธ์ของคำขอจริง → อัปเดตสถานะ (ใช้กับทั้ง GET และการเขียน) */
  const observe = (res) => {
    if (res && CONN.BUSY.has(res.status)) bad();
    else if (res && res.status < 500) ok();
    return res;
  };

  const guarded = (input, init, isProbe) => {
    if (isProbe) { probing = true; probeAt = now(); }
    const done = () => { if (isProbe) { probing = false; probeAt = 0; } };
    return Promise.resolve(baseFetch(input, init)).then(
      (res) => { done(); return observe(res); },
      /* 🔴 **เน็ตหลุด/คำขอถูกยกเลิก ไม่นับเป็น "ฐานข้อมูลรับไม่ไหว"** (21/10 ปล่อยครั้งแรกนับ = ผิด)
         มือถือ/ไวไฟในโรงงานหลุดเป็นเรื่องปกติ — นับด้วยแล้วเครื่องนั้นจะตัดตัวเองทั้งที่ฐานข้อมูลปกติดี
         อาการที่เกิดจริง: จอค้างโหลดเฉพาะบางเครื่อง โดยฝั่งเซิร์ฟเวอร์ไม่มี error ให้เห็นเลย */
      (err) => { done(); throw err; },
    );
  };

  function guardedFetch(input, init) {
    const req = typeof input === 'object' && input ? input : null;
    const url = req ? (req.url ?? String(input)) : String(input);
    const method = String(init?.method ?? req?.method ?? 'GET').toUpperCase();

    // กฎ 1 — การเขียน / นอก /rest/ ผ่านเสมอ (แต่ยังดูผลเพื่ออัปเดตสถานะ)
    if (method !== 'GET' || !url.includes('/rest/v1/')) return guarded(input, init, false);

    const t = now();
    if (until > t) return Promise.resolve(offlineRes());        // พักอยู่ = ไม่ยิงเลย
    if (until > 0) {
      // กฎ 4 — ครบเวลาแล้ว: ปล่อยผ่านคำขอเดียวไปวัด ที่เหลือรอต่อ
      // 🔴 probe ที่ค้างเกิน PROBE_MAX_MS ถือว่าเจ๊ง ปล่อยให้ตัวถัดไปลองแทน
      //    (ไม่งั้น probe ที่ไม่มีวัน settle = ตัดทุกคำขอถาวรจนกว่าจะรีเฟรชหน้า)
      if (probing && t - probeAt <= CONN.PROBE_MAX_MS) return Promise.resolve(offlineRes());
      return guarded(input, init, true);
    }
    return guarded(input, init, false);
  }

  guardedFetch.state = state;
  /** คนกดปุ่ม "ลองใหม่" — ล้างการพักทันที (ไม่รีเซ็ต step กันคนกดรัวแล้วถล่มซ้ำ) */
  guardedFetch.retryNow = () => { until = 0; failures = 0; lastFailAt = 0; probing = false; probeAt = 0; emit(); };
  return guardedFetch;
}

/* ── ตัวจริงที่แอปใช้ (ตัวเดียวร่วมกันทั้ง 2 client) ───────────────────────────────
   🔴 ต้องเป็นตัวเดียวกัน — Main ล่มแต่ DR ไม่ล่ม (หรือกลับกัน) ก็ยังมีสถานะเดียวให้จอเขียน
      และการพักของฝั่งหนึ่งไม่ควรปิดอีกฝั่งเงียบๆ ⇒ สถานะเป็น "ของการเชื่อมต่อโดยรวม" */
const listeners = new Set();
let shared = null;

export function connFetch(baseFetch) {
  if (!shared) {
    shared = makeConnGuard(baseFetch, {
      onChange: (s) => listeners.forEach(fn => { try { fn(s); } catch { /* ไม่ลาม */ } }),
    });
  }
  return shared;
}

/** จอเรียกเพื่อรู้ว่า "ตอนนี้พักอยู่ไหม" — คืนตัวถอนการติดตาม */
export function onConnChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const connState = () => (shared ? shared.state() : { paused: false, until: 0, failures: 0 });
export const connRetryNow = () => shared?.retryNow();

export default makeConnGuard;
