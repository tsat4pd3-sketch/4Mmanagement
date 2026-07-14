// MTN Work-Order (ใบแจ้งซ่อม MO) Telegram notifications — Main project.
// รูปแบบข้อความ mirror ระบบ AppSheet เดิม (JIG MTN): แจ้งซ่อม → สรุปผลซ่อม → อนุมัติปิด
// แยกจาก send-notification (กันไฟล์ใหญ่พัง) แต่ route ผ่าน notification_rules + telegram_channels
// เดียวกัน → ปรับ/ปิด/เลือกห้อง/แก้ข้อความได้จาก /notification-config (category 'maintenance').
// Events: mtn_reported (แจ้งซ่อม+รูปก่อน) · mtn_repaired (สรุปผลซ่อม+รูปหลัง) · mtn_closed (อนุมัติปิด)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID');
let BOT_TOKEN: string | undefined = TELEGRAM_BOT_TOKEN;

async function getBotToken(): Promise<string | undefined> {
  try {
    const { data } = await supabase.from('notification_settings').select('bot_token').eq('id', 1).maybeSingle();
    const t = data?.bot_token ? String(data.bot_token).trim() : '';
    return t || TELEGRAM_BOT_TOKEN || undefined;
  } catch { return TELEGRAM_BOT_TOKEN || undefined; }
}

type Route = { enabled: boolean; chats: string[]; template?: string | null };
async function loadRoutes(): Promise<Record<string, Route>> {
  try {
    const [{ data: rules }, { data: channels }] = await Promise.all([
      supabase.from('notification_rules').select('event_key, is_enabled, channel_ids, channel_id, template'),
      supabase.from('telegram_channels').select('id, chat_id, is_active'),
    ]);
    const chatById = new Map<string, string>();
    for (const c of channels ?? []) if (c.is_active && c.chat_id) chatById.set(String(c.id), String(c.chat_id).trim());
    const map: Record<string, Route> = {};
    for (const r of rules ?? []) {
      const ids: string[] = Array.isArray((r as Record<string, unknown>).channel_ids)
        ? ((r as Record<string, unknown>).channel_ids as string[])
        : (r as { channel_id?: string }).channel_id ? [(r as { channel_id: string }).channel_id] : [];
      const chats = [...new Set(ids.map((id) => chatById.get(String(id))).filter((v): v is string => !!v))];
      map[r.event_key as string] = { enabled: r.is_enabled as boolean, chats, template: (r as { template?: string | null }).template };
    }
    return map;
  } catch { return {}; }
}
function resolveEvent(routes: Record<string, Route>, key: string): string[] | null {
  const r = routes[key];
  if (r && !r.enabled) return null;
  if (r && r.chats.length) return r.chats;
  return TELEGRAM_CHAT_ID ? [TELEGRAM_CHAT_ID] : [];
}
function renderTemplate(t: string, vars: Record<string, unknown>): string {
  return t.replace(/\{(\w+)\}/g, (_m, k) => { const v = vars[k as string]; return v == null ? '' : String(v); });
}
function pick(routes: Record<string, Route>, key: string, vars: Record<string, unknown>, builtin: string): string {
  const t = routes[key]?.template;
  return t && String(t).trim() ? renderTemplate(String(t), vars) : builtin;
}
async function sendTelegram(message: string, chats: string[]): Promise<boolean> {
  const list = [...new Set(chats.filter(Boolean))];
  if (!BOT_TOKEN || !list.length) return false;
  const res = await Promise.all(list.map((chat) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' }),
    }).then((r) => r.ok).catch(() => false)));
  return res.some(Boolean);
}
// ส่งรูป (caption = ข้อความ) — ถ้าไม่มีรูป/ส่งรูปไม่ผ่าน ตกไปส่งเป็นข้อความล้วน
async function sendTelegramPhoto(photoUrl: string, caption: string, chats: string[]) {
  const list = [...new Set(chats.filter(Boolean))];
  if (!BOT_TOKEN || !list.length) return;
  const cap = caption.length > 1000 ? caption.slice(0, 1000) : caption; // Telegram caption cap ~1024
  await Promise.all(list.map((chat) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, photo: photoUrl, caption: cap, parse_mode: 'HTML' }),
    }).then((r) => r.ok).catch(() => false)));
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

// วันเวลาแบบไทย (พ.ศ.) MM/DD/YYYY HH:MM:SS — เหมือนใบเดิม
function beDateTime(iso?: string | null): string {
  if (!iso) return '';
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date(iso));
  const g: Record<string, string> = {}; for (const x of p) g[x.type] = x.value;
  const be = String(Number(g.year) + 543);
  let hh = g.hour === '24' ? '00' : g.hour;
  return `${g.month}/${g.day}/${be} ${hh}:${g.minute}:${g.second}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json();
    const { event, mo } = body;
    if (!mo) return json({ error: 'missing mo' }, 400);
    BOT_TOKEN = await getBotToken();
    const routes = await loadRoutes();
    const chat = resolveEvent(routes, event);
    if (chat === null) return json({ ok: true, skipped: true });

    const v = {
      mo_no: mo.mo_no || '(ยังไม่ออกเลข)', line_name: mo.line_name || '-', item_type: mo.item_type || '-',
      machine_no: mo.machine_no || '', problem: mo.problem_characteristic || '-',
      reporter_prod: mo.reporter_prod || mo.reported_by_name || '', reporter_qa: mo.reporter_qa || '',
      want_at: beDateTime(mo.want_at), tech_main: mo.tech_main || mo.assigned_to || '-',
      root_cause: mo.root_cause || '-', solution: mo.solution || '-', approver: mo.approver_name || '-',
    };
    let builtin = ''; let photo: string | null = null;
    if (event === 'mtn_reported') {
      builtin = [`🛠️ <b>แจ้งซ่อม JIG MTN</b>`,
        `ไลน์การผลิต: ${v.line_name}`, `ชื่อรายการ: ${v.item_type}${v.machine_no ? ` (${v.machine_no})` : ''}`,
        `ปัญหา: ${v.problem}`, `PD ผู้แจ้ง: ${v.reporter_prod}`, `QA ผู้แจ้ง: ${v.reporter_qa}`,
        v.want_at ? `เป้าหมาย: ${v.want_at}` : '', `สถานะ: รอดำเนินการ`].filter(Boolean).join('\n');
      photo = mo.before_img || null;
    } else if (event === 'mtn_repaired') {
      builtin = [`🔧 <b>สรุปผลซ่อม JIG MTN</b>`,
        `ไลน์การผลิต: ${v.line_name}`, `ชื่อรายการ: ${v.item_type}${v.machine_no ? ` (${v.machine_no})` : ''}`,
        `ปัญหา: ${v.problem}`, ``,
        `เลขแจ้งซ่อม: <b>${v.mo_no}</b>`, `ช่างซ่อม: ${v.tech_main}`,
        `สาเหตุ: ${v.root_cause}`, `วิธีแก้ไข: ${v.solution}`].filter(Boolean).join('\n');
      photo = mo.after_img || null;
    } else if (event === 'mtn_closed') {
      builtin = [`✅ <b>อนุมัติปิดแจ้งซ่อม</b>`,
        `ไลน์การผลิต: ${v.line_name}`, `ชื่อรายการ: ${v.item_type}${v.machine_no ? ` (${v.machine_no})` : ''}`,
        `ปัญหา: ${v.problem}`, ``,
        `เลขแจ้งซ่อม: <b>${v.mo_no}</b>`, `ช่างซ่อม: ${v.tech_main}`,
        `สาเหตุ: ${v.root_cause}`, `วิธีแก้ไข: ${v.solution}`, `ผู้อนุมัติ: ${v.approver}`].filter(Boolean).join('\n');
      photo = mo.after_img || null;
    } else {
      return json({ error: 'unknown event' }, 400);
    }
    const message = pick(routes, event, v, builtin);
    if (photo) await sendTelegramPhoto(photo, message, chat).catch(console.error);
    else await sendTelegram(message, chat).catch(console.error);
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
