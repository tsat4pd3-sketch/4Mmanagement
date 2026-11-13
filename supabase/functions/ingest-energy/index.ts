/* 📡 ingest-energy — รับค่ามิเตอร์ที่ MQTT bridge สรุปมาแล้ว → เขียนลง energy_live
   Project: DR · verify_jwt = false (bridge ไม่มี JWT — ใช้ shared secret แทน)

   ✅ deploy แล้ว 2026-11-09 (verify_jwt=false) · ⚠️ ต้องตั้ง secret INGEST_SECRET ก่อนถึงจะมีข้อมูลเข้าระบบ
      (ยังไม่ตั้ง = header ไม่มีทางตรง = ตอบ 401 ทุก request · ปิดประตูไว้ ไม่เขียน DB)
      deploy: supabase functions deploy ingest-energy --no-verify-jwt
      secrets: INGEST_SECRET (ต้องตรงกับฝั่ง bridge) · SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY

   สายงาน: MQTT → bridge (สรุป 15 นาที) → ที่นี่ → energy_live / energy_topic_unmapped
   v8 (2026-11-13): + body.live (สถานะสดต่อเครื่อง → machine_live_state) · STATE_MAP + UNPLANNED
   v6 (2026-11-11): + body.states (ช่วงหยุดของเครื่อง → machine_state_events) + body.pieces (ชิ้นต่อนาที → machine_counters)
     ข้อมูลจากเครื่อง "เฟสเดินคู่" — ยังไม่เข้าสูตร OEE · ต้องระบุต้นทางได้ (source id) ไม่งั้นข้าม · เก็บ 90 วัน
   v5 (2026-11-11): ศูนย์เชื่อมต่อ — รู้ว่า "ใครส่ง" (integration_sources · 📄 docs/modules/integration-hub.md)
     · header `x-source-key` = รหัสลับของต้นทางนั้น (เทียบ sha256 กับ key_hash)
     · header `x-ingest-secret` = secret กลางเดิม ⇒ ผูกกับต้นทาง legacy (`x-source` = code · ไม่ส่ง = 'dieshop')
       ⇒ Node-RED ตัวเดิมไม่ต้องแก้อะไร
     · ต้นทางถูกพัก = 423 ไม่เขียน · ทุกครั้งนับลง integration_hourly ผ่าน fn_integration_tick (นับล้ม = ไม่ทำให้การรับล้ม)
   v4 (2026-11-10): + body.limits — ลิมิตจากโหนด SMART ENERGY HUB (MACHINES[].kwLimit/aLimit) ⇒ energy_live_meters
     Node-RED = เจ้าของลิมิต · เขียนเฉพาะแถวที่มีอยู่แล้ว + ค่าต่างจริง (ไม่สร้างมิเตอร์ใหม่ · ไม่เขียนทุกนาที)
   v3 (2026-11-10): + body.events (energy_event → energy_events · เก็บ 30 วัน) + body.daily (energy_day → เติม energy_daily วันที่ของเราไม่ครบ)
   v2 (2026-11-09): + ประวัติรายนาที energy_readings (trigger สรุปลง energy_daily) + field v/a
     ตัวส่งจริงตัวแรก = Node-RED Die Shop ยิงทุก 1 นาที
     ⚠️ ทุก field ของเครื่องเดียวกันต้องมาใน POST เดียวกัน — แถวรายนาทีตัวแรกชนะ (ซ้ำ = ข้าม)
        แยกส่ง kw กับ kwh คนละ POST ในนาทีเดียวกัน = ตัวหลังหายจากประวัติ (ค่าล่าสุดยังเข้า)
   แบบเต็ม: docs/ENERGY_MONITORING_DESIGN.md §14 · ตัวอย่าง bridge: docs/mqtt-bridge-example.js */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const UNIT: Record<string, string> = { kw: 'kW', kwh_total: 'kWh', v: 'V', a: 'A' };
/** ค่าที่เก็บเป็นประวัติรายนาที (energy_readings) — ต้องตรงกับคอลัมน์ของตาราง */
const HIST_FIELDS = ['kw', 'kwh_total', 'v', 'a'];
/** เก็บประวัติรายนาทีไว้กี่วัน (ยอดระยะยาวอยู่ energy_daily ที่ trigger สรุปไว้แล้ว) */
const READINGS_KEEP_DAYS = 7;
/** เก็บเหตุการณ์ไว้กี่วัน (ต้นทางเกิดหลายพันแถว/วัน) */
const EVENTS_KEEP_DAYS = 30;
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
/** เวลาไทยไม่มีโซนจาก MySQL ('YYYY-MM-DD HH:MM:SS') → ISO · มีโซนอยู่แล้ว = ใช้ตามนั้น · อ่านไม่ออก = null */
function bkk(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v).trim().replace(' ', 'T');
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}+07:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
/** 'YYYY-MM-DD' วันตามปฏิทินไทย */
const bkkToday = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** แกะค่าจาก payload JSON ตาม json_path แบบง่าย ('$.data.activePower') — รองรับ index array ด้วย */
function pick(obj: unknown, jsonPath: string | null): unknown {
  if (!jsonPath) return obj;
  let cur: any = obj;
  for (const seg of jsonPath.replace(/^\$\.?/, '').split('.')) {
    if (cur == null || seg === '') break;
    const m = seg.match(/^(.+?)\[(\d+)\]$/);
    cur = m ? cur?.[m[1]]?.[Number(m[2])] : cur?.[seg];
  }
  return cur;
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** ระบุต้นทางจาก header — null = ไม่ผ่าน (401) · { id: null } = secret กลางถูกแต่ยังไม่มีแถว legacy (รับแบบเดิม ไม่นับ) */
async function identify(sb: any, req: Request): Promise<{ id: string | null; paused: boolean } | null> {
  const key = (req.headers.get('x-source-key') || '').trim();
  if (key) {
    const { data } = await sb.from('integration_sources').select('id, is_paused')
      .eq('key_hash', await sha256Hex(key)).maybeSingle();
    return data ? { id: data.id, paused: !!data.is_paused } : null;
  }
  const secret = Deno.env.get('INGEST_SECRET');
  if (!secret || req.headers.get('x-ingest-secret') !== secret) return null;
  const code = (req.headers.get('x-source') || 'dieshop').trim();
  const { data } = await sb.from('integration_sources').select('id, is_paused')
    .eq('code', code).eq('legacy_secret', true).maybeSingle();
  return data ? { id: data.id, paused: !!data.is_paused } : { id: null, paused: false };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const src = await identify(sb, req);
  if (!src) return json({ error: 'unauthorized' }, 401);
  const tick = async (ok: boolean, saved: number, error: string | null, result: unknown) => {
    if (!src.id) return;
    const { error: e } = await sb.rpc('fn_integration_tick',
      { p_source: src.id, p_ok: ok, p_saved: saved, p_error: error, p_result: result });
    if (e) console.error('[ingest-energy] tick', e.message);   // นับไม่ได้ ≠ รับไม่ได้ — ห้ามทำให้การรับล้ม
  };
  if (src.paused) { await tick(false, 0, 'ต้นทางถูกพักการรับ', null); return json({ error: 'source paused' }, 423); }

  let res: Response;
  try { res = await handle(sb, req, src.id); } catch (e) { res = json({ ok: false, error: String((e as Error)?.message || e) }, 500); }
  let out: any = null;
  try { out = await res.clone().json(); } catch { /* ไม่ใช่ json */ }
  const saved = ['saved', 'history', 'events', 'daily', 'states', 'pieces', 'live'].reduce((s, k) => s + (Number(out?.[k]) || 0), 0)
    + (Number(out?.limits?.updated) || 0);
  await tick(res.status < 300, saved, out?.error ?? (res.status < 300 ? null : `HTTP ${res.status}`),
    out ? { status: res.status, ...out } : { status: res.status });
  return res;
});

/** สถานะดิบของต้นทาง → ชุดค่าของ ESM (ไม่รู้จัก = 'other' เก็บค่าดิบไว้ใน source_state ไม่ทิ้ง) */
const STATE_MAP: Record<string, string> = { FAULT: 'fault', UNPLANNED: 'unplanned', IDLE: 'idle', PLANNED_STOP: 'planned_stop', NO_PLAN: 'no_plan', COMM_LOSS: 'comm_loss' };
const FACTS_KEEP_DAYS = 90;

async function handle(sb: any, req: Request, sourceId: string | null): Promise<Response> {
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const readings: any[] = Array.isArray(body?.readings) ? body.readings : [];
  const events: any[] = Array.isArray(body?.events) ? body.events : [];
  const daily: any[] = Array.isArray(body?.daily) ? body.daily : [];
  const limits: any[] = Array.isArray(body?.limits) ? body.limits : [];
  const states: any[] = Array.isArray(body?.states) ? body.states : [];
  const pieces: any[] = Array.isArray(body?.pieces) ? body.pieces : [];
  const liveIn: any[] = Array.isArray(body?.live) ? body.live : [];
  if (!readings.length && !events.length && !daily.length && !limits.length && !states.length && !pieces.length && !liveIn.length) return json({ ok: true, saved: 0 });

  /* 🏭 ข้อมูลจากเครื่อง (v6) — ต้องรู้ต้นทาง (ผูก tag ↔ เครื่องต่อต้นทาง) · เวลาต้นทาง = เวลาไทยไม่มีโซน ⇒ bkk() */
  let stSaved = 0, pcSaved = 0, lvSaved = 0;
  if ((states.length || pieces.length || liveIn.length) && !sourceId) {
    return json({ ok: false, error: 'states/pieces/live ต้องส่งจากต้นทางที่ลงทะเบียน (x-source-key หรือ x-source)' }, 400);
  }
  /* 🟢 สถานะสด (v8 · 13/11) — 1 แถว/เครื่อง ทับทุกครั้ง · เก็บข้อความต้นทางตามจริง (ESM ไม่แปลรหัสสถานะเอง) */
  if (liveIn.length) {
    const txt = (v: unknown) => (v == null || v === '' ? null : String(v).slice(0, 200));
    const rows = liveIn.map((x: any) => ({
      source_id: sourceId, machine_tag: String(x.machine ?? '').trim(),
      state_code: num(x.state_code), state_text: txt(x.state_text), since: bkk(x.since),
      alarm_text: txt(x.alarm_text), onplan_text: txt(x.onplan_text), unplan_text: txt(x.unplan_text),
      production_enable: x.production_enable == null ? null : !!Number(x.production_enable),
      total_product: num(x.total_product), source_updated_at: bkk(x.last_update), received_at: new Date().toISOString(),
    })).filter((r: any) => r.machine_tag);
    if (rows.length) {
      const { error } = await sb.from('machine_live_state').upsert(rows, { onConflict: 'source_id,machine_tag' });
      if (error) return json({ ok: false, error: `live: ${error.message}` }, 500);
      lvSaved = rows.length;
    }
  }
  if (states.length) {
    const rows = states.map((x: any) => {
      const raw = String(x.state ?? '').trim().toUpperCase();
      return {
        source_id: sourceId, machine_tag: String(x.machine ?? '').trim(), started_at: bkk(x.start), ended_at: bkk(x.end),
        duration_sec: num(x.duration_sec), state: STATE_MAP[raw] || 'other', source_state: raw || null,
        reason_code: num(x.reason_code), reason_text: x.reason_text ? String(x.reason_text).slice(0, 200) : null,
        is_minor: !!Number(x.is_minor), received_at: new Date().toISOString(),
      };
    }).filter((r: any) => r.machine_tag && r.started_at);
    if (rows.length) {
      const { error } = await sb.from('machine_state_events').upsert(rows, { onConflict: 'source_id,machine_tag,started_at' });
      if (error) return json({ ok: false, error: `states: ${error.message}` }, 500);
      stSaved = rows.length;
      await sb.from('machine_state_events').delete().lt('started_at', new Date(Date.now() - FACTS_KEEP_DAYS * 86400000).toISOString());
    }
  }
  if (pieces.length) {
    // แถวที่ไม่มียอด (qty อ่านไม่ออก) = ทิ้ง ห้ามบีบเป็น 0 (0 = "เครื่องไม่ได้ทำชิ้น" ซึ่งเป็นข้อเท็จจริงคนละเรื่อง)
    const rows = pieces.filter((x: any) => num(x?.qty) != null).map((x: any) => ({
      source_id: sourceId, machine_tag: String(x.machine ?? '').trim(), counted_at: bkk(x.minute),
      delta: Math.max(0, Math.trunc(num(x.qty) as number)), ng_delta: Math.max(0, Math.trunc(num(x.ng) ?? 0)),
      received_at: new Date().toISOString(),
    })).filter((r: any) => r.machine_tag && r.counted_at);
    if (rows.length) {
      // ทับยอดของนาทีเดิม — ต้นทางส่งยอด "ทั้งนาที" (หน้าต่างเริ่มที่ต้นนาที) ⇒ ค่าใหม่ครบกว่าเสมอ
      const { error } = await sb.from('machine_counters').upsert(rows, { onConflict: 'source_id,machine_tag,counted_at' });
      if (error) return json({ ok: false, error: `pieces: ${error.message}` }, 500);
      pcSaved = rows.length;
      await sb.from('machine_counters').delete().lt('counted_at', new Date(Date.now() - FACTS_KEEP_DAYS * 86400000).toISOString());
    }
  }
  if (!readings.length && !events.length && !daily.length && !limits.length) {
    return json({ ok: true, saved: 0, states: stSaved, pieces: pcSaved, live: lvSaved });
  }

  // ทะเบียน topic → จุดวัด (ตั้งจากหน้า /energy แท็บ 📡)
  const { data: cfg, error: cfgErr } = await sb
    .from('energy_meter_topics').select('*').eq('is_active', true);
  if (cfgErr) return json({ error: cfgErr.message }, 500);

  const byTopic = new Map<string, any[]>();
  for (const c of cfg || []) {
    if (!byTopic.has(c.topic)) byTopic.set(c.topic, []);
    byTopic.get(c.topic)!.push(c);
  }

  const now = new Date().toISOString();
  const live: any[] = [];
  const unknown: any[] = [];

  for (const r of readings) {
    const specs = byTopic.get(r?.topic);
    // ⚠️ topic ที่ยังไม่มีใครผูก **ห้ามทิ้งเงียบ** — เก็บไว้ให้โผล่ในหน้าจอเพื่อกดผูก
    if (!specs?.length) {
      if (r?.topic) unknown.push({ topic: r.topic, sample: String(r.sample ?? '').slice(0, 200), last_seen: now });
      continue;
    }
    for (const s of specs) {
      // payload ตัวเลขล้วน → ใช้ค่าที่ bridge สรุปมา · payload JSON → แกะตาม json_path
      let v: unknown = null;
      if (s.json_path && r.json) {
        try { v = pick(JSON.parse(r.json), s.json_path); } catch { v = null; }
      } else {
        // kW เอา "ค่าสูงสุดในรอบ" (peak คือตัวที่ทำให้โดน demand charge — ค่าเฉลี่ยกลบมันหมด)
        // ค่าอื่นเอาค่าล่าสุด (kwh_total เป็นเลขสะสม ค่าล่าสุดคือของจริง)
        v = s.field === 'kw' ? (r.max ?? r.last) : r.last;
      }
      const num = Number(v);
      if (!Number.isFinite(num)) continue;      // แกะไม่ได้ = ข้าม ไม่เขียนค่ามั่ว
      live.push({
        scope_kind: s.scope_kind, scope_name: s.scope_name, field: s.field,
        value: num * Number(s.scale ?? 1),
        unit: UNIT[s.field] ?? null,
        read_at: r.at || body.bucket_at || now, received_at: now, topic: s.topic,
      });
    }
  }

  // UPDATE ทับเสมอ (1 แถวต่อ จุดวัด×ค่า) — ตารางไม่โต ไม่ผูก audit
  if (live.length) {
    const { error } = await sb.from('energy_live').upsert(live, { onConflict: 'scope_kind,scope_name,field' });
    if (error) return json({ error: error.message }, 500);
  }

  /* 📈 ประวัติรายนาที (บอร์ดค่าไฟสด · 2026-11-09) — 1 แถวต่อเครื่องต่อนาที
     ⚠️ ซ้ำนาทีเดิม = ข้าม (ignoreDuplicates) ⇒ trigger สรุปรายวันไม่บวกซ้ำเมื่อ Node-RED ยิงซ้ำ */
  const hist = new Map<string, any>();
  for (const l of live) {
    if (!HIST_FIELDS.includes(l.field)) continue;
    const t = new Date(l.read_at);
    if (!Number.isFinite(t.getTime())) continue;
    t.setUTCSeconds(0, 0);
    const bucket = t.toISOString();
    const k = `${l.scope_kind}|${l.scope_name}|${bucket}`;
    if (!hist.has(k)) hist.set(k, { scope_kind: l.scope_kind, scope_name: l.scope_name, bucket_at: bucket, received_at: now });
    hist.get(k)[l.field] = l.value;
  }
  let histSaved = 0;
  if (hist.size) {
    const { error } = await sb.from('energy_readings')
      .upsert([...hist.values()], { onConflict: 'scope_kind,scope_name,bucket_at', ignoreDuplicates: true });
    // ค่าล่าสุดเข้าแล้ว แต่ประวัติล้ม = ต้องบอกผู้ส่ง ห้ามตอบ ok เงียบๆ
    if (error) return json({ ok: false, saved: live.length, error: `history: ${error.message}` }, 500);
    histSaved = hist.size;
    const cutoff = new Date(Date.now() - READINGS_KEEP_DAYS * 86400000).toISOString();
    await sb.from('energy_readings').delete().lt('bucket_at', cutoff);   // ล้มไม่เป็นไร รอบหน้าลบใหม่
  }

  if (unknown.length) {
    // เก็บ topic แปลกไว้ให้คนมาผูก (hits ไม่ต้องแม่น — แค่บอกว่าเจอบ่อยไหม)
    await sb.from('energy_topic_unmapped').upsert(unknown, { onConflict: 'topic' });
  }
  /* 🔔 เหตุการณ์จาก Node-RED (energy_event · v3 2026-11-10) — Node-RED ตัดสินเกินลิมิตเอง ESM แค่เก็บ
     เวลาฝั่ง MySQL = เวลาไทยไม่มีโซน ('YYYY-MM-DD HH:MM:SS') ⇒ ต่อ +07:00 · ซ้ำ (source_id เดิม) = ข้าม */
  let evSaved = 0;
  if (events.length) {
    const rows = events.map((e: any) => ({
      source_id: Number(e.id), scope_kind: 'zone', scope_name: String(e.machine ?? '').trim(),
      ev_time: bkk(e.ev_time), level: e.level ?? null, code: e.code ?? null, kind: e.kind ?? null,
      message: e.message ?? null, value: num(e.value), duration_s: num(e.duration_s), received_at: now,
    })).filter((x: any) => Number.isFinite(x.source_id) && x.scope_name && x.ev_time);
    if (rows.length) {
      const { error } = await sb.from('energy_events').upsert(rows, { onConflict: 'source_id', ignoreDuplicates: true });
      if (error) return json({ ok: false, saved: live.length, error: `events: ${error.message}` }, 500);
      evSaved = rows.length;
      const cutoff = new Date(Date.now() - EVENTS_KEEP_DAYS * 86400000).toISOString();
      await sb.from('energy_events').delete().lt('ev_time', cutoff);   // ล้มไม่เป็นไร รอบหน้าลบใหม่
    }
  }

  /* 📅 ยอดรายวันย้อนหลังจาก Node-RED (energy_day) — เติมวันที่ ESM ยังไม่มี/มีไม่ครบ
     กติกา: เฉพาะ "วันที่ผ่านไปแล้ว" (วันนี้ trigger ของเราคิดสดอยู่) · ทับเฉพาะเมื่อของเรามีจุดน้อยกว่าต้นทาง
     kWh = emax − emin (เลขสะสมต้น-ท้ายวัน) · pmax หน่วย W ⇒ ÷1000 */
  let daySaved = 0;
  if (daily.length) {
    const today = bkkToday();
    const cand = daily.map((d: any) => {
      const emin = num(d.emin), emax = num(d.emax);
      return {
        scope_kind: 'zone', scope_name: String(d.machine ?? '').trim(), day: String(d.day ?? '').slice(0, 10),
        kwh: emin != null && emax != null && emax >= emin ? emax - emin : null,
        peak_kw: num(d.pmax) != null ? num(d.pmax)! / 1000 : null, peak_at: bkk(d.pmax_at),
        last_kwh_total: emax, samples: Math.trunc(num(d.n) ?? 0), resets: 0, updated_at: now,
      };
    }).filter((x: any) => x.scope_name && /^\d{4}-\d{2}-\d{2}$/.test(x.day) && x.day < today && x.kwh != null);
    if (cand.length) {
      const days = [...new Set(cand.map((c: any) => c.day))];
      const { data: have, error: hErr } = await sb.from('energy_daily')
        .select('scope_kind, scope_name, day, samples').in('day', days);
      if (hErr) return json({ ok: false, error: `daily read: ${hErr.message}` }, 500);
      const haveBy = new Map((have || []).map((h: any) => [`${h.scope_kind}|${h.scope_name}|${h.day}`, h.samples ?? 0]));
      const rows = cand.filter((c: any) => {
        const k = `${c.scope_kind}|${c.scope_name}|${c.day}`;
        return !haveBy.has(k) || Number(haveBy.get(k)) < c.samples;
      });
      if (rows.length) {
        const { error } = await sb.from('energy_daily').upsert(rows, { onConflict: 'scope_kind,scope_name,day' });
        if (error) return json({ ok: false, error: `daily: ${error.message}` }, 500);
      }
      daySaved = rows.length;
    }
  }

  /* 🎚️ ลิมิตจาก Node-RED (v4) — { name, kw, a } · null = HUB ไม่ตรวจ (ตามความหมายต้นทาง)
     คีย์ไม่ส่งมา/ไม่ใช่ตัวเลข = ไม่แตะช่องนั้น (ห้ามล้างลิมิตเพราะ payload พัง) */
  let limUpdated = 0;
  const limUnknown: string[] = [];
  if (limits.length) {
    const want = new Map<string, { kw?: number | null; a?: number | null }>();
    for (const l of limits) {
      const name = String(l?.name ?? '').trim();
      if (!name) continue;
      const v: { kw?: number | null; a?: number | null } = {};
      if (l.kw === null) v.kw = null; else if (num(l.kw) != null) v.kw = num(l.kw);
      if (l.a === null) v.a = null; else if (num(l.a) != null) v.a = num(l.a);
      if ('kw' in v || 'a' in v) want.set(name, v);
    }
    if (want.size) {
      const { data: have, error: mErr } = await sb.from('energy_live_meters')
        .select('scope_name, limit_kw, limit_a').eq('scope_kind', 'zone').in('scope_name', [...want.keys()]);
      if (mErr) return json({ ok: false, error: `limits read: ${mErr.message}` }, 500);
      const haveBy = new Map((have || []).map((h: any) => [h.scope_name, h]));
      const same = (x: unknown, y: number | null | undefined) => (x == null ? null : Number(x)) === (y ?? null);
      for (const [name, v] of want) {
        const h = haveBy.get(name);
        if (!h) { limUnknown.push(name); continue; }     // มิเตอร์ที่ยังไม่ได้ลงทะเบียน = บอกกลับ ไม่สร้างเอง
        const patch: Record<string, unknown> = {};
        if ('kw' in v && !same(h.limit_kw, v.kw)) patch.limit_kw = v.kw;
        if ('a' in v && !same(h.limit_a, v.a)) patch.limit_a = v.a;
        if (!Object.keys(patch).length) continue;
        patch.updated_at = now;
        const { error } = await sb.from('energy_live_meters').update(patch).eq('scope_kind', 'zone').eq('scope_name', name);
        if (error) return json({ ok: false, error: `limits: ${error.message}` }, 500);
        limUpdated++;
      }
    }
  }

  return json({ ok: true, saved: live.length, history: histSaved, unmapped: unknown.length, events: evSaved, daily: daySaved,
    limits: { updated: limUpdated, unknown: limUnknown }, states: stSaved, pieces: pcSaved, live: lvSaved });
}
