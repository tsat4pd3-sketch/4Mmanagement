/* ⚡ energy-meter-admin — ตั้งค่าตู้บนบอร์ดค่าไฟสด (energy_live_meters · DR)
   Project: DR ("Product DB") · verify_jwt = true (anon key ของ DR ที่ supabaseDR ส่งอยู่แล้ว —
            ด่านจริง = token ล็อกอินของ Main ที่ตรวจเองข้างล่าง · แบบเดียวกับ integration-admin)
   2026-11-23 · คำสั่ง user "ทำหน้าตั้งค่าตู้ในแท็บพลังงาน ให้ขึ้นชื่อ MDB-06" · 📄 docs/ENERGY_MONITORING_DESIGN.md

   ทำไมต้องผ่าน edge: ตาราง DR client เป็น anon เสมอ ⇒ เปิดเขียนตรง = ใครถือ anon key ก็แก้ผังได้
   auth: header `x-esm-token` (access token ของ Main) + `x-esm-apikey` (anon key ของ Main)
         → Main /auth/v1/user 200 → rpc has_perm('energy:record') = true (คีย์เดียวกับปุ่มบนจอ)
   body: { action, ... }
     save   { create?, scope_kind, scope_name, display_name?, panel, parent_name?, subtitle?,
              limit_kw?, limit_a?, gauge_max_kw?, idle_kw?, sort_order?, is_active? }
            idle_kw (27/11) = เกณฑ์ "รอ" — kW ต่ำกว่านี้ = รอ · ว่าง = ยังไม่ตั้ง (จอไม่ตัดสิน ทำงาน/รอ) · ไม่ส่งคีย์ = ไม่แตะ
            create = เพิ่มตู้ใหม่ — scope ต้องมีใน energy_meter_topics (มีข้อมูลเข้าจริง) และยังไม่อยู่บนบอร์ด
            🔴 scope_name = คีย์ข้อมูล/ประวัติ ห้ามเปลี่ยน — ชื่อบนจอแก้ที่ display_name
            🔴 parent_name ต้องเป็นตู้ที่อยู่บนบอร์ดแล้ว · ห้ามชี้ตัวเอง · ห้ามวน
     remove { scope_kind, scope_name }  — มีตู้ลูกชี้มาอยู่ = ห้ามลบ (ทะเบียนจับคู่ด้วยข้อความ · fail-closed)
     panel_target { panel, demand_target_kw?, baseline_start?, baseline_end? }  — ค่าตั้งของตู้ (energy_panel_settings)
            เป้า Demand 15 นาที (25/11) · ช่วง Baseline HH:MM (26/11) · ส่งเฉพาะช่องที่จะแก้
            ตู้ต้องมีมิเตอร์อยู่บนบอร์ด · ว่าง = ล้างเป้า (การ์ดเขียน "ยังไม่ได้ตั้งเป้า") */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MAIN_URL = 'https://ewhdfqwfwofivojtsizn.supabase.co';
const COLS = 'scope_kind, scope_name, display_name, panel, parent_name, subtitle, limit_kw, limit_a, gauge_max_kw, idle_kw, sort_order, is_active, updated_at, updated_by';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-esm-token, x-esm-apikey',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const str = (v: unknown, max: number) => (v == null ? null : String(v).trim().slice(0, max) || null);
/* ตัวเลขว่าง = null (ไม่ตั้ง) · พิมพ์ไม่ใช่ตัวเลข/ติดลบ = error ห้ามเดา */
const num = (v: unknown): number | null | 'bad' => {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 'bad';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const token = req.headers.get('x-esm-token') || '';
  const apikey = req.headers.get('x-esm-apikey') || '';
  if (!token || !apikey) return json({ error: 'ต้องล็อกอินก่อน' }, 401);
  const u = await fetch(`${MAIN_URL}/auth/v1/user`, { headers: { apikey, authorization: `Bearer ${token}` } });
  if (!u.ok) return json({ error: 'ล็อกอินหมดอายุ — ออกแล้วเข้าระบบใหม่' }, 401);
  const user = await u.json().catch(() => ({}));
  const p = await fetch(`${MAIN_URL}/rest/v1/rpc/has_perm`, {
    method: 'POST', headers: { apikey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ perm_key: 'energy:record' }),
  });
  if (!(p.ok && (await p.json()) === true)) return json({ error: 'ไม่มีสิทธิ์ตั้งค่าพลังงาน (energy:record)' }, 403);
  const who = String(user?.email || user?.id || '').slice(0, 120) || null;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (body?.action === 'panel_target') {
    const panel = str(body?.panel, 80);
    if (!panel) return json({ error: 'ต้องระบุตู้ (panel)' }, 400);
    // 26/11: แก้เฉพาะช่องที่ส่งมา (ไม่ส่ง = ไม่แตะ) — บันทึกเป้าอย่างเดียวห้ามล้างช่วง baseline และกลับกัน
    const row: Record<string, unknown> = { panel, updated_at: new Date().toISOString(), updated_by: who };
    if ('demand_target_kw' in (body || {})) {
      const t = num(body.demand_target_kw);
      if (t === 'bad' || t === 0) return json({ error: 'เป้าต้องเป็นตัวเลขมากกว่า 0 (เว้นว่าง = ไม่ตั้งเป้า)' }, 400);
      row.demand_target_kw = t;
    }
    if ('baseline_start' in (body || {}) || 'baseline_end' in (body || {})) {
      const hm = (v: unknown) => { const x = str(v, 8); return x == null ? null : (/^([01]\d|2[0-3]):[0-5]\d(:00)?$/.test(x) ? x.slice(0, 5) : 'bad'); };
      const a = hm(body.baseline_start), b = hm(body.baseline_end);
      if (a === 'bad' || b === 'bad') return json({ error: 'เวลา baseline ต้องเป็น HH:MM (24 ชม.)' }, 400);
      if ((a == null) !== (b == null)) return json({ error: 'ช่วง baseline ต้องมีทั้งเวลาเริ่มและเวลาจบ (หรือว่างทั้งคู่)' }, 400);
      if (a != null && b != null && a >= b) return json({ error: 'เวลาเริ่ม baseline ต้องก่อนเวลาจบ (ช่วงข้ามเที่ยงคืนยังไม่รองรับ)' }, 400);
      row.baseline_start = a; row.baseline_end = b;
    }
    const { count, error: ce } = await sb.from('energy_live_meters').select('scope_name', { count: 'exact', head: true }).eq('panel', panel);
    if (ce) return json({ error: ce.message }, 500);
    if (!count) return json({ error: `ไม่พบตู้ "${panel}" บนบอร์ด` }, 404);
    const { data, error } = await sb.from('energy_panel_settings')
      .upsert(row, { onConflict: 'panel' })
      .select('panel, demand_target_kw, baseline_start, baseline_end, updated_at, updated_by');
    if (error) return json({ error: error.message }, 500);
    if (!data?.length) return json({ error: 'บันทึกไม่สำเร็จ (0 แถว)' }, 500);
    return json({ ok: true, panel: data[0] });
  }

  const kind = str(body?.scope_kind, 10) || 'zone';
  const name = str(body?.scope_name, 200);
  if (!['zone', 'line'].includes(kind) || !name) return json({ error: 'ต้องระบุมิเตอร์ (scope_kind/scope_name)' }, 400);

  const { data: all, error: e0 } = await sb.from('energy_live_meters').select('scope_kind, scope_name, parent_name').eq('scope_kind', kind);
  if (e0) return json({ error: e0.message }, 500);
  const rows = all || [];
  const exists = rows.some(r => r.scope_name === name);

  if (body?.action === 'remove') {
    if (!exists) return json({ error: 'ไม่พบตู้นี้บนบอร์ด' }, 404);
    const kids = rows.filter(r => r.parent_name === name).map(r => r.scope_name);
    if (kids.length) return json({ error: `ลบไม่ได้ — มีตู้ลูกชี้มาอยู่ ${kids.length} ตู้ (${kids.join(', ')}) ย้ายแม่ของตู้ลูกก่อน` }, 409);
    const { data, error } = await sb.from('energy_live_meters').delete().eq('scope_kind', kind).eq('scope_name', name).select('scope_name');
    if (error) return json({ error: error.message }, 500);
    if (!data?.length) return json({ error: 'ไม่พบตู้นี้บนบอร์ด' }, 404);
    return json({ ok: true });
  }

  if (body?.action !== 'save') return json({ error: 'action ไม่รู้จัก' }, 400);
  const create = body?.create === true;
  if (create && exists) return json({ error: 'ตู้นี้อยู่บนบอร์ดแล้ว' }, 409);
  if (!create && !exists) return json({ error: 'ไม่พบตู้นี้บนบอร์ด' }, 404);
  if (create) {
    const { count, error } = await sb.from('energy_meter_topics').select('topic', { count: 'exact', head: true })
      .eq('scope_kind', kind).eq('scope_name', name);
    if (error) return json({ error: error.message }, 500);
    if (!count) return json({ error: 'มิเตอร์นี้ยังไม่ได้ผูก topic — ผูกที่หน้าการเชื่อมต่อก่อน' }, 400);
  }

  const panel = str(body?.panel, 80);
  if (!panel) return json({ error: 'ต้องระบุตู้ (panel)' }, 400);
  const parent = str(body?.parent_name, 200);
  if (parent) {
    if (parent === name) return json({ error: 'ตั้งแม่เป็นตัวเองไม่ได้' }, 400);
    const byName = new Map(rows.map(r => [r.scope_name, r.parent_name]));
    if (!byName.has(parent)) return json({ error: `ตู้แม่ "${parent}" ไม่อยู่บนบอร์ด` }, 400);
    byName.set(name, parent);
    const seen = new Set([name]);
    for (let x: string | null = parent; x; x = byName.get(x) || null) {
      if (seen.has(x)) return json({ error: 'ตั้งแม่แบบนี้จะวนกัน (แม่เป็นลูกหลานของตู้นี้)' }, 400);
      seen.add(x);
    }
  }
  const nums: Record<string, number | null> = {};
  for (const k of ['limit_kw', 'limit_a', 'gauge_max_kw']) {
    const v = num(body?.[k]);
    if (v === 'bad') return json({ error: `${k} ต้องเป็นตัวเลขไม่ติดลบ` }, 400);
    nums[k] = v;
  }
  if ('idle_kw' in (body || {})) {   // ไม่ส่งคีย์ = ไม่แตะค่าเดิม (ตัวเรียกรุ่นเก่าไม่ล้างเกณฑ์)
    const v = num(body.idle_kw);
    if (v === 'bad') return json({ error: 'เกณฑ์รอ (idle_kw) ต้องเป็นตัวเลขไม่ติดลบ' }, 400);
    nums.idle_kw = v;
  }
  const so = Number(body?.sort_order ?? 0);
  const row = {
    scope_kind: kind, scope_name: name, panel, parent_name: parent,
    display_name: str(body?.display_name, 80), subtitle: str(body?.subtitle, 120), ...nums,
    sort_order: Number.isFinite(so) ? Math.round(so) : 0,
    is_active: body?.is_active !== false,
    updated_at: new Date().toISOString(), updated_by: who,
  };
  const q = create
    ? sb.from('energy_live_meters').insert(row).select(COLS)
    : sb.from('energy_live_meters').update(row).eq('scope_kind', kind).eq('scope_name', name).select(COLS);
  const { data, error } = await q;
  if (error) return json({ error: error.message }, 500);
  if (!data?.length) return json({ error: 'บันทึกไม่สำเร็จ (0 แถว)' }, 500);
  return json({ ok: true, meter: data[0] });
});
