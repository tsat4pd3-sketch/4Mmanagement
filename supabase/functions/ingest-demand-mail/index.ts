/* 📬 ingest-demand-mail — รับไฟล์แนบจากเมล (EDI 830/862) เข้าคิว `demand_mail_inbox`
   Project: DR ("Product DB") · verify_jwt = false (สคริปต์บนเครื่อง user ไม่มี JWT — ใช้ token แทน)

   สายงาน: Outlook → tools/outlook-mail-ingest/esm_mail_ingest.py → ที่นี่ → Storage `demand-mail` + แถวคิว
           → /planner-sales แผง 📬 → ตัวอ่าน EDI เดิมในแอป
   🔴 ฟังก์ชันนี้ **ไม่แกะไฟล์** — แค่เก็บเข้าคิว (ตัวอ่าน 830/862 มีที่เดียวคือ PlannerSales.jsx)

   auth: header `x-ingest-token` → sha256 → ต้องตรงแถว `demand_mail_tokens` ที่ is_active
   body: { action?: 'ping', message_id, subject, sender, received_at, host,
           files: [{ name, content_b64 }] }
   ตอบ:  { ok, saved: [..ชื่อไฟล์], duplicate: [..], rejected: [{name, reason}] }
   secrets: SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY (มีให้อัตโนมัติ) — ไม่ต้องตั้งเพิ่ม */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const OK_EXT = /\.(xlsx|xlsm|xlsb|xls|csv)$/i;
const MAX_BYTES = 20 * 1024 * 1024;

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** ชื่อไฟล์ปลอดภัยสำหรับ path ใน storage (ชื่อจริงเก็บในคอลัมน์ file_name) */
const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const token = req.headers.get('x-ingest-token') || '';
  if (token.length < 20) return json({ error: 'unauthorized' }, 401);

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: tok, error: tokErr } = await sb.from('demand_mail_tokens')
    .select('id').eq('token_sha256', await sha256(token)).eq('is_active', true).maybeSingle();
  if (tokErr) return json({ error: tokErr.message }, 500);
  if (!tok) return json({ error: 'unauthorized' }, 401);
  await sb.from('demand_mail_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tok.id);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (body?.action === 'ping') return json({ ok: true, pong: true });

  /* 🔎 ตรวจไฟล์ในคิว (2026-10-01) — ไฟล์จากเมลอ่านไม่ออกบนจอ ต้องแยกให้ได้ว่า
     "ไฟล์เสียระหว่างทาง" หรือ "ตัวอ่านในแอป" · อ่านอย่างเดียว คืนลายเซ็นไฟล์ + ชื่อชีต + แถวหัว */
  if (body?.action === 'inspect') {
    const { data: row, error: rErr } = await sb.from('demand_mail_inbox')
      .select('file_name, storage_path, size_bytes').eq('id', String(body.id || '')).maybeSingle();
    if (rErr || !row) return json({ error: rErr?.message || 'not found' }, 404);
    const { data: blob, error: dErr } = await sb.storage.from('demand-mail').download(row.storage_path);
    if (dErr || !blob) return json({ error: dErr?.message || 'download failed' }, 500);
    const buf = new Uint8Array(await blob.arrayBuffer());
    const head = [...buf.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join(' ');
    const XLSX = await import('npm:xlsx@0.18.5');
    let sheets: unknown = null, readErr: string | null = null;
    try {
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      sheets = wb.SheetNames.map((n: string) => {
        const m = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) as unknown[][];
        return { name: n, rows: m.length, first: m.slice(0, 3).map(r => r.slice(0, 6).map(c => String(c).slice(0, 30))) };
      });
    } catch (e) { readErr = String(e); }
    return json({ file: row.file_name, stored: row.size_bytes, actual: buf.length, head, readErr, sheets });
  }

  const messageId = String(body?.message_id || '').trim();
  const files: any[] = Array.isArray(body?.files) ? body.files : [];
  if (!messageId) return json({ error: 'message_id required' }, 400);
  if (!files.length) return json({ ok: true, saved: [], duplicate: [], rejected: [] });

  const saved: string[] = [], duplicate: string[] = [], rejected: { name: string; reason: string }[] = [];
  const month = new Date().toISOString().slice(0, 7);

  for (const f of files) {
    const name = String(f?.name || '').trim();
    if (!name || !OK_EXT.test(name)) { rejected.push({ name, reason: 'ไม่ใช่ไฟล์ Excel/CSV' }); continue; }
    const { data: dup, error: dupErr } = await sb.from('demand_mail_inbox')
      .select('id').eq('message_id', messageId).eq('file_name', name).maybeSingle();
    if (dupErr) return json({ error: dupErr.message }, 500);
    if (dup) { duplicate.push(name); continue; }

    let bytes: Uint8Array;
    try { bytes = b64ToBytes(String(f.content_b64 || '')); } catch { rejected.push({ name, reason: 'base64 เสีย' }); continue; }
    if (!bytes.length) { rejected.push({ name, reason: 'ไฟล์ว่าง' }); continue; }
    if (bytes.length > MAX_BYTES) { rejected.push({ name, reason: 'ใหญ่เกิน 20MB' }); continue; }

    const path = `${month}/${crypto.randomUUID()}_${safeName(name)}`;
    const { error: upErr } = await sb.storage.from('demand-mail').upload(path, bytes, {
      contentType: 'application/octet-stream', cacheControl: '31536000', upsert: false,
    });
    if (upErr) return json({ error: `upload ${name}: ${upErr.message}`, saved, duplicate, rejected }, 500);

    const { error: insErr } = await sb.from('demand_mail_inbox').insert({
      message_id: messageId, file_name: name, storage_path: path, size_bytes: bytes.length,
      subject: body.subject ?? null, sender: body.sender ?? null,
      received_at: body.received_at || null, source_host: body.host ?? null,
    });
    if (insErr) {
      await sb.storage.from('demand-mail').remove([path]);      // ไม่ทิ้งไฟล์กำพร้า
      if (insErr.code === '23505') { duplicate.push(name); continue; }
      return json({ error: `insert ${name}: ${insErr.message}`, saved, duplicate, rejected }, 500);
    }
    saved.push(name);
  }
  return json({ ok: true, saved, duplicate, rejected });
});
