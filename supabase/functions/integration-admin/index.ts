/* 🔌 integration-admin — จัดการทะเบียนต้นทางของศูนย์เชื่อมต่อ (integration_sources · DR)
   Project: DR ("Product DB") · verify_jwt = true (ผ่านด้วย anon key ของ DR ที่ supabaseDR ส่งอยู่แล้ว —
            ด่านจริง = token ล็อกอินของ Main ที่ตรวจเองข้างล่าง · แบบเดียวกับ demand-mail-file)
   2026-11-11 · 📄 docs/modules/integration-hub.md

   ทำไมต้องผ่าน edge: ตาราง DR client เป็น anon เสมอ ⇒ ถ้าให้ client เขียนเอง ใครถือ anon key
   (ฝังในบันเดิลเว็บ) ก็สร้างต้นทาง + ได้รหัสลับไปยิงข้อมูลปลอมเข้าระบบได้

   auth: header `x-esm-token` (access token ของ Main) + `x-esm-apikey` (anon key ของ Main — สาธารณะอยู่แล้ว)
         → Main /auth/v1/user 200 → rpc has_perm('integration:manage') = true
   body: { action, ... }
     create  { code, name, note?, kinds[] }  → { source, key }   (key แสดงครั้งเดียว · เก็บแค่ sha256)
     rotate  { id }                         → { key }
     update  { id, name?, note?, kinds? }
     pause   { id } · resume { id }
     legacy_off { id }   เลิกรับ secret กลาง (หลังต้นทางเปลี่ยนไปใช้รหัสของตัวเองแล้ว)
     map_tag    { id, tag, machine_id|null }          ผูก/เลิกผูก รหัสเครื่องของต้นทาง → machines.id (null = ลบการผูก)
     map_reason { id, kind, code, text?, downtime_type_id|null, is_break?, clear? }
                is_break = เหตุผลนี้คือกดพักหน้าเครื่อง (เฉพาะ onplan) — ESM คิดเวลาพักจากนโยบาย · ส่วนเกิน = เสีย A (16/11)
                เหตุผลหยุดของต้นทาง → dr_downtime_types (null = ยืนยันว่า "ไม่มีตัวตรง" · clear = ลบการจับคู่)
                🔴 คนกดเท่านั้น — จอเสนอได้ แต่ห้ามเรียก action นี้อัตโนมัติ
     kind_create { key, label, icon?, unit?, help?, sort_order? }   เพิ่มชนิดข้อมูลเซนเซอร์ (27/11 · ข้อมูลเข้า sensor_readings)
     kind_update { key, label?, icon?, unit?, help?, sort_order? }  ชนิดในตัว (is_builtin) แก้ได้แค่ label/icon/help
     kind_delete { key }   ห้ามลบชนิดในตัว · มีต้นทางเลือกอยู่ / มีข้อมูลอยู่ = ห้ามลบ (นับไม่ได้ = ห้ามลบ)
   ชนิดข้อมูลอ่านจากตาราง integration_kinds (27/11 · เดิม hardcode) — อ่านไม่ได้ = ไม่ให้บันทึก (fail-closed) */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MAIN_URL = 'https://ewhdfqwfwofivojtsizn.supabase.co';
const COLS = 'id, code, name, note, kinds, key_hint, legacy_secret, is_paused, last_seen_at, last_ok_at, last_error, updated_at, updated_by';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-esm-token, x-esm-apikey',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function newKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return 'esm_' + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const cleanKinds = (k: unknown, known: Set<string>) => (Array.isArray(k) ? [...new Set(k.map(String))].filter(x => known.has(x)) : null);
const KIND_COLS = 'key, label, icon, unit, help, is_builtin, sort_order, updated_at, updated_by';
const str = (v: unknown, max: number) => (v == null ? null : String(v).trim().slice(0, max) || null);

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
    body: JSON.stringify({ perm_key: 'integration:manage' }),
  });
  if (!(p.ok && (await p.json()) === true)) return json({ error: 'ไม่มีสิทธิ์จัดการการเชื่อมต่อ (integration:manage)' }, 403);
  const who = String(user?.email || user?.id || '').slice(0, 120) || null;

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = new Date().toISOString();
  const id = str(body?.id, 64);
  /* ทะเบียนชนิดข้อมูล — โหลดเมื่อ action ต้องใช้ · อ่านไม่ได้ = หยุด (ห้ามถือว่า "ไม่มีชนิด") */
  const knownKinds = async (): Promise<Set<string> | Response> => {
    const { data, error } = await sb.from('integration_kinds').select('key');
    if (error) return json({ error: `อ่านทะเบียนชนิดข้อมูลไม่ได้: ${error.message}` }, 500);
    return new Set((data || []).map((r: any) => r.key));
  };

  /* อัปเดตแถวเดียว · 0 แถว = ไม่พบ (ห้ามตอบสำเร็จเงียบ) */
  const patch = async (fields: Record<string, unknown>) => {
    const { data, error } = await sb.from('integration_sources')
      .update({ ...fields, updated_at: now, updated_by: who }).eq('id', id).select(COLS);
    if (error) return json({ error: error.message }, 500);
    if (!data?.length) return json({ error: 'ไม่พบต้นทางนี้' }, 404);
    return null;
  };

  switch (body?.action) {
    case 'create': {
      const code = str(body.code, 40)?.toLowerCase() || '';
      const name = str(body.name, 120);
      const known = await knownKinds();
      if (known instanceof Response) return known;
      const kinds = cleanKinds(body.kinds, known);
      if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(code)) return json({ error: 'รหัสต้นทางใช้ได้แค่ a-z 0-9 - _ (2-40 ตัว)' }, 400);
      if (!name) return json({ error: 'ต้องมีชื่อต้นทาง' }, 400);
      if (!kinds?.length) return json({ error: 'เลือกชนิดข้อมูลอย่างน้อย 1 ชนิด' }, 400);
      const key = newKey();
      const { data, error } = await sb.from('integration_sources').insert({
        code, name, note: str(body.note, 300), kinds, key_hash: await sha256Hex(key), key_hint: key.slice(-4),
        legacy_secret: false, updated_by: who,
      }).select(COLS).single();
      if (error) return json({ error: error.code === '23505' ? `รหัส "${code}" มีอยู่แล้ว` : error.message }, error.code === '23505' ? 409 : 500);
      return json({ ok: true, source: data, key });
    }
    case 'rotate': {
      if (!id) return json({ error: 'id required' }, 400);
      const key = newKey();
      const bad = await patch({ key_hash: await sha256Hex(key), key_hint: key.slice(-4) });
      return bad || json({ ok: true, key });
    }
    case 'update': {
      if (!id) return json({ error: 'id required' }, 400);
      const f: Record<string, unknown> = {};
      if ('name' in body) { const n = str(body.name, 120); if (!n) return json({ error: 'ต้องมีชื่อต้นทาง' }, 400); f.name = n; }
      if ('note' in body) f.note = str(body.note, 300);
      if ('kinds' in body) {
        const known = await knownKinds();
        if (known instanceof Response) return known;
        const k = cleanKinds(body.kinds, known); if (!k?.length) return json({ error: 'เลือกชนิดข้อมูลอย่างน้อย 1 ชนิด' }, 400); f.kinds = k;
      }
      const bad = await patch(f);
      return bad || json({ ok: true });
    }
    case 'pause': case 'resume': {
      if (!id) return json({ error: 'id required' }, 400);
      const bad = await patch({ is_paused: body.action === 'pause' });
      return bad || json({ ok: true });
    }
    case 'legacy_off': {
      if (!id) return json({ error: 'id required' }, 400);
      const { data: row } = await sb.from('integration_sources').select('key_hash').eq('id', id).maybeSingle();
      if (!row?.key_hash) return json({ error: 'ออกรหัสของต้นทางนี้ก่อน แล้วให้ Node-RED เปลี่ยนไปใช้ — ไม่งั้นข้อมูลจะหยุดเข้าทันที' }, 409);
      const bad = await patch({ legacy_secret: false });
      return bad || json({ ok: true });
    }
    case 'map_tag': {
      if (!id) return json({ error: 'id required' }, 400);
      const tag = str(body.tag, 80);
      if (!tag) return json({ error: 'ต้องระบุรหัสเครื่องของต้นทาง' }, 400);
      const mid = str(body.machine_id, 64);
      if (!mid) {
        const { error } = await sb.from('machine_tag_map').delete().eq('source_id', id).eq('tag', tag);
        return error ? json({ error: error.message }, 500) : json({ ok: true });
      }
      const { data: m } = await sb.from('machines').select('id').eq('id', mid).maybeSingle();
      if (!m) return json({ error: 'ไม่พบเครื่องนี้ในทะเบียน' }, 404);
      const { error } = await sb.from('machine_tag_map').upsert(
        { source_id: id, tag, machine_id: mid, confirmed_by: who, confirmed_at: now }, { onConflict: 'source_id,tag' });
      return error ? json({ error: error.message }, 500) : json({ ok: true });
    }
    case 'map_reason': {
      if (!id) return json({ error: 'id required' }, 400);
      const kind = ['onplan', 'unplan', 'alarm'].includes(body.kind) ? body.kind : null;
      const code = Number.isInteger(Number(body.code)) && body.code !== '' && body.code != null ? Number(body.code) : null;
      if (!kind || code == null) return json({ error: 'ต้องระบุชนิด (onplan/unplan/alarm) + รหัสเหตุผล' }, 400);
      if (body.clear) {
        const { error } = await sb.from('machine_reason_map').delete().eq('source_id', id).eq('reason_kind', kind).eq('reason_code', code);
        return error ? json({ error: error.message }, 500) : json({ ok: true });
      }
      const dt = str(body.downtime_type_id, 64);
      if (dt) {
        const { data: t } = await sb.from('dr_downtime_types').select('id').eq('id', dt).maybeSingle();
        if (!t) return json({ error: 'ไม่พบประเภท downtime นี้' }, 404);
      }
      const { error } = await sb.from('machine_reason_map').upsert({
        source_id: id, reason_kind: kind, reason_code: code, reason_text: str(body.text, 200),
        downtime_type_id: body.is_break ? null : dt, is_break: kind === 'onplan' && !!body.is_break, confirmed_by: who, confirmed_at: now,
      }, { onConflict: 'source_id,reason_kind,reason_code' });
      return error ? json({ error: error.message }, 500) : json({ ok: true });
    }
    case 'kind_create': case 'kind_update': {
      const key = str(body.key, 40)?.toLowerCase() || '';
      if (!/^[a-z][a-z0-9_]{1,39}$/.test(key)) return json({ error: 'รหัสชนิดใช้ได้แค่ a-z 0-9 _ ขึ้นต้นด้วยตัวอักษร (2-40 ตัว)' }, 400);
      const f: Record<string, unknown> = { updated_at: now, updated_by: who };
      if (body.action === 'kind_create' || 'label' in body) {
        const l = str(body.label, 80); if (!l) return json({ error: 'ต้องมีชื่อชนิดข้อมูล' }, 400); f.label = l;
      }
      if ('icon' in body) f.icon = str(body.icon, 8);
      if ('help' in body) f.help = str(body.help, 300);
      const custom: Record<string, unknown> = {};
      if ('unit' in body) custom.unit = str(body.unit, 20);
      if ('sort_order' in body) { const so = Number(body.sort_order); custom.sort_order = Number.isFinite(so) ? Math.round(so) : 0; }
      if (body.action === 'kind_create') {
        const { data, error } = await sb.from('integration_kinds')
          .insert({ key, ...f, ...custom, is_builtin: false }).select(KIND_COLS).single();
        if (error) return json({ error: error.code === '23505' ? `รหัสชนิด "${key}" มีอยู่แล้ว` : error.message }, error.code === '23505' ? 409 : 500);
        return json({ ok: true, kind: data });
      }
      const { data: cur, error: e1 } = await sb.from('integration_kinds').select('is_builtin').eq('key', key).maybeSingle();
      if (e1) return json({ error: e1.message }, 500);
      if (!cur) return json({ error: 'ไม่พบชนิดข้อมูลนี้' }, 404);
      // ชนิดในตัว: โค้ดมีปลายทางเฉพาะ ⇒ แก้ได้แค่ชื่อ/ไอคอน/คำอธิบาย (คำสั่ง user 27/11)
      if (cur.is_builtin && Object.keys(custom).length) return json({ error: 'ชนิดในตัวแก้ได้แค่ชื่อ ไอคอน และคำอธิบาย' }, 400);
      const { data, error } = await sb.from('integration_kinds').update({ ...f, ...custom }).eq('key', key).select(KIND_COLS);
      if (error) return json({ error: error.message }, 500);
      if (!data?.length) return json({ error: 'ไม่พบชนิดข้อมูลนี้' }, 404);
      return json({ ok: true, kind: data[0] });
    }
    case 'kind_delete': {
      const key = str(body.key, 40) || '';
      const { data: cur, error: e1 } = await sb.from('integration_kinds').select('is_builtin, label').eq('key', key).maybeSingle();
      if (e1) return json({ error: e1.message }, 500);
      if (!cur) return json({ error: 'ไม่พบชนิดข้อมูลนี้' }, 404);
      if (cur.is_builtin) return json({ error: 'ชนิดในตัวลบไม่ได้ — โค้ดมีปลายทางรับข้อมูลชนิดนี้อยู่' }, 409);
      // ทะเบียนจับคู่ด้วยข้อความ (integration_sources.kinds) — นับปลายทางให้ครบก่อนลบ · นับไม่ได้ = ห้ามลบ
      const { data: srcs, error: e2 } = await sb.from('integration_sources').select('name').contains('kinds', [key]);
      if (e2) return json({ error: `ตรวจต้นทางที่ใช้ชนิดนี้ไม่ได้: ${e2.message}` }, 500);
      if (srcs?.length) return json({ error: `ลบไม่ได้ — ต้นทาง ${srcs.map((x: any) => x.name).join(', ')} ยังเลือกชนิดนี้อยู่ (เอาออกจากต้นทางก่อน)` }, 409);
      const [r1, r2] = await Promise.all([
        sb.from('sensor_readings').select('kind_key', { count: 'exact', head: true }).eq('kind_key', key),
        sb.from('sensor_daily').select('kind_key', { count: 'exact', head: true }).eq('kind_key', key),
      ]);
      if (r1.error || r2.error) return json({ error: `นับข้อมูลของชนิดนี้ไม่ได้: ${(r1.error || r2.error)!.message}` }, 500);
      const n = (r1.count || 0) + (r2.count || 0);
      if (n) return json({ error: `ลบไม่ได้ — มีข้อมูลของชนิดนี้อยู่ ${n.toLocaleString()} แถว (ประวัติจะหาย)` }, 409);
      const { data, error } = await sb.from('integration_kinds').delete().eq('key', key).eq('is_builtin', false).select('key');
      if (error) return json({ error: error.message }, 500);
      if (!data?.length) return json({ error: 'ลบไม่สำเร็จ (0 แถว)' }, 500);
      return json({ ok: true });
    }
    default:
      return json({ error: 'unknown action' }, 400);
  }
});
