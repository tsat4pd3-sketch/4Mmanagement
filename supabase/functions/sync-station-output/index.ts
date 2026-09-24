// ══ sync-station-output — สรุปยอดผลิต/เหตุการณ์ราย ไลน์×วัน×กะ จาก DR มาเก็บฝั่ง Main ══
//
// ทำไมต้อง copy: attendance (ใครอยู่สถานีไหน) อยู่ Main · ยอดผลิต/ของเสีย/เครื่องหยุด อยู่ DR
// join ข้าม project ใน SQL ไม่ได้ ⇒ job EXP farm จะรันเป็น SQL เดียวจบไม่ได้ถ้าไม่ sync มาก่อน
// เก็บเฉพาะ "สรุปรายกะ" ไม่ใช่แถวดิบ (ไลน์ ~40 × 2 กะ × 365 วัน ≈ 29k แถว/ปี — เล็กมาก)
//
// ⚠️ deploy ด้วย verify_jwt=false (เหมือน qa-fme-scan / pm-daily-scan) — cron เรียกผ่าน pg_net
//    ที่ไม่มี Authorization header · MCP deploy tool default verify_jwt=true ต้องส่ง false ทุกครั้ง
// ⚠️ ต้องมี secret DR_URL / DR_ANON_KEY ที่ Main project (Edge Functions → Secrets) — ตัวเดียวกับ qa-fme-scan
// cron: migration 20260924_skill_exp_v2_engine_main.sql (ทุกวัน 08:10 ไทย = 01:10 UTC ก่อน farm 08:20)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// clean(): ตัดอักขระที่ใส่ใน HTTP header ไม่ได้ — เคยเกิดจริง 2026-08-19 คนก๊อป "ค่าที่ถูกปิดบัง"
// จากหน้าเว็บมาวาง ได้ตัว • (U+2022) มาทั้งพวง แล้ว fetch โยน "not a valid ByteString" ที่อ่านไม่ออก
const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, '').trim();
const DR_URL = clean(Deno.env.get('DR_URL') || '').replace(/\/$/, '');
const DR_KEY = clean(Deno.env.get('DR_ANON_KEY') || '');

/* วันงานไทย (ตัด 08:00) — กฎเดียวกับ getWorkDate ทั้งระบบ ห้ามใช้ toISOString ตรงๆ */
function bangkok(d: Date) { return new Date(d.getTime() + 7 * 3600_000); }
function workDateOf(d: Date): string {
  const b = bangkok(d);
  if (b.getUTCHours() < 8) b.setUTCDate(b.getUTCDate() - 1);
  return b.toISOString().slice(0, 10);
}
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 🔴 ต้องแบ่งหน้าอ่านเสมอ — PostgREST มีเพดาน max-rows 1000 แถวที่ `limit=` ใน query string
//    **ชนะไม่ได้** และมัน "สำเร็จ" เงียบๆ (200 OK พร้อมข้อมูลไม่ครบ) · เจอจริงตอน backfill รอบแรก
//    2026-09-24: ได้ sessions = 1000 เป๊ะ ทั้งที่ช่วง 140 วันมีมากกว่านั้น → rollup ขาดหายแบบไม่มี error
const PAGE = 1000;
async function dr(path: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${DR_URL}/rest/v1/${path}`, {
      headers: {
        apikey: DR_KEY,
        Authorization: `Bearer ${DR_KEY}`,
        Range: `${from}-${from + PAGE - 1}`,
        'Range-Unit': 'items',
      },
    });
    if (!res.ok) throw new Error(`DR ${path} → ${res.status} ${await res.text()}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < PAGE) return out;
    if (out.length > 500_000) throw new Error(`DR ${path}: เกิน 500k แถว — คิวรีกว้างเกินไป`);
  }
}

Deno.serve(async (req) => {
  try {
    if (!DR_URL || !DR_KEY) {
      return new Response(JSON.stringify({ ok: false, error: 'missing DR_URL / DR_ANON_KEY secret' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const url = new URL(req.url);
    let body: any = {};
    try { body = await req.json(); } catch { /* cron ส่ง {} — ไม่มี body ก็ได้ */ }

    // ย้อนหลังกี่วัน (default 3 — เผื่อกะที่ปิดใบย้อนหลัง/แก้ยอดทีหลัง · sync ทับได้ idempotent)
    const days = Math.max(1, Math.min(400, Number(body.days ?? url.searchParams.get('days') ?? 3)));
    const to = body.to ?? url.searchParams.get('to') ?? workDateOf(new Date());
    const from = addDays(to, -(days - 1));

    // 1) กะทั้งหมดในช่วง
    const sessions = await dr(
      `production_sessions?select=id,work_date,line_name,shift,qty_ok,qty_ng,ng_qty` +
      `&work_date=gte.${from}&work_date=lte.${to}`);

    if (!sessions.length) {
      return new Response(JSON.stringify({ ok: true, from, to, sessions: 0, rows: 0 }),
        { headers: { 'Content-Type': 'application/json' } });
    }

    // 2) รุ่นที่ผลิตในกะ + เหตุการณ์ผิดปกติ (เครื่องหยุด / ใบของเสีย) — ผูกด้วย session_id
    // 🔴 รุ่นต้องดึงจาก prod_orders.mat_no **ห้ามใช้ production_sessions.product_id**
    //    คอลัมน์นั้นเป็นคอลัมน์ร้าง = null ทั้งตาราง (วัด 2026-09-24: 0 จาก 1,318 แถว)
    //    ใบผลิตต่างหากที่ถือ mat — 1 กะมีได้หลายใบ/หลายรุ่น
    const sessIds = sessions.map((s) => s.id);
    const dtBySess = new Map<string, number>();
    const dfBySess = new Map<string, number>();
    const matsBySess = new Map<string, Set<string>>();
    for (let i = 0; i < sessIds.length; i += 100) {
      const chunk = sessIds.slice(i, i + 100);
      const [dts, dfs, ords] = await Promise.all([
        dr(`downtime_logs?select=session_id&session_id=in.(${chunk.join(',')})`),
        dr(`defect_logs?select=session_id&session_id=in.(${chunk.join(',')})`),
        dr(`prod_orders?select=session_id,mat_no&session_id=in.(${chunk.join(',')})`),
      ]);
      for (const d of dts) dtBySess.set(String(d.session_id), (dtBySess.get(String(d.session_id)) || 0) + 1);
      for (const d of dfs) dfBySess.set(String(d.session_id), (dfBySess.get(String(d.session_id)) || 0) + 1);
      for (const o of ords) {
        if (!o.mat_no) continue;
        const k = String(o.session_id);
        if (!matsBySess.has(k)) matsBySess.set(k, new Set());
        matsBySess.get(k)!.add(String(o.mat_no));
      }
    }

    // 3) ยุบเป็น ไลน์ × วัน × กะ
    type Agg = {
      work_date: string; line_name: string; shift: string;
      qty_ok: number; qty_ng: number; n_downtime: number; n_defect_ev: number; parts: Set<string>;
    };
    const agg = new Map<string, Agg>();
    for (const s of sessions) {
      if (!s.line_name || !s.work_date) continue;
      const shift = String(s.shift || 'day');
      const key = `${s.work_date}|${s.line_name}|${shift}`;
      let a = agg.get(key);
      if (!a) {
        a = { work_date: s.work_date, line_name: String(s.line_name), shift,
              qty_ok: 0, qty_ng: 0, n_downtime: 0, n_defect_ev: 0, parts: new Set() };
        agg.set(key, a);
      }
      a.qty_ok      += Number(s.qty_ok || 0);
      a.qty_ng      += Number(s.qty_ng ?? s.ng_qty ?? 0);
      a.n_downtime  += dtBySess.get(String(s.id)) || 0;
      a.n_defect_ev += dfBySess.get(String(s.id)) || 0;
      for (const mat of matsBySess.get(String(s.id)) ?? []) a.parts.add(mat);
    }

    const rows = [...agg.values()].map((a) => {
      const parts = [...a.parts].slice(0, 50);               // cap — กันแถวบวมถ้ากะนึงรันหลายสิบรุ่น
      return {
        work_date: a.work_date, line_name: a.line_name, shift: a.shift,
        qty_ok: a.qty_ok, qty_ng: a.qty_ng,
        n_parts: parts.length,
        n_changeover: Math.max(0, parts.length - 1),
        n_downtime: a.n_downtime, n_defect_ev: a.n_defect_ev,
        parts_seen: parts, synced_at: new Date().toISOString(),
      };
    });

    // upsert ทับได้ — ทับด้วยยอดล่าสุดเสมอ (กะที่แก้ยอดย้อนหลังจึงตามทัน)
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from('station_output_rollup')
        .upsert(rows.slice(i, i + 500), { onConflict: 'work_date,line_name,shift' });
      if (error) throw new Error(`upsert rollup: ${error.message}`);
    }

    return new Response(JSON.stringify({ ok: true, from, to, sessions: sessions.length, rows: rows.length }),
      { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('sync-station-output', e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
