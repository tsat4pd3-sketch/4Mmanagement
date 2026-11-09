/* 📡 ingest-energy — รับค่ามิเตอร์ที่ MQTT bridge สรุปมาแล้ว → เขียนลง energy_live
   Project: DR · verify_jwt = false (bridge ไม่มี JWT — ใช้ shared secret แทน)

   ✅ deploy แล้ว 2026-11-09 (verify_jwt=false) · ⚠️ ต้องตั้ง secret INGEST_SECRET ก่อนถึงจะมีข้อมูลเข้าระบบ
      (ยังไม่ตั้ง = header ไม่มีทางตรง = ตอบ 401 ทุก request · ปิดประตูไว้ ไม่เขียน DB)
      deploy: supabase functions deploy ingest-energy --no-verify-jwt
      secrets: INGEST_SECRET (ต้องตรงกับฝั่ง bridge) · SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY

   สายงาน: MQTT → bridge (สรุป 15 นาที) → ที่นี่ → energy_live / energy_topic_unmapped
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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (req.headers.get('x-ingest-secret') !== Deno.env.get('INGEST_SECRET'))
    return json({ error: 'unauthorized' }, 401);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const readings: any[] = Array.isArray(body?.readings) ? body.readings : [];
  if (!readings.length) return json({ ok: true, saved: 0 });

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
  return json({ ok: true, saved: live.length, history: histSaved, unmapped: unknown.length });
});
