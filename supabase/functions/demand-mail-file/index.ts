/* 📬 demand-mail-file — ส่งไฟล์ EDI 830/862 จากคิว `demand_mail_inbox` ให้คนที่ล็อกอินแล้วเท่านั้น
   Project: DR ("Product DB") · verify_jwt = true (ผ่านด้วย anon key ของ DR ที่ supabaseDR ส่งอยู่แล้ว —
            ด่านจริงคือ token ของ Main ที่ตรวจเองข้างล่าง เพราะ user ล็อกอินที่ Main ไม่ใช่ DR)
   2026-10-06 · ปิดช่องโหว่ B5: เดิม bucket `demand-mail` เปิดให้ anon อ่าน ⇒ ใครถือ anon key
   (ฝังอยู่ในบันเดิลเว็บ) ก็ดาวน์โหลดยอดสั่งลูกค้าได้โดยไม่ต้องล็อกอิน

   auth: header `x-esm-token` = access token ของ Main (supabase.auth.getSession())
         header `x-esm-apikey` = anon key ของ Main (สาธารณะอยู่แล้ว — ใช้แค่ให้ Main รับคำขอ)
         → Main /auth/v1/user ต้องตอบ 200 (token จริง ยังไม่หมดอายุ)
         → Main rpc has_perm('demand:upload') หรือ has_perm('page:/planner-sales') ต้องเป็น true
   body: { id }  (demand_mail_inbox.id)
   ตอบ:  ไฟล์ดิบ (application/octet-stream) · ผิด = JSON { error } + 401/403/404/500
   🔴 ฟังก์ชันนี้ไม่แกะไฟล์ — ตัวอ่าน 830/862 มีที่เดียวคือ PlannerSales.jsx */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MAIN_URL = 'https://ewhdfqwfwofivojtsizn.supabase.co';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-esm-token, x-esm-apikey',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

async function mainPerm(token: string, apikey: string, key: string) {
  const r = await fetch(`${MAIN_URL}/rest/v1/rpc/has_perm`, {
    method: 'POST',
    headers: { apikey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ perm_key: key }),
  });
  return r.ok && (await r.json()) === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const token = req.headers.get('x-esm-token') || '';
  const apikey = req.headers.get('x-esm-apikey') || '';
  if (!token || !apikey) return json({ error: 'ต้องล็อกอินก่อน' }, 401);

  const u = await fetch(`${MAIN_URL}/auth/v1/user`, { headers: { apikey, authorization: `Bearer ${token}` } });
  if (!u.ok) return json({ error: 'ล็อกอินหมดอายุ — ออกแล้วเข้าระบบใหม่' }, 401);

  const allowed = await mainPerm(token, apikey, 'demand:upload') || await mainPerm(token, apikey, 'page:/planner-sales');
  if (!allowed) return json({ error: 'ไม่มีสิทธิ์เปิดไฟล์ยอดสั่งลูกค้า' }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const id = String(body?.id || '');
  if (!id) return json({ error: 'id required' }, 400);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: row, error: rErr } = await sb.from('demand_mail_inbox')
    .select('storage_path, file_name').eq('id', id).maybeSingle();
  if (rErr) return json({ error: rErr.message }, 500);
  if (!row) return json({ error: 'ไม่พบไฟล์ในคิว' }, 404);

  const { data: blob, error: dErr } = await sb.storage.from('demand-mail').download(row.storage_path);
  if (dErr || !blob) return json({ error: dErr?.message || 'ดาวน์โหลดไม่สำเร็จ' }, 500);
  return new Response(blob, {
    status: 200,
    headers: { ...CORS, 'content-type': 'application/octet-stream', 'cache-control': 'no-store' },
  });
});
