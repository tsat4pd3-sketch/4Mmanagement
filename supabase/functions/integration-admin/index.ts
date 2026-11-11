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
   🔴 รายชื่อชนิดข้างล่างต้องตรง src/utils/integrationKinds.js (edge import จาก src/ ไม่ได้) */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MAIN_URL = 'https://ewhdfqwfwofivojtsizn.supabase.co';
const KINDS = ['energy_readings', 'energy_events', 'energy_daily', 'energy_limits', 'machine_state', 'piece_count'];
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
const cleanKinds = (k: unknown) => (Array.isArray(k) ? [...new Set(k.map(String))].filter(x => KINDS.includes(x)) : null);
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
      const kinds = cleanKinds(body.kinds);
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
      if ('kinds' in body) { const k = cleanKinds(body.kinds); if (!k?.length) return json({ error: 'เลือกชนิดข้อมูลอย่างน้อย 1 ชนิด' }, 400); f.kinds = k; }
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
    default:
      return json({ error: 'unknown action' }, 400);
  }
});
