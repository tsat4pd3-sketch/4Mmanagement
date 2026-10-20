/* ── dedupeFetch — "คิวรีเดียวกันที่กำลังวิ่งอยู่ ให้รอคำตอบเดิม อย่ายิงใหม่" ──────────────
   (2026-10-13 · งานลด egress — ดู `docs/EGRESS-AUDIT-2026-09-17.md` §16)

   ═══ ที่มา: วัดจาก log จริง 13/10 ═══════════════════════════════════════════════
   คำขอ GET ที่ "เหมือนกันเป๊ะ (path+querystring) · เครื่องเดียวกัน · ภายใน 2 วินาที"
   มีถึง **70% ของคำขอทั้งหมด** บนตารางหลัก · แต่ตัวเลขที่ชี้ขาดคือ **ระยะห่าง**:

     production_plan_lots  median   3 ms   (p25 = 0)
     stock_inflow_rules    median   6 ms
     child_lot_requests    median  42 ms
     prod_orders           median  52 ms
     downtime_logs         median  61 ms
     production_sessions   median  77 ms

   ห่างกันไม่กี่มิลลิวินาที ⇒ **ไม่ใช่** realtime เด้งกลับ · **ไม่ใช่** poll · **ไม่ใช่** คนกดซ้ำ
   มันคือ **หลายแผง/หลาย effect บนหน้าเดียวกัน ต่างคนต่างยิงคิวรีชุดเดียวกันในเรนเดอร์รอบเดียว**
   (คลาสเดียวกับที่ `useProductionLines`/`masterCache` แก้ไปแล้วสำหรับ "ทะเบียน" — แต่ของสด
    cache ไม่ได้ เพราะจอจะโกหก ⇒ ต้องแก้ด้วยการ **ยุบคำขอที่ซ้อนเวลากัน** แทน)

   ═══ ทำไมแก้ที่ชั้น fetch ไม่ไล่แก้รายหน้า ═══════════════════════════════════════
   ไล่แก้ทีละหน้า = ต้องรู้ว่าแผงไหนซ้ำกับแผงไหน · พลาดได้ · และ**หน้าใหม่จะสร้างปัญหาเดิมซ้ำ**
   ชั้นนี้ครอบทุกหน้า/ทุกตาราง/ทุก client ในทีเดียว และหน้าใหม่ได้ผลฟรีโดยไม่ต้องรู้เรื่องนี้เลย

   ═══ กติกา (ห้ามลัด) ══════════════════════════════════════════════════════════
   1. **GET บน `/rest/v1/` เท่านั้น** — write ห้ามยุบเด็ดขาด (2 คนกดบันทึก = ต้องเขียน 2 ครั้ง)
      · storage/auth/functions ไม่แตะ (ไฟล์ใหญ่ · การ refresh token มีกลไกของตัวเอง)
   2. **คีย์ต้องรวมทุกอย่างที่เปลี่ยนคำตอบ** — url + Authorization + apikey + Range + Prefer
      + Accept-Profile · ขาดตัวใดตัวหนึ่ง = คนละคำขอถูกยุบเป็นอันเดียว = **ข้อมูลผิดแบบเงียบ**
   3. 🔴 **มี `signal` (ยกเลิกได้) = ไม่ยุบ** — ผู้เรียกคนหนึ่งยกเลิก จะลากคนอื่นตายด้วย
   4. **ยุบเฉพาะ "ที่กำลังวิ่งอยู่" ไม่ใช่ cache** — settle เมื่อไหร่ลบคีย์ทันที
      ⇒ ไม่มีวันคืนข้อมูลเก่า · คิวรีถัดไปยิงจริงเสมอ (ของสดยังสดเท่าเดิม)
   5. **อ่าน body ครั้งเดียวแล้วสร้าง Response ใหม่ให้ทุกคน** — ห้ามส่ง Response ตัวเดียวกันออกไป
      (body อ่านได้ครั้งเดียว · คนที่สองจะได้ stream เปล่า) และห้ามพึ่ง `.clone()`
      (tee stream ที่ไม่มีใครอ่านฝั่งต้นทางจะค้างบัฟเฟอร์)                                      */

/** สถานะที่ห้ามมี body ตามสเปค Response (ใส่ไปจะ throw) */
const NO_BODY = new Set([204, 205, 304]);

/** header ที่ "เปลี่ยนคำตอบ" — ต้องอยู่ในคีย์ทั้งหมด */
const KEY_HEADERS = ['authorization', 'apikey', 'range', 'prefer', 'accept-profile', 'accept'];

const headerOf = (init, input) => {
  try {
    return new Headers(init?.headers ?? (typeof input === 'object' && input ? input.headers : undefined));
  } catch { return new Headers(); }
};

/**
 * ห่อ fetch ให้ยุบคำขอ GET ที่เหมือนกันและกำลังวิ่งพร้อมกัน
 * @param {Function} baseFetch ตัว fetch จริง (ฉีดได้เพื่อให้เทสได้)
 * @param {object}   [o]
 * @param {Function} [o.onDedupe] เรียกเมื่อยุบได้ 1 ครั้ง (ไว้นับ/ดีบัก)
 */
export function makeDedupeFetch(baseFetch, { onDedupe } = {}) {
  const inflight = new Map();   // key → Promise<{body,status,statusText,headers}>

  const run = (input, init) => {
    const p = Promise.resolve(baseFetch(input, init)).then(async (res) => ({
      body: NO_BODY.has(res.status) ? null : await res.text(),
      status: res.status,
      statusText: res.statusText,
      headers: [...res.headers.entries()],
    }));
    return p;
  };

  const revive = (s) => new Response(s.body, { status: s.status, statusText: s.statusText, headers: s.headers });

  return function dedupedFetch(input, init) {
    const req = typeof input === 'object' && input ? input : null;   // Request object (ถ้าผู้เรียกส่งมาแบบนั้น)
    const url = req ? (req.url ?? String(input)) : String(input);
    /* 🔴 ห้ามเขียน `init?.method ?? (typeof input === 'object' && input?.method) ?? 'GET'`
       — `&&` คืน **false** เมื่อ input เป็นสตริง และ `??` ไม่ข้าม false ให้
       ⇒ method = "FALSE" ⇒ ไม่เข้าเงื่อนไข GET ⇒ **ตัวยุบไม่ทำงานเลยแบบเงียบ** (เทสจับได้ 13/10) */
    const method = String(init?.method ?? req?.method ?? 'GET').toUpperCase();

    // กฎ 1 + 3 — นอกขอบเขตนี้ส่งต่อตรงๆ ไม่แตะอะไรเลย
    if (method !== 'GET' || !url.includes('/rest/v1/') || init?.signal) return baseFetch(input, init);

    const h = headerOf(init, input);
    const key = url + '\u0000' + KEY_HEADERS.map(k => h.get(k) || '').join('\u0000');   // กฎ 2

    const hit = inflight.get(key);
    if (hit) {
      try { onDedupe?.(url); } catch { /* ตัวนับพังห้ามลาม */ }
      return hit.then(revive);
    }

    const p = run(input, init);
    inflight.set(key, p);
    // กฎ 4 — settle แล้วลบทันที (ทั้งสำเร็จและล้มเหลว) · ล้มเหลวต้องไม่ถูกจำไว้ให้คนถัดไป
    const clear = () => { if (inflight.get(key) === p) inflight.delete(key); };
    p.then(clear, clear);
    return p.then(revive);
  };
}

export default makeDedupeFetch;
