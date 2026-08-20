/* 📡 ingest-energy — รับค่ามิเตอร์ที่ MQTT bridge สรุปมาแล้ว → เขียนลง energy_live
   Project: DR · verify_jwt = false (bridge ไม่มี JWT — ใช้ shared secret แทน)

   ⚠️ **ยังไม่ deploy** — ต้อง deploy + ตั้ง secret ก่อนถึงจะมีข้อมูลเข้าระบบ
      deploy: supabase functions deploy ingest-energy --no-verify-jwt
      secrets: INGEST_SECRET (ต้องตรงกับฝั่ง bridge) · SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY

   สายงาน: MQTT → bridge (สรุป 15 นาที) → ที่นี่ → energy_live / energy_topic_unmapped
   แบบเต็ม: docs/ENERGY_MONITORING_DESIGN.md §14 · ตัวอย่าง bridge: docs/mqtt-bridge-example.js */
import { createClient } from 'jsr:@supabase/supabase-js@2';

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
        unit: s.field === 'kw' ? 'kW' : s.field === 'kwh_total' ? 'kWh' : null,
        read_at: r.at || body.bucket_at || now, received_at: now, topic: s.topic,
      });
    }
  }

  // UPDATE ทับเสมอ (1 แถวต่อ จุดวัด×ค่า) — ตารางไม่โต ไม่ผูก audit
  if (live.length) {
    const { error } = await sb.from('energy_live').upsert(live, { onConflict: 'scope_kind,scope_name,field' });
    if (error) return json({ error: error.message }, 500);
  }
  if (unknown.length) {
    // เก็บ topic แปลกไว้ให้คนมาผูก (hits ไม่ต้องแม่น — แค่บอกว่าเจอบ่อยไหม)
    await sb.from('energy_topic_unmapped').upsert(unknown, { onConflict: 'topic' });
  }
  return json({ ok: true, saved: live.length, unmapped: unknown.length });
});
