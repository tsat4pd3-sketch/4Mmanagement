// Smart Logistic — scheduled scan for shipping walkback phase misses.
// Runs on the Product DB project via pg_cron (every 10 min). For each delivery
// slot in the current work day (08:00 → 08:00 Bangkok), walk the configured
// shipping_workflow_steps backward from the customer delivery time; if a
// phase deadline has passed and the order hasn't reached that phase's status,
// POST a grouped 'shipping_phase_alert' to the MAIN send-notification function
// (which owns the bot token + room routing). Deduped per (order, step) via
// shipping_phase_alerts so each miss fires exactly once.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const NOTIFY_URL = 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-notification';
const NOTIFY_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3aGRmcXdmd29maXZvanRzaXpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODA5NjYsImV4cCI6MjA5MjQ1Njk2Nn0.mGrLjRFmtNtpyAu3aBduKqixyb3AjQDCid06qpBzrxw';

const STATUS_RANK: Record<string, number> = { pending: 0, confirmed: 1, prepared: 2, loaded: 3, shipped: 4 };
const STATUS_LABEL: Record<string, string> = { pending: 'ยังไม่ยืนยันออเดอร์', confirmed: 'ยืนยันแล้ว·ยังไม่เตรียม', prepared: 'เตรียมแล้ว·ยังไม่โหลด', loaded: 'โหลดแล้ว·ยังไม่ส่ง', shipped: 'ส่งแล้ว' };

// Bangkok wall clock now + work-day frame (before 08:00 → previous day)
function bangkokNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  let h = +p.hour; if (h === 24) h = 0;
  return { y: +p.year, mo: +p.month, d: +p.day, h, mi: +p.minute };
}
const pad = (n: number) => String(n).padStart(2, '0');
function addDays(y: number, mo: number, d: number, n: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
// Bangkok date+time → UTC ms
const bkkMs = (dateStr: string, timeStr: string) => {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = timeStr.slice(0, 5).split(':').map(Number);
  return Date.UTC(y, mo - 1, d, h - 7, mi);
};

Deno.serve(async () => {
  try {
    const now = bangkokNow();
    const work = now.h < 8 ? addDays(now.y, now.mo, now.d, -1) : { y: now.y, mo: now.mo, d: now.d };
    const workDate = `${work.y}-${pad(work.mo)}-${pad(work.d)}`;
    const next = addDays(work.y, work.mo, work.d, 1);
    const nextDate = `${next.y}-${pad(next.mo)}-${pad(next.d)}`;
    const nowMs = Date.now();

    // รอบส่งของวันงานนี้ที่ยังไม่ปิดจบ (ส่งแล้ว = จบทุกเฟส)
    const [{ data: d1 }, { data: d2 }, { data: steps }, { data: plants }] = await Promise.all([
      db.from('customer_shipping_orders').select('*').eq('due_date', workDate).neq('status', 'shipped').not('ship_time', 'is', null),
      db.from('customer_shipping_orders').select('*').eq('due_date', nextDate).neq('status', 'shipped').not('ship_time', 'is', null).lt('ship_time', '08:00'),
      db.from('shipping_workflow_steps').select('*').eq('is_active', true).order('step_no'),
      db.from('ship_to_plants').select('code, customer_name'),
    ]);
    const orders = [
      ...(d1 ?? []).filter((o) => String(o.ship_time).slice(0, 5) >= '08:00'),
      ...(d2 ?? []),
    ];
    if (!orders.length || !steps?.length) return new Response(JSON.stringify({ ok: true, checked: 0 }), { status: 200 });

    const custName = new Map<string, string>();
    for (const p of plants ?? []) custName.set(String(p.code), String(p.customer_name || p.code));
    const stepsFor = (customer: string | null) => {
      const own = (steps ?? []).filter((s) => s.customer === customer);
      return own.length ? own : (steps ?? []).filter((s) => s.customer == null);
    };

    /* ⚠️ เฟสกลาง (ยืนยัน/เตรียม/โหลด) จะเตือนได้ก็ต่อเมื่อ "มีคนใช้จริง"
       ข้อมูลจริง 2026-08-24: customer_shipping_orders มีแค่ pending 434 / shipped 38
       — ไม่มีใบไหนอยู่สถานะกลางเลยสักใบ (ทีมกดจาก pending ไป "ส่งแล้ว" ตรงๆ)
       ⇒ ทุกใบที่ยัง pending ทริกครบทุกเฟส = 66–224 แจ้งเตือน/วัน เข้าห้องเดียวกับเรื่องที่ต้องอ่านจริง
         (และตั้งแต่ 21/8 ที่เปิด inapp_roles ให้หมวด logistic ก็ไปเด้งกระดิ่ง + Web Push ด้วย)
       → ถ้า 30 วันล่าสุด "ไม่มีใบไหนอยู่สถานะกลางเลย" = ยังไม่ได้ใช้ walkback → ข้ามเฟสกลาง
         เตือนเฉพาะเฟสสุดท้าย (ต้องส่งถึงลูกค้า) ซึ่งทีมทำจริง
       ⚠️ self-healing: วันไหนเริ่มกดยืนยัน/เตรียม/โหลด เฟสนั้นกลับมาเตือนเองทันที ไม่ต้องแก้โค้ด
       ⚠️ ห้ามข้ามเงียบ — คืนจำนวนที่ข้ามใน response เสมอ

       🔴 บทเรียน 2026-08-31 — เกณฑ์เดิม `.some()` = "มีสักใบอยู่สถานะกลาง" → ใบเดียวพลิกทั้งโรงงาน
         เกิดจริง: 24/8 (วันเดียวกับที่ deploy ตัวกันสแปมนี้) มีคนกด "โหลดขึ้นรถ" 2 ใบแล้วทิ้งค้าง
         → workflowLive = true ตั้งแต่วันแรก → ใบ pending อีก 736 ใบยิงครบทุกเฟส
         = 325–572 แจ้งเตือน/วัน (เด้งทุก ~30 นาที ทั้งวันทั้งคืน) ตัวกันสแปมตายสนิทโดยไม่มีใครรู้
       → เกณฑ์ใหม่ 2 ชั้น กัน "คลิกหลุด" ไม่ให้พลิกทั้งระบบ:
         ① นับ **รายเฟส** ไม่เหมาเป็นก้อนเดียว — ใบที่ไปถึงสถานะ S เป็นหลักฐานของเฟสที่ rank ≤ S เท่านั้น
         ② ต้องเป็น **ความเคลื่อนไหวล่าสุด** (≤ LIVE_WINDOW_DAYS) และ **≥ MIN_LIVE_ORDERS ใบ**
            → ใบค้างเก่าหมดอายุเอง ตัวกันสแปมกลับมาทำงานโดยไม่ต้องแก้อะไร
       ⚠️ ตั้งใจให้ under-alert ดีกว่า spam: ถ้าทีมเพิ่งเริ่มใช้แต่ยังไม่ถึงเกณฑ์ จะเตือนเฉพาะเฟสสุดท้าย
          ซึ่งยังจับ "ยังไม่ได้ส่ง" ได้ครบเหมือนเดิม — ไม่มีงานหลุดจากการข้ามเฟสกลาง */
    const MIN_LIVE_ORDERS = 3;   // 1–2 ใบ = คลิกหลุด/ลองกด ไม่ใช่การใช้งานจริง
    const LIVE_WINDOW_DAYS = 7;  // ต้องเป็นของใหม่ ใบค้างเก่าไม่นับเป็นหลักฐานว่า "ยังใช้อยู่"
    const since = addDays(work.y, work.mo, work.d, -30);
    const liveFrom = addDays(work.y, work.mo, work.d, -LIVE_WINDOW_DAYS);
    const liveFromStr = `${liveFrom.y}-${pad(liveFrom.mo)}-${pad(liveFrom.d)}`;
    const { data: recent } = await db.from('customer_shipping_orders')
      .select('status, due_date').gte('due_date', `${since.y}-${pad(since.mo)}-${pad(since.d)}`);
    // ระดับสถานะของ "ใบที่ยังอยู่กลางทางและยังใหม่พอ"
    const midRanks: number[] = [];
    for (const r of recent ?? []) {
      const s = String(r.status);
      if (s === 'pending' || s === 'shipped') continue;
      if (String(r.due_date ?? '') < liveFromStr) continue; // ใบค้างเก่า = ไม่ใช่หลักฐาน
      midRanks.push(STATUS_RANK[s] ?? 0);
    }
    const liveFor = (s: string) =>
      s === 'shipped' || midRanks.filter((r) => r >= (STATUS_RANK[s] ?? 99)).length >= MIN_LIVE_ORDERS;
    const workflowLive = midRanks.length >= MIN_LIVE_ORDERS; // ใช้รายงานใน response เท่านั้น
    let skippedUnused = 0;
    /* รายงานให้เห็นว่า "เฟสไหนถือว่าใช้จริง" — บั๊ก 24/8 ซ่อนอยู่ 7 วันเพราะ response
       บอกแค่ workflow_live: true/false ก้อนเดียว มองไม่ออกว่ามาจากใบ 2 ใบที่ค้าง */
    const diag = {
      mid_orders_recent: midRanks.length,
      min_live_orders: MIN_LIVE_ORDERS,
      live_window_days: LIVE_WINDOW_DAYS,
      live_phases: [...new Set((steps ?? []).map((s) => String(s.requires_status)))].filter(liveFor),
    };

    // เฟสที่หลุด deadline และยังไม่เคยแจ้ง
    const { data: seen } = await db.from('shipping_phase_alerts').select('order_id, step_id').in('order_id', orders.map((o) => o.id));
    const seenKeys = new Set((seen ?? []).map((a) => `${a.order_id}|${a.step_id}`));

    type Miss = { order: Record<string, unknown>; step: Record<string, unknown>; deadlineMs: number };
    const misses: Miss[] = [];
    for (const o of orders) {
      const shipMs = bkkMs(String(o.due_date), String(o.ship_time));
      for (const st of stepsFor(o.customer as string | null)) {
        const deadlineMs = shipMs - Number(st.offset_min) * 60000;
        if (nowMs < deadlineMs) continue;
        if (STATUS_RANK[String(o.status)] >= STATUS_RANK[String(st.requires_status)]) continue;
        if (seenKeys.has(`${o.id}|${st.id}`)) continue;
        if (!liveFor(String(st.requires_status))) { skippedUnused++; continue; }
        misses.push({ order: o, step: st, deadlineMs });
      }
    }
    if (!misses.length) return new Response(JSON.stringify({ ok: true, checked: orders.length, missed: 0, workflow_live: workflowLive, skipped_unused_phases: skippedUnused, ...diag }), { status: 200 });

    /* mark ก่อนส่ง — ยิงครั้งเดียวต่อ (รอบ, เฟส) แม้ scan ซ้อน
       ⚠️⚠️ แต่ mark ก่อนส่ง + กลืน error ตอนส่ง = **เงียบถาวร** (แก้ 2026-08-26)
       PK คือ (order_id, step_id) → ถ้า Telegram/send-notification ล่มตอนนั้น แถว mark ยังอยู่
       ⇒ รอบส่งนั้นจะไม่มีวันถูกแจ้งอีกเลย และ response ยังตอบ ok:true = ไม่มีใครรู้
       (บั๊ก class เดียวกับ pm-plan-reminder ที่ dedup ด้วยธงที่ตั้งเฉพาะตอน POST สำเร็จ)
       กติกา: mark ก่อน (กัน scan ซ้อนยิงซ้ำ) แต่ **ส่งพลาดต้องถอน mark คืน** ให้รอบหน้าลองใหม่
       ถอนแบบเจาะจงด้วย `notified_at = runStamp` — แถวที่เคย mark ไว้รอบก่อนมี stamp คนละค่า
       จึงไม่โดนลบไปด้วย (PK ไม่มี surrogate id ให้ลบทีละคู่ในคำสั่งเดียว) */
    const runStamp = new Date().toISOString();
    const { error: insErr } = await db.from('shipping_phase_alerts').upsert(
      misses.map((m) => ({ order_id: m.order.id, step_id: m.step.id, notified_at: runStamp })),
      { onConflict: 'order_id,step_id', ignoreDuplicates: true },
    );
    if (insErr) throw insErr;

    // จัดกลุ่มตามเฟส แล้วส่งข้อความเดียว
    const byStep = new Map<string, { step: Record<string, unknown>; items: Miss[] }>();
    for (const m of misses) {
      const k = String(m.step.id);
      if (!byStep.has(k)) byStep.set(k, { step: m.step, items: [] });
      byStep.get(k)!.items.push(m);
    }
    const bkkTime = (ms: number) => {
      const d = new Date(ms + 7 * 3600000);
      return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    };
    const groups = [...byStep.values()]
      .sort((a, b) => Number(a.step.step_no) - Number(b.step.step_no))
      .map((g) => ({
        step_name: g.step.name,
        offset_min: g.step.offset_min,
        count: g.items.length,
        items: g.items.map((m) => ({
          ship_time: String(m.order.ship_time).slice(0, 5),
          deadline: bkkTime(m.deadlineMs),
          customer: custName.get(String(m.order.customer)) || m.order.customer || '-',
          mat_no: m.order.mat_no,
          qty: m.order.qty,
          status_label: STATUS_LABEL[String(m.order.status)] || m.order.status,
        })),
      }));

    let notifyErr: string | null = null;
    try {
      const res = await fetch(NOTIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${NOTIFY_KEY}`, apikey: NOTIFY_KEY },
        body: JSON.stringify({ event: 'shipping_phase_alert', alert: { work_date: workDate, total: misses.length, groups } }),
      });
      if (!res.ok) notifyErr = `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`;
    } catch (e) {
      notifyErr = String(e);
    }

    // ส่งไม่สำเร็จ → ถอน mark ของรอบนี้ ให้ scan รอบถัดไปแจ้งซ้ำได้ (ห้ามเงียบถาวร)
    if (notifyErr) {
      console.error('[shipping-phase-scan] notify failed, rolling back marks:', notifyErr);
      const { error: rbErr } = await db.from('shipping_phase_alerts').delete().eq('notified_at', runStamp);
      if (rbErr) console.error('[shipping-phase-scan] rollback failed — เฟสเหล่านี้จะไม่ถูกแจ้งอีก:', rbErr);
      return new Response(JSON.stringify({
        ok: false, notify_error: notifyErr, rolled_back: !rbErr,
        checked: orders.length, missed: misses.length, workflow_live: workflowLive, skipped_unused_phases: skippedUnused, ...diag,
      }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true, checked: orders.length, missed: misses.length, workflow_live: workflowLive, skipped_unused_phases: skippedUnused, ...diag }), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
