// 🔔 send-event-notification — ตัวส่งแจ้งเตือน "ทั่วไป" ตัวเดียวของทั้งระบบ  (Main project)
//
// ทำไมต้องมีตัวนี้ (2026-08-25 · คำสั่ง user "upgrade ทั้งระบบ telegram กับ ใน app ต้องสอดคล้องตรงกัน"):
//   เดิมทุกเรื่องต้องเขียน branch ของตัวเองใน send-notification (ไฟล์ 47KB) → คนเลยเลี่ยงไม่เขียน
//   ผลคือ **16 เรื่องที่พนักงานกรอกแล้วเงียบสนิท** ไม่มีทั้ง Telegram และในแอป
//   ตัวนี้รับ payload ทรงเดียวกันหมด → **เพิ่มเรื่องใหม่ = เพิ่มแถวใน notification_rules + เรียก
//   notifyEvent() จากหน้าเว็บ ไม่ต้องแก้ edge อีก**
//
// ⚠️ กฎเหล็ก: Telegram กับในแอปต้องมาจาก "กติกาแถวเดียวกัน" เสมอ
//   - เปิด/ปิด · ห้อง Telegram · ข้อความ · role/ส่วนงาน/แผนก ผู้รับในแอป
//     ทั้งหมดอยู่ที่ notification_rules → ตั้งที่ /notification-config
//   - ผู้รับในแอปเรียกผ่าน RPC `notify_recipients()` **ห้ามเขียนเงื่อนไขกรองผู้รับในไฟล์นี้**
//
// payload:
//   { event, lines: string[], title?, section?, line_name?, ref_table?, ref_id?, type?, actor?, vars? }
//   - `lines`      = เนื้อความ (บรรทัดละรายการ) — ใช้ทั้ง Telegram และ body ในแอป
//   - `section`    = ส่วนงานของเหตุการณ์ (ใช้กับ inapp_match_section) · ไม่ส่งมาแต่ส่ง line_name = หาให้เอง
//   - `vars`       = ตัวแปรสำหรับ template ที่ admin เขียนเองที่ /notification-config
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const FALLBACK_CHAT = Deno.env.get('TELEGRAM_CHAT_ID');

async function getBotToken(): Promise<string | undefined> {
  try {
    const { data } = await supabase.from('notification_settings').select('bot_token').eq('id', 1).maybeSingle();
    const t = data?.bot_token ? String(data.bot_token).trim() : '';
    return t || Deno.env.get('TELEGRAM_BOT_TOKEN') || undefined;
  } catch { return Deno.env.get('TELEGRAM_BOT_TOKEN') || undefined; }
}

type Rule = {
  enabled: boolean; chats: string[]; template?: string | null; label?: string;
};
async function loadRule(event: string): Promise<Rule | null> {
  const { data: r } = await supabase.from('notification_rules')
    .select('is_enabled, channel_ids, channel_id, template, label')
    .eq('event_key', event).maybeSingle();
  if (!r) return null;                                  // ไม่มีในทะเบียน = ไม่รู้จัก
  const ids: string[] = Array.isArray(r.channel_ids) ? r.channel_ids as string[]
    : (r.channel_id ? [r.channel_id as string] : []);
  let chats: string[] = [];
  if (ids.length) {
    const { data: chans } = await supabase.from('telegram_channels').select('id, chat_id, is_active').in('id', ids);
    chats = [...new Set((chans ?? []).filter((c) => c.is_active && c.chat_id).map((c) => String(c.chat_id).trim()))];
  }
  return { enabled: r.is_enabled as boolean, chats, template: r.template as string | null, label: r.label as string };
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function sendTelegram(token: string | undefined, message: string, chats: string[]) {
  const list = [...new Set(chats.filter(Boolean))];
  if (!token || !list.length) return false;
  const res = await Promise.all(list.map((chat) =>
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' }),
    }).then((r) => r.ok).catch(() => false)));
  return res.some(Boolean);
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json();
    const event: string = body?.event;
    if (!event) return json({ error: 'missing event' }, 400);

    const rule = await loadRule(event);
    if (!rule) return json({ error: `unknown event: ${event} — ยังไม่ได้ลงทะเบียนใน notification_rules` }, 400);
    if (!rule.enabled) return json({ ok: true, skipped: 'ปิดไว้ที่ /notification-config' });

    // ── ส่วนงานของเหตุการณ์ (ใช้กับ inapp_match_section) ──
    let section: string | null = body.section ?? null;
    if (!section && body.line_name) {
      try {
        const { data } = await supabase.from('production_lines')
          .select('section, parent_line_name').eq('name', body.line_name).maybeSingle();
        section = (data?.section as string) ?? null;
        if (!section && data?.parent_line_name) {         // ไลน์ลูกไม่ได้ตั้ง section → ตกทอดจากไลน์แม่
          const { data: p } = await supabase.from('production_lines')
            .select('section').eq('name', data.parent_line_name).maybeSingle();
          section = (p?.section as string) ?? null;
        }
      } catch { /* หาไม่เจอ = ไม่กรอง ดีกว่าเงียบ */ }
    }

    const title: string = body.title || rule.label || event;
    const lines: string[] = Array.isArray(body.lines) ? body.lines.filter(Boolean).map(String) : [];
    const actor: string | null = body.actor ?? null;

    // ── ข้อความ Telegram ──
    // admin เขียน template เองได้ที่ /notification-config (ตัวแปรจาก body.vars + ตัวมาตรฐาน)
    let message: string;
    const tpl = rule.template && String(rule.template).trim();
    if (tpl) {
      const vars: Record<string, unknown> = {
        title, actor: actor ?? '', section: section ?? '',
        line_name: body.line_name ?? '', body: lines.join('\n'),
        ...(body.vars && typeof body.vars === 'object' ? body.vars : {}),
      };
      message = String(tpl).replace(/\{(\w+)\}/g, (_m, k) => { const v = vars[k]; return v == null ? '' : String(v); });
    } else {
      const out = [`<b>${esc(title)}</b>`];
      for (const l of lines) out.push(esc(l));
      if (actor) out.push(`👤 ${esc(actor)}`);
      message = out.join('\n');
    }

    const token = await getBotToken();
    const tg = await sendTelegram(token, message, rule.chats.length ? rule.chats : (FALLBACK_CHAT ? [FALLBACK_CHAT] : []))
      .catch((e) => { console.error('telegram', e); return false; });

    // ── ในแอป (กระดิ่ง + เสียง + Web Push ผ่าน trigger trg_notify_push) ──
    // ผู้รับมาจาก RPC เดียวของระบบ — role × ส่วนงาน × แผนก ที่ตั้งไว้ในทะเบียน
    let inapp = 0;
    try {
      const { data: ids, error } = await supabase.rpc('notify_recipients', { p_event: event, p_section: section });
      if (error) throw error;
      const users = [...new Set((ids ?? []).map((r: unknown) =>
        typeof r === 'string' ? r : (r as { notify_recipients?: string })?.notify_recipients))].filter(Boolean) as string[];
      if (users.length) {
        const plain = [title, ...lines, actor ? `โดย ${actor}` : '']
          .filter(Boolean).join(' · ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);
        const { error: insErr } = await supabase.from('notifications').insert(users.map((uid) => ({
          user_id: uid, title, body: plain,
          type: ['success', 'error', 'info'].includes(body.type) ? body.type : 'info',
          ref_table: body.ref_table ?? null,
          ref_id: body.ref_id != null ? String(body.ref_id) : null,
        })));
        if (insErr) throw insErr;
        inapp = users.length;
      }
    } catch (e) { console.error('notify in-app', e); }

    return json({ ok: true, telegram: tg, inapp, section });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
