/* ── liveRefresh — เพดานความถี่ของ "โหลดใหม่เพราะ realtime บอกว่ามีอะไรเปลี่ยน" ──────────
   (2026-09-15 · งานลด egress รอบ 4 — เตรียมรับจอ 10 จอ + แท็บเล็ต 10 + เฟส 2 อีก ~20)

   ═══ ปัญหาที่แก้ (วัดจาก log จริง 15/09 วันทำงาน 20 ชม.) ═════════════════════════
   จอที่มี realtime ทุกตัวเขียนแบบเดียวกันหมด: `debounce(reload, 1500)`
   **debounce ไม่ใช่เพดาน** — มันแค่ "รอให้เงียบ 1.5 วิ แล้วค่อยยิง"
   วันทำงานจริงมีคนบันทึกงานตลอด 20 ไลน์ ⇒ แทบไม่มีช่วงเงียบเกิน 1.5 วิเลย
   ⇒ จอโหลดใหม่ **ทุกครั้งที่ใครก็ตามในโรงงานแตะข้อมูล** ไม่มีขีดจำกัดบน

   วัดจริง: prod_orders 6,876 req · production_sessions 6,107 · downtime_logs 5,240
   ในวันเดียว — โดยที่ **poll ตั้งไว้ 15 นาทีแล้ว** ฉะนั้นเกือบทั้งหมดนี้มาจาก realtime
   FactoryMap โหลด 1 รอบ = 26 KB ⇒ จอเดียวกิน ~150 MB/วัน ⇒ **10 จอ = 1.5 GB/วัน**
   (โควต้า Free = 5 GB/**เดือน** — 3 วันก็หมดแล้ว)

   ⚠️ นี่คือจุดที่พลาดมาตลอด: เราไปยืด "รอบ poll" (ซึ่งมีเพดานอยู่แล้ว)
      แต่ตัวที่ยิงจริงคือ realtime ซึ่ง **ไม่เคยมีเพดาน** — ยิ่งโรงงานยุ่ง ยิ่งกิน

   ═══ วิธีแก้: coalesce = "ยิงทันทีครั้งแรก แล้วล็อกเพดานไว้" ═══════════════════════
   · event แรก (หลังเงียบมานาน) → โหลดหลัง `settleMs` (ซับ burst ตอนสแกนรัวๆ)
   · event ที่มาระหว่างยังไม่ครบ `minGapMs` → **ยุบรวมเป็นรอบเดียว** ยิงตอนครบเพดานพอดี
   ⇒ ไม่ว่าโรงงานจะยุ่งแค่ไหน จอหนึ่งโหลดไม่เกิน 1 ครั้งต่อ minGapMs — คำนวณงบ egress ได้จริง
   ⇒ **ไม่มีอะไรเปลี่ยน = ไม่ยิงเลยสักครั้ง** (ต่างจาก poll ที่ยิงทุกรอบไม่ว่าจะมีอะไรใหม่ไหม)

   ═══ ทำไมยังทันงาน ═══════════════════════════════════════════════════════════
   · เหตุการณ์แรกยังเร็วเท่าเดิม (settle 600 ms) — Andon แดงทันทีเหมือนเดิม
   · ที่ช้าลงคือ "รอบที่ 2 ขึ้นไปในนาทีเดียวกัน" ซึ่งคนดูจอแยกไม่ออกอยู่แล้ว
   · การแจ้งเตือนจริง (Telegram/ไซเรน/Web Push) เป็นคนละกลไก ไม่ได้พึ่งรอบโหลดของจอ
     (edge `downtime-open-scan` pg_cron ทุก 5 นาที · เกณฑ์ downtime ค้าง = 15 นาที)

   ⚠️ ห้ามใส่ตัวเลข ms ดิบตอนเรียก — ใช้ `LIVE.*` จาก refreshRates.js เท่านั้น
      (บทเรียนเดียวกับ RATE: ตั้งกระจาย 14 จุดแล้วไม่มีใครรู้ว่ารวมแล้วกินเท่าไหร่)            */

/**
 * @param {Function} fn         ตัวโหลดข้อมูล (เรียกได้ทั้ง sync/async)
 * @param {number}   minGapMs   เพดาน: ห่างกันอย่างน้อยเท่านี้ระหว่าง 2 รอบโหลด
 * @param {number}   [settleMs] หน่วงสั้นๆ ซับ burst (สแกนบาร์โค้ดรัว) — default 600 ms
 * @returns {Function} trigger() — เรียกจาก handler ของ realtime · มี .cancel() ให้ใช้ใน cleanup
 */
export function coalesce(fn, minGapMs, settleMs = 600) {
  let timer = null;
  let lastRun = 0;

  const run = () => {
    timer = null;
    lastRun = Date.now();
    // fn อาจเป็น async — error ต้องไม่หลุดออกไปฆ่า handler ของ realtime ทั้งตัว
    try { Promise.resolve(fn()).catch(e => console.error('[liveRefresh]', e)); }
    catch (e) { console.error('[liveRefresh]', e); }
  };

  const trigger = () => {
    // มีรอบจ่อคิวอยู่แล้ว = event นี้ถูกยุบรวมเข้ารอบนั้น (รอบนั้นจะเห็นข้อมูลล่าสุดอยู่ดี)
    if (timer) return;
    const since = Date.now() - lastRun;
    timer = setTimeout(run, Math.max(settleMs, minGapMs - since));
  };

  trigger.cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  return trigger;
}

/* ── ตัวช่วยกรอง payload ของ realtime — "เรื่องนี้ไม่ใช่ของฉัน ไม่ต้องโหลด" ─────────────
   supabase ส่ง event ของ **ทั้งตาราง** มาให้ทุกเครื่องที่ subscribe
   ⇒ ไลน์ 61 ปิดใบ → เครื่องที่เปิดอยู่ไลน์อื่นทั้งโรงงานโหลดใหม่หมด (20 ไลน์ = เสียเปล่า 95%)
   ใช้คู่กับ coalesce: `.on(..., p => { if (isMine(p)) bump() })`
   (ถ้ากรองฝั่ง server ได้ด้วย `filter:` ให้ทำด้วย — ประหยัดกว่าเพราะ message ไม่ต้องส่งมาเลย) */
export const payloadField = (p, field) => p?.new?.[field] ?? p?.old?.[field];

export default coalesce;
