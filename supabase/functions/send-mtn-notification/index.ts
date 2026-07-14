// MTN Work-Order (ใบแจ้งซ่อม MO) Telegram notifications — Main project.
// แยกจาก send-notification (กันไฟล์ใหญ่พัง) แต่ใช้ตารางเดียวกัน:
//   notification_rules + telegram_channels (routing/toggle/template) →
//   event ปรากฏในหน้า /notification-config เหมือน event อื่น (category 'maintenance').
// Events: mtn_reported (แจ้งซ่อมใหม่) · mtn_assigned (รับงาน+ออกเลข MO) · mtn_closed (ปิด MO)
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

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });
const scopeLabel = (v: string) => (v === 'off_line' ? 'ซ่อมนอกไลน์' : 'ซ่อมในไลน์');

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

    const base = {
      mo_no: mo.mo_no || '(ยังไม่ออกเลข)', line_name: mo.line_name || '-', item_type: mo.item_type || '-',
      machine_no: mo.machine_no || '-', problem: mo.problem_characteristic || '-', scope: scopeLabel(mo.repair_scope),
      reporter: mo.reporter_prod || mo.reported_by_name || '-', repair_type: mo.repair_type || '-',
      assigned_to: mo.assigned_to || '-', tech_main: mo.tech_main || '-', solution: mo.solution || '-',
      approver: mo.approver_name || '-', note: mo.report_note || '',
    };
    let builtin = '';
    if (event === 'mtn_reported') {
      builtin = [`🛠️ <b>แจ้งซ่อมใหม่ — รอ MTN รับงาน</b>`, ``,
        `🏭 ไลน์: <b>${base.line_name}</b> · ${base.scope}`,
        `⚙️ อุปกรณ์: ${base.item_type} ${base.machine_no !== '-' ? base.machine_no : ''}`,
        `🛑 ปัญหา: ${base.problem}`, base.note ? `📝 ${base.note}` : ``,
        `🙋 ผู้แจ้ง: ${base.reporter}`, `— MTN Work-Order`].filter(Boolean).join('\n');
    } else if (event === 'mtn_assigned') {
      builtin = [`🔧 <b>รับงานซ่อม — ${base.mo_no}</b>`, ``,
        `🏭 ${base.line_name} · ${base.item_type} ${base.machine_no !== '-' ? base.machine_no : ''}`,
        `🛑 ${base.problem}`, `🧰 ประเภท: ${base.repair_type}`,
        `👷 มอบหมาย: ${base.assigned_to}`, `— MTN Work-Order`].filter(Boolean).join('\n');
    } else if (event === 'mtn_closed') {
      builtin = [`✅ <b>ปิด MO — ${base.mo_no}</b>`, ``,
        `🏭 ${base.line_name} · ${base.item_type} ${base.machine_no !== '-' ? base.machine_no : ''}`,
        `🛑 ${base.problem}`, `🛠 แก้ไข: ${base.solution}`, `👷 ช่าง: ${base.tech_main}`,
        `✍️ อนุมัติ: ${base.approver}`, `— MTN Work-Order`].filter(Boolean).join('\n');
    } else {
      return json({ error: 'unknown event' }, 400);
    }
    const message = pick(routes, event, base, builtin);
    await sendTelegram(message, chat).catch(console.error);
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
