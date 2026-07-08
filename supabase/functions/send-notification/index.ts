import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID');   // legacy single-group fallback

// Bot token: prefer the value set in-app (notification_settings, read via the
// service role) else the env secret. Resolved per request into BOT_TOKEN.
let BOT_TOKEN: string | undefined = TELEGRAM_BOT_TOKEN;
async function getBotToken(): Promise<string | undefined> {
  try {
    const { data } = await supabase.from('notification_settings').select('bot_token').eq('id', 1).maybeSingle();
    const t = data?.bot_token ? String(data.bot_token).trim() : '';
    return t || TELEGRAM_BOT_TOKEN || undefined;
  } catch { return TELEGRAM_BOT_TOKEN || undefined; }
}

/* ── Rule-based routing ─────────────────────────────
   notification_rules(event_key → is_enabled, channel_id) + telegram_channels
   let the admin turn each notification on/off and pick which room it goes to.
   Unknown event → send to fallback. Known-but-disabled → skip Telegram.
   Room with no chat_id / inactive → fallback to legacy TELEGRAM_CHAT_ID, so
   existing notifications keep working until each room is configured. */
type Route = { enabled: boolean; chatId?: string };
async function loadRoutes(): Promise<Record<string, Route>> {
  try {
    const { data } = await supabase
      .from('notification_rules')
      .select('event_key, is_enabled, telegram_channels(chat_id, is_active)');
    const map: Record<string, Route> = {};
    for (const r of data ?? []) {
      const ch = (r as Record<string, unknown>).telegram_channels as { chat_id?: string; is_active?: boolean } | null;
      const chatId = ch && ch.is_active && ch.chat_id ? String(ch.chat_id).trim() : undefined;
      map[r.event_key as string] = { enabled: r.is_enabled as boolean, chatId };
    }
    return map;
  } catch { return {}; }
}
// Returns null when the event is explicitly disabled; otherwise the chat to use.
function resolveEvent(routes: Record<string, Route>, key: string): string | null {
  const r = routes[key];
  if (r && !r.enabled) return null;
  return (r?.chatId) || TELEGRAM_CHAT_ID || null;
}

/* ── Telegram senders (chatId-aware) ──────────────── */
async function sendTelegram(message: string, chatId?: string | null): Promise<boolean> {
  const chat = chatId ?? TELEGRAM_CHAT_ID;
  if (!BOT_TOKEN || !chat) return false;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' }),
  });
  return res.ok;
}

async function sendTelegramPhoto(photoUrl: string, caption: string, chatId?: string | null) {
  const chat = chatId ?? TELEGRAM_CHAT_ID;
  if (!BOT_TOKEN || !chat) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, photo: photoUrl, caption, parse_mode: 'HTML' }),
  });
}

async function sendTelegramMediaGroup(photos: { url: string; caption: string }[], chatId?: string | null) {
  const chat = chatId ?? TELEGRAM_CHAT_ID;
  if (!BOT_TOKEN || !chat || !photos.length) return;
  if (photos.length === 1) { await sendTelegramPhoto(photos[0].url, photos[0].caption, chat); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      media: photos.map((p, i) => ({
        type: 'photo', media: p.url,
        ...(i === 0 ? { caption: p.caption, parse_mode: 'HTML' } : {}),
      })),
    }),
  });
}

/* ── Helpers ────────────────────────────────────── */
function statusLabel(status: string) {
  return { pending: 'รอ SV Approve', pending_qa: 'รอ QA Approve', approved: 'Approved ✅', rejected: 'Rejected ❌' }[status] ?? status;
}
async function getFullName(userId: string | null | undefined): Promise<string> {
  if (!userId) return '-';
  const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).single();
  return (data?.full_name as string) || '-';
}
async function buildTelegramMessage(log: Record<string, unknown>, title: string) {
  const creatorName   = await getFullName(log.created_by as string);
  const svName        = await getFullName(log.sv_approved_by as string);
  const approverName  = await getFullName(log.approved_by as string);
  const lines = [
    `🔔 <b>${title}</b>`, ``,
    `📅 วันที่: ${log.work_date}`,
    `🏭 ไลน์: ${log.line_name}`,
    `📋 ประเภท: ${log.category}`,
    `📝 รายละเอียด: ${log.description}`,
    `🔖 สถานะ: ${statusLabel(log.status as string)}`,
    `👤 ผู้แจ้ง: ${creatorName}`,
  ];
  if (log.sv_approved_by) lines.push(`✅ Supervisor อนุมัติ: ${svName}`);
  if (log.approved_by)    lines.push(`✅ QA อนุมัติ: ${approverName}`);
  if (log.reject_reason)  lines.push(`❌ เหตุผล: ${log.reject_reason}`);
  lines.push(``, `— 4M Management System`);
  return lines.join('\n');
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/* ── Handler ─────────────────────────────────────── */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });

  try {
    const body = await req.json();
    const { event } = body;
    BOT_TOKEN = await getBotToken();   // in-app token (if set) else env secret

    /* ── Channel connectivity test (from the config page) ── */
    if (event === 'test_channel') {
      const chat = (body.chat_id ? String(body.chat_id).trim() : '') || undefined;
      if (!chat) return json({ sent: false, reason: 'ไม่มี chat_id' });
      const ok = await sendTelegram(`🔔 <b>ทดสอบการแจ้งเตือน</b>\nเชื่อมต่อ Telegram สำเร็จ ✅`, chat);
      return json(ok ? { sent: true } : { sent: false, reason: 'Telegram ปฏิเสธ — ตรวจ chat_id และบอทอยู่ในกลุ่มหรือยัง' });
    }

    const routes = await loadRoutes();

    /* ── Checkin Summary ─────────────────────────── */
    if (event === 'checkin_summary') {
      const s = body.summary;
      if (!s) return new Response('missing summary', { status: 400 });
      const chat = resolveEvent(routes, 'checkin_summary');
      if (chat === null) return json({ ok: true, skipped: true });
      const otNote = s.has_ot_night ? `\n⏰ เปิด OT กะดึก (${s.start_time} น.)` : `\n🕗 เวลาเริ่ม: ${s.start_time} น.`;
      const message = [
        `✅ <b>เช็คชื่อเสร็จแล้ว</b>`, ``,
        `🏭 ไลน์: <b>${s.line_name}</b> · ${s.shift_label}`,
        `📅 วันที่: ${s.work_date}${otNote}`, ``,
        `👥 เข้างาน: <b>${s.present}/${s.total}</b>`,
        `⏰ OT: ${s.ot}`, `🏖️ ลา: ${s.leave}`, `❌ ขาด: ${s.absent}`, ``,
        `✍️ ตรวจโดย: ${s.checked_by}`, `— 4M Management System`,
      ].join('\n');
      await sendTelegram(message, chat).catch(console.error);
      return json({ ok: true });
    }

    /* ── Machine downtime alert ──────────────────── */
    if (event === 'downtime') {
      const d = body.downtime;
      if (!d) return new Response('missing downtime', { status: 400 });
      const chat = resolveEvent(routes, 'downtime');
      if (chat === null) return json({ ok: true, skipped: true });
      const shiftLabel = d.shift === 'day' ? 'กะเช้า' : 'กะดึก';
      const ongoing = !d.end_time && d.duration_min == null;
      const lines = [
        `🚨🚨 <b>เครื่องจักร DOWNTIME</b> 🚨🚨`, ``,
        `⚙️ เครื่องจักร: <b>${d.machine_no || '-'}${d.machine_name ? ` (${d.machine_name})` : ''}</b>`,
        `🏭 ไลน์: ${d.line_name} · ${shiftLabel}`,
        `📅 วันที่: ${d.work_date}`,
        `🛑 สาเหตุ: ${d.type_name || '-'}${d.category === 'planned' ? ' (Planned)' : ''}`,
      ];
      if (d.start_time)          lines.push(`🕐 เริ่ม: ${d.start_time}${d.end_time ? ` – ${d.end_time}` : ' — <b>ยังไม่จบ ⏳</b>'}`);
      else if (ongoing)          lines.push(`⏳ สถานะ: <b>เครื่องยังหยุดอยู่</b>`);
      if (d.duration_min != null) lines.push(`⏱ ระยะเวลา: ${d.duration_min} นาที`);
      if (d.mat_no)              lines.push(`🔩 ชิ้นงาน: ${d.mat_no}`);
      if (d.description)         lines.push(`📝 รายละเอียด: ${d.description}`);
      lines.push(``, `👤 ผู้แจ้ง: ${d.reported_by || '-'}`, `— Production System`);
      await sendTelegram(lines.join('\n'), chat).catch(console.error);
      return json({ ok: true });
    }

    /* ── Machine downtime recovered ──────────────── */
    if (event === 'downtime_recovered') {
      const d = body.downtime;
      if (!d) return new Response('missing downtime', { status: 400 });
      const chat = resolveEvent(routes, 'downtime_recovered');
      if (chat === null) return json({ ok: true, skipped: true });
      const shiftLabel = d.shift === 'day' ? 'กะเช้า' : 'กะดึก';
      const lines = [
        `✅ <b>เครื่องกลับมารันได้แล้ว</b>`, ``,
        `⚙️ เครื่องจักร: <b>${d.machine_no || '-'}${d.machine_name ? ` (${d.machine_name})` : ''}</b>`,
        `🏭 ไลน์: ${d.line_name} · ${shiftLabel}`,
        `📅 วันที่: ${d.work_date}`,
        `🛠 สาเหตุที่หยุด: ${d.type_name || '-'}`,
      ];
      if (d.start_time)           lines.push(`🕐 ช่วงที่หยุด: ${d.start_time}${d.end_time ? ` – ${d.end_time}` : ''}`);
      if (d.duration_min != null) lines.push(`⏱ หยุดรวม: <b>${d.duration_min} นาที</b>`);
      if (d.mat_no)               lines.push(`🔩 ชิ้นงาน: ${d.mat_no}`);
      if (d.description)          lines.push(`📝 รายละเอียด: ${d.description}`);
      lines.push(``, `👤 ผู้ปิดรายการ: ${d.reported_by || '-'}`, `— Production System`);
      await sendTelegram(lines.join('\n'), chat).catch(console.error);
      return json({ ok: true });
    }

    /* ── Production session close ────────────────── */
    if (event === 'prod_close') {
      const s = body.session;
      if (!s) return new Response('missing session', { status: 400 });
      const chat = resolveEvent(routes, 'prod_close');
      if (chat === null) return json({ ok: true, skipped: true });
      const shiftLabel = s.shift === 'day' ? 'กะเช้า' : 'กะดึก';
      const map = {
        pending_close:    { title: '🟡 ขอปิดกะ — รอ SV อนุมัติ', extra: '' },
        closed:           { title: '✅ ปิดกะสำเร็จ', extra: '' },
        closed_approved:  { title: '✅ SV อนุมัติปิดกะแล้ว', extra: `\n🙋 ผู้ขอปิดกะ: ${s.requested_by || '-'}` },
        closed_rejected:  { title: '❌ SV ปฏิเสธคำขอปิดกะ', extra: `\n🙋 ผู้ขอปิดกะ: ${s.requested_by || '-'}` },
      };
      const m = map[s.status] ?? { title: `🔔 Production · ${s.status}`, extra: '' };
      const lines = [
        `<b>${m.title}</b>`, ``,
        `🏭 ไลน์: ${s.line_name} · ${shiftLabel}`,
        `📅 วันที่: ${s.work_date}`,
      ];
      if (s.start_time) lines.push(`🕗 เวลา: ${s.start_time} – ${s.end_time || '-'}${s.shift_min ? ` (${s.shift_min} นาที)` : ''}`);
      if (s.qty_ok != null) {
        if (s.total_qty != null) lines.push(``, `📦 ผลิตรวม: <b>${s.total_qty}</b> ชิ้น`);
        lines.push(`✅ ดี: ${s.qty_ok}  ❌ NG: ${s.qty_ng ?? 0}${s.qty_suspect ? `  ⚠️ สงสัย: ${s.qty_suspect}` : ''}${s.qty_repair ? `  🔧 ซ่อม: ${s.qty_repair}` : ''}`);
      }
      if (Array.isArray(s.parts) && s.parts.length) {
        for (const p of s.parts.slice(0, 8)) {
          const carryNote = p.carry_qty ? ` (ยกยอด ${p.carry_qty})` : '';
          lines.push(`  • ${p.mat_no}${p.name ? ` ${p.name}` : ''}: ${p.qty} ชิ้น${carryNote}`);
        }
        if (s.parts.length > 8) lines.push(`  • …และอีก ${s.parts.length - 8} รายการ`);
      }
      if (s.dt_count) {
        lines.push(``, `⏱ Downtime ${s.dt_count} รายการ · รวม <b>${s.dt_total_min ?? 0} นาที</b>`);
        if (Array.isArray(s.downtimes)) {
          for (const d of s.downtimes.slice(0, 6)) {
            const mc = d.machines?.length ? ` (${d.machines.join(', ')})` : '';
            lines.push(`  • ${d.name} — ${d.min} นาที${d.count > 1 ? ` ×${d.count}` : ''}${mc}`);
          }
          if (s.downtimes.length > 6) lines.push(`  • …และอีก ${s.downtimes.length - 6} สาเหตุ`);
        }
      } else if (Array.isArray(s.downtimes)) {
        lines.push(``, `⏱ Downtime: ไม่มี`);
      }
      if (s.oee != null) {
        const apq = (s.oee_a != null || s.oee_p != null || s.oee_q != null)
          ? ` (A ${s.oee_a ?? '-'}% · P ${s.oee_p ?? '-'}% · Q ${s.oee_q ?? '-'}%)` : '';
        lines.push(``, `📊 OEE: <b>${s.oee}%</b>${apq}`);
      }
      lines.push(`${m.extra}`, ``, `👤 ผู้ดำเนินการ: ${s.actor}`, `— Production System`);
      await sendTelegram(lines.join('\n'), chat).catch(console.error);
      return json({ ok: true });
    }

    /* ── Daily PM alarm (System 1) ───────────────── */
    if (event === 'pm_daily') {
      const p = body.pm;
      if (!p) return new Response('missing pm', { status: 400 });
      const key = p.color === 'green' ? 'pm_daily_green' : p.color === 'orange' ? 'pm_daily_orange' : 'pm_daily_red';
      const chat = resolveEvent(routes, key);
      if (chat === null) return json({ ok: true, skipped: true });
      const head = p.color === 'green' ? '🟢 <b>ตรวจ Daily PM เรียบร้อย ทุกอย่างปกติ</b>'
        : p.color === 'orange' ? '🟠 <b>ยังตรวจ Daily PM ไม่ครบ (เกินเวลา)</b>'
        : '🔴 <b>Daily PM พบความผิดปกติ</b>';
      const lines = [head, ``, `🏭 ไลน์: <b>${p.line_name}</b>${p.shift_label ? ` · ${p.shift_label}` : ''}`, `📅 วันที่: ${p.work_date}`];
      if (p.checked != null && p.total != null) lines.push(`✅ ตรวจแล้ว: <b>${p.checked}/${p.total}</b> เครื่อง`);
      if (Array.isArray(p.missing) && p.missing.length) lines.push(`⏳ ยังไม่ตรวจ: ${p.missing.join(', ')}`);
      if (Array.isArray(p.ng) && p.ng.length) {
        lines.push(``, `⚠️ ผิดปกติ:`);
        for (const n of p.ng.slice(0, 10)) lines.push(`  • ${n.machine ? `${n.machine} — ` : ''}${n.name}${n.topics?.length ? `: ${n.topics.join(', ')}` : ''}`);
      }
      lines.push(``, `— Smart Maintenance`);
      await sendTelegram(lines.join('\n'), chat).catch(console.error);
      return json({ ok: true });
    }

    /* ── 4M change management (in-app always + Telegram by rule) ── */
    const { log } = body;
    if (!log) return new Response('missing log', { status: 400 });
    const chat = resolveEvent(routes, 'four_m_status');
    const status: string = log.status;

    type Target = { userId: string };
    const targets: Target[] = [];
    const addProfilesByRole = async (roles: string[]) => {
      const { data } = await supabase.from('profiles').select('id').in('role', roles);
      for (const p of data ?? []) targets.push({ userId: p.id });
    };
    const addCreator = async () => { if (log.created_by) targets.push({ userId: log.created_by as string }); };

    if (status === 'pending') {
      await addProfilesByRole(['supervisor', 'leader', 'admin', 'manager']);
      if (log.requires_qa !== false) await addProfilesByRole(['qa']);
    } else if (status === 'pending_qa') {
      await addProfilesByRole(['qa', 'admin', 'manager']);
      await addCreator();
    } else {
      await addCreator();
      await addProfilesByRole(['admin', 'manager']);
    }

    const seen = new Set<string>();
    const unique = targets.filter(t => { if (seen.has(t.userId)) return false; seen.add(t.userId); return true; });

    const title = event === 'status_change'
      ? `4M ${log.category} · ${log.line_name} → ${statusLabel(status)}`
      : `4M แจ้งเตือน · ${log.line_name}`;
    const notifBody = `${log.work_date} · ${log.description}`;

    await Promise.allSettled(unique.map(async (t) => {
      await supabase.from('notifications').insert({
        user_id: t.userId, title, body: notifBody,
        type: status === 'rejected' ? 'error' : status === 'approved' ? 'success' : 'info',
        ref_table: 'four_m_logs', ref_id: log.id,
      });
    }));

    // Telegram only if this event isn't disabled in the rules
    if (chat !== null) {
      const message = await buildTelegramMessage(log, title);
      await sendTelegram(message, chat).catch(console.error);
      if (status === 'pending_qa' && log.request_image_url) {
        await sendTelegramPhoto(
          log.request_image_url as string,
          `📎 <b>รูปหลักฐาน OJT</b>\n${log.category} · ${log.line_name}\n${log.description}`,
          chat,
        ).catch(console.error);
      }
      if (status === 'approved') {
        const photos: { url: string; caption: string }[] = [];
        if (log.request_image_url) {
          photos.push({
            url: log.request_image_url as string,
            caption: `✅ <b>อนุมัติแล้ว — 4M ${log.category}</b>\n🏭 ${log.line_name} · 📅 ${log.work_date}\n📝 ${log.description}\n\n📎 รูปหลักฐาน OJT (ผู้แจ้ง)`,
          });
        }
        if (log.qa_image_url) photos.push({ url: log.qa_image_url as string, caption: `🔍 รูปยืนยันคุณภาพ (QA)` });
        if (photos.length) await sendTelegramMediaGroup(photos, chat).catch(console.error);
      }
    }

    return json({ ok: true, sent: unique.length });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
