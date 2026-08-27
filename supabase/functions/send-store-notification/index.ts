// 🚨 send-store-notification — แจ้งเตือนฝั่ง Store/Logistic  (Main project)
//
// ⚠️ แยกไฟล์จาก send-notification โดยตั้งใจ (กันไฟล์ 47KB พัง) แต่ **route ผ่าน
//    notification_rules / telegram_channels ชุดเดียวกัน** → เปิด/ปิด/เลือกห้อง/แก้ข้อความ/
//    เลือก role ที่เข้ากระดิ่ง ทำที่ /notification-config เหมือนทุกเรื่อง
//    (precedent เดียวกับ send-mtn-notification · ดู CLAUDE.md ตาราง Edge Functions)
//
// event ที่รับ: `store_abnormal` — สรุปเคสผิดปกติของสโตร์จาก edge `store-daily-scan` (DR)
//   ยิงรวมครั้งเดียวต่อรอบสแกน ไม่ยิงรายรายการ
//   (บทเรียนจาก shipping_phase_alert ที่ยิง 592 ครั้งใน 4 วันจนไม่มีใครอ่าน)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID');

let BOT_TOKEN: string | undefined = TELEGRAM_BOT_TOKEN;
async function getBotToken(): Promise<string | undefined> {
  try {
    const { data } = await supabase.from('notification_settings').select('bot_token').eq('id', 1).maybeSingle();
    const t = data?.bot_token ? String(data.bot_token).trim() : '';
    return t || TELEGRAM_BOT_TOKEN || undefined;
  } catch { return TELEGRAM_BOT_TOKEN || undefined; }
}

type Route = { enabled: boolean; chats: string[]; template?: string | null; label?: string; inappRoles?: string[] };
async function loadRoutes(): Promise<Record<string, Route>> {
  try {
    const [{ data: rules }, { data: channels }] = await Promise.all([
      supabase.from('notification_rules').select('event_key, is_enabled, channel_ids, channel_id, template, label, inapp_roles'),
      supabase.from('telegram_channels').select('id, chat_id, is_active'),
    ]);
    const chatById = new Map<string, string>();
    for (const c of channels ?? []) if (c.is_active && c.chat_id) chatById.set(String(c.id), String(c.chat_id).trim());
    const map: Record<string, Route> = {};
    for (const r of rules ?? []) {
      const ids: string[] = Array.isArray(r.channel_ids) ? r.channel_ids as string[] : (r.channel_id ? [r.channel_id as string] : []);
      map[r.event_key as string] = {
        enabled: r.is_enabled as boolean,
        chats: [...new Set(ids.map((id) => chatById.get(String(id))).filter((v): v is string => !!v))],
        template: (r as { template?: string | null }).template,
        label: (r as { label?: string }).label,
        inappRoles: Array.isArray((r as { inapp_roles?: string[] }).inapp_roles) ? (r as { inapp_roles: string[] }).inapp_roles : [],
      };
    }
    return map;
  } catch { return {}; }
}
function pick(routes: Record<string, Route>, key: string, vars: Record<string, unknown>, builtin: string): string {
  const t = routes[key]?.template;
  if (!t || !String(t).trim()) return builtin;
  return String(t).replace(/\{(\w+)\}/g, (_m, k) => { const v = vars[k as string]; return v == null ? '' : String(v); });
}
function resolveEvent(routes: Record<string, Route>, key: string): string[] | null {
  const r = routes[key];
  if (r && !r.enabled) return null;               // ปิดไว้ที่ /notification-config = เงียบ
  if (r && r.chats.length) return r.chats;
  return TELEGRAM_CHAT_ID ? [TELEGRAM_CHAT_ID] : [];
}
async function sendTelegram(message: string, chatId?: string[] | null): Promise<boolean> {
  const chats = [...new Set((chatId ?? (TELEGRAM_CHAT_ID ? [TELEGRAM_CHAT_ID] : [])).filter(Boolean))];
  if (!BOT_TOKEN || !chats.length) return false;
  const res = await Promise.all(chats.map((chat) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' }),
    }).then((r) => r.ok).catch(() => false)));
  return res.some(Boolean);
}
// แจ้งในแอป (กระดิ่ง + เสียง + Web Push ผ่าน trigger trg_notify_push)
// ⚠️ ผู้รับมาจาก RPC `notify_recipients` จุดเดียวของระบบ (role × ส่วนงาน × แผนก)
//    ตั้งที่ /notification-config — **ห้ามกรองด้วย role อย่างเดียวในไฟล์นี้**
async function notifyInApp(routes: Record<string, Route>, event: string, htmlMessage: string) {
  const roles = routes[event]?.inappRoles ?? [];
  if (!roles.length) return;                    // ไม่ตั้ง role = ไม่แจ้งในแอป
  let ids: string[] = [];
  try {
    const { data, error } = await supabase.rpc('notify_recipients', { p_event: event, p_section: null });
    if (error) throw error;
    ids = (data ?? []).map((r: unknown) =>
      typeof r === 'string' ? r : (r as { notify_recipients?: string })?.notify_recipients).filter(Boolean) as string[];
  } catch (e) {
    console.error('notify_recipients', e);      // RPC ล่ม = ถอยไปตาม role ห้ามเงียบ
    const { data } = await supabase.from('profiles').select('id').in('role', roles);
    ids = (data ?? []).map((p) => p.id as string);
  }
  ids = [...new Set(ids)].filter(Boolean);
  if (!ids.length) return;
  const title = routes[event]?.label || event;
  const body = String(htmlMessage).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
  try {
    await supabase.from('notifications').insert(ids.map((uid) => ({ user_id: uid, title, body, type: 'info' })));
  } catch (e) { console.error('insertNotifications', e); }
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json();
    const { event } = body;
    BOT_TOKEN = await getBotToken();
    const routes = await loadRoutes();

    if (event === 'store_abnormal') {
      const a = body.alert;
      if (!a) return new Response('missing alert', { status: 400 });
      const chat = resolveEvent(routes, 'store_abnormal');
      if (chat === null) return json({ ok: true, skipped: true });
      type Item = { line?: string; mat?: string; part?: string; detail?: string };
      const groups: { code?: string; title?: string; kind?: string; count?: number; items?: Item[] }[] =
        Array.isArray(a.groups) ? a.groups : [];
      const lines = [
        `🚨 <b>เฝ้าระวังสโตร์ — พบ ${a.total} รายการ</b>`, ``,
        `📅 วันงาน: ${a.work_date}`,
        `🟥 จะขาด ${a.shortage} · 🟧 ล้น ${a.over}`,
      ];
      /* ⚠️ ดึงแถวมาไม่ครบ (ชนเพดานหน้า) = ตัวเลขแยกรายกลุ่มข้างล่างยังไม่ครบ — ต้องบอก ห้ามเงียบ
         หัวข้อ "พบ N รายการ" เป็นของจริงเสมอ (มาจาก head-count) จึงไม่ต้องแก้ */
      if (a.truncated) lines.push(`⚠️ ลิสต์ข้างล่างแสดงได้ ${a.sampled} จาก ${a.total} รายการ (ตัวเลขแยกกลุ่มยังไม่ครบ)`);
      for (const g of groups) {
        lines.push(``, `${g.kind === 'over' ? '🟧' : '🟥'} <b>${g.title}</b> — ${g.count} รายการ:`);
        for (const it of g.items ?? []) {
          lines.push(`  • ${[it.line, it.mat, it.part].filter(Boolean).join(' · ')} — ${it.detail}`);
        }
        const shown = g.items?.length ?? 0;
        if ((g.count ?? 0) > shown) lines.push(`  • …และอีก ${(g.count ?? 0) - shown} รายการ`);
      }
      lines.push(``, `👉 ดูทั้งหมด/กรองรายไลน์ที่ 🚨 เฝ้าระวังสต๊อก & รอบส่ง`, `— Smart Logistic`);
      const itemsText = groups.map((g) => `${g.title}: ${g.count}`).join(' · ');
      const message = pick(routes, 'store_abnormal',
        { work_date: a.work_date, total: a.total, shortage: a.shortage, over: a.over, items: itemsText },
        lines.join('\n'));
      await sendTelegram(message, chat).catch(console.error);
      await notifyInApp(routes, 'store_abnormal', message);
      return json({ ok: true });
    }

    return new Response(`unknown event: ${event}`, { status: 400 });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
