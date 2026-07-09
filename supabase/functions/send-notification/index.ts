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
   notification_rules(event_key → is_enabled, channel_ids[]) + telegram_channels
   let the admin turn each notification on/off and pick which room(s) it goes to.
   One event can fan out to several rooms. Unknown event → send to fallback.
   Known-but-disabled → skip Telegram. Rooms with no chat_id / inactive are
   dropped; if that leaves no valid room, fall back to legacy TELEGRAM_CHAT_ID
   so existing notifications keep working until each room is configured. */
type Route = { enabled: boolean; chats: string[]; template?: string | null };
async function loadRoutes(): Promise<Record<string, Route>> {
  try {
    const [{ data: rules }, { data: channels }] = await Promise.all([
      supabase.from('notification_rules').select('event_key, is_enabled, channel_ids, channel_id, template'),
      supabase.from('telegram_channels').select('id, chat_id, is_active'),
    ]);
    const chatById = new Map<string, string>();
    for (const c of channels ?? []) {
      if (c.is_active && c.chat_id) chatById.set(String(c.id), String(c.chat_id).trim());
    }
    const map: Record<string, Route> = {};
    for (const r of rules ?? []) {
      const ids: string[] = Array.isArray((r as Record<string, unknown>).channel_ids)
        ? ((r as Record<string, unknown>).channel_ids as string[])
        : (r as { channel_id?: string }).channel_id ? [(r as { channel_id: string }).channel_id] : [];
      const chats = [...new Set(ids.map((id) => chatById.get(String(id))).filter((v): v is string => !!v))];
      const template = (r as { template?: string | null }).template;
      map[r.event_key as string] = { enabled: r.is_enabled as boolean, chats, template };
    }
    return map;
  } catch { return {}; }
}

/* Admin-editable message templates. A rule with a non-empty `template` renders
   it against that event's {placeholders}; NULL/empty keeps the rich built-in
   message below (so nothing changes until an admin opts in). Unknown {tokens}
   render empty. */
function ruleTemplate(routes: Record<string, Route>, key: string): string | null {
  const t = routes[key]?.template;
  return t && String(t).trim() ? String(t) : null;
}
function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) => {
    const v = vars[k as string];
    return v == null ? '' : String(v);
  });
}
// choose rendered template when set, else the built-in message
function pick(routes: Record<string, Route>, key: string, vars: Record<string, unknown>, builtin: string): string {
  const t = ruleTemplate(routes, key);
  return t ? renderTemplate(t, vars) : builtin;
}
// Returns null when the event is explicitly disabled; otherwise the chat(s) to
// use — the configured rooms, or the legacy fallback group when none resolve.
function resolveEvent(routes: Record<string, Route>, key: string): string[] | null {
  const r = routes[key];
  if (r && !r.enabled) return null;
  if (r && r.chats.length) return r.chats;
  return TELEGRAM_CHAT_ID ? [TELEGRAM_CHAT_ID] : [];
}

/* ── Telegram senders (fan out to one or many chats) ── */
function chatList(chatId?: string | string[] | null): string[] {
  const raw = chatId == null ? (TELEGRAM_CHAT_ID ? [TELEGRAM_CHAT_ID] : []) : Array.isArray(chatId) ? chatId : [chatId];
  return [...new Set(raw.filter((c): c is string => !!c))];
}

async function sendTelegram(message: string, chatId?: string | string[] | null): Promise<boolean> {
  const chats = chatList(chatId);
  if (!BOT_TOKEN || !chats.length) return false;
  const results = await Promise.all(chats.map((chat) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' }),
    }).then((res) => res.ok).catch(() => false),
  ));
  return results.some(Boolean);
}

async function sendTelegramPhoto(photoUrl: string, caption: string, chatId?: string | string[] | null) {
  const chats = chatList(chatId);
  if (!BOT_TOKEN || !chats.length) return;
  await Promise.all(chats.map((chat) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, photo: photoUrl, caption, parse_mode: 'HTML' }),
    }).catch(() => {}),
  ));
}

async function sendTelegramMediaGroup(photos: { url: string; caption: string }[], chatId?: string | string[] | null) {
  const chats = chatList(chatId);
  if (!BOT_TOKEN || !chats.length || !photos.length) return;
  if (photos.length === 1) { await sendTelegramPhoto(photos[0].url, photos[0].caption, chats); return; }
  await Promise.all(chats.map((chat) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMediaGroup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        media: photos.map((p, i) => ({
          type: 'photo', media: p.url,
          ...(i === 0 ? { caption: p.caption, parse_mode: 'HTML' } : {}),
        })),
      }),
    }).catch(() => {}),
  ));
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

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

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
      const builtin = [
        `✅ <b>เช็คชื่อเสร็จแล้ว</b>`, ``,
        `🏭 ไลน์: <b>${s.line_name}</b> · ${s.shift_label}`,
        `📅 วันที่: ${s.work_date}${otNote}`, ``,
        `👥 เข้างาน: <b>${s.present}/${s.total}</b>`,
        `⏰ OT: ${s.ot}`, `🏖️ ลา: ${s.leave}`, `❌ ขาด: ${s.absent}`, ``,
        `✍️ ตรวจโดย: ${s.checked_by}`, `— 4M Management System`,
      ].join('\n');
      const message = pick(routes, 'checkin_summary', {
        line_name: s.line_name, shift_label: s.shift_label, work_date: s.work_date,
        present: s.present, total: s.total, ot: s.ot, leave: s.leave, absent: s.absent,
        checked_by: s.checked_by, start_time: s.start_time,
      }, builtin);
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
      const message = pick(routes, 'downtime', {
        machine_no: d.machine_no || '-', machine_name: d.machine_name || '', line_name: d.line_name,
        shift_label: shiftLabel, work_date: d.work_date, type_name: d.type_name || '-',
        duration_min: d.duration_min ?? '', mat_no: d.mat_no || '', description: d.description || '',
        reported_by: d.reported_by || '-', start_time: d.start_time || '', end_time: d.end_time || '',
      }, lines.join('\n'));
      await sendTelegram(message, chat).catch(console.error);
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
      const message = pick(routes, 'downtime_recovered', {
        machine_no: d.machine_no || '-', machine_name: d.machine_name || '', line_name: d.line_name,
        shift_label: shiftLabel, work_date: d.work_date, type_name: d.type_name || '-',
        duration_min: d.duration_min ?? '', mat_no: d.mat_no || '', description: d.description || '',
        reported_by: d.reported_by || '-', start_time: d.start_time || '', end_time: d.end_time || '',
      }, lines.join('\n'));
      await sendTelegram(message, chat).catch(console.error);
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

      /* Downtime ที่ตัดยอดข้ามกะ — เครื่องยังซ่อมไม่เสร็จ กะถัดไปจะเปิดรายการต่ออัตโนมัติ */
      if (Array.isArray(s.dt_carry) && s.dt_carry.length) {
        lines.push(``, `⚠️ <b>Downtime ยกข้ามกะ ${s.dt_carry.length} รายการ — เครื่องยังไม่กลับมา</b>`);
        for (const c of s.dt_carry) lines.push(`  • ${c.machine_no || '-'} — ${c.type_name || 'Downtime'} (กะถัดไปเปิดรายการต่ออัตโนมัติ)`);
      }

      if (s.oee != null) {
        const apq = (s.oee_a != null || s.oee_p != null || s.oee_q != null)
          ? ` (A ${s.oee_a ?? '-'}% · P ${s.oee_p ?? '-'}% · Q ${s.oee_q ?? '-'}%)` : '';
        lines.push(``, `📊 OEE: <b>${s.oee}%</b>${apq}`);
      }
      lines.push(`${m.extra}`, ``, `👤 ผู้ดำเนินการ: ${s.actor}`, `— Production System`);
      const message = pick(routes, 'prod_close', {
        title: m.title, line_name: s.line_name, shift_label: shiftLabel, work_date: s.work_date,
        total_qty: s.total_qty ?? '', qty_ok: s.qty_ok ?? '', qty_ng: s.qty_ng ?? 0,
        qty_suspect: s.qty_suspect ?? '', qty_repair: s.qty_repair ?? '',
        oee: s.oee ?? '', oee_a: s.oee_a ?? '', oee_p: s.oee_p ?? '', oee_q: s.oee_q ?? '',
        start_time: s.start_time || '', end_time: s.end_time || '', shift_min: s.shift_min ?? '',
        dt_count: s.dt_count ?? 0, dt_total_min: s.dt_total_min ?? 0, actor: s.actor,
        requested_by: s.requested_by || '-',
      }, lines.join('\n'));
      await sendTelegram(message, chat).catch(console.error);
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
      const ngList = Array.isArray(p.ng) ? p.ng : [];
      if (ngList.length) {
        lines.push(``, `⚠️ ผิดปกติ:`);
        for (const n of ngList.slice(0, 10)) lines.push(`  • ${n.machine ? `${n.machine} — ` : ''}${n.name}${n.topics?.length ? `: ${n.topics.join(', ')}` : ''}`);
      }
      lines.push(``, `— Smart Maintenance`);
      const ngText = ngList.map((n: Record<string, unknown>) => `${n.machine ? `${n.machine} — ` : ''}${n.name}${Array.isArray(n.topics) && n.topics.length ? `: ${(n.topics as string[]).join(', ')}` : ''}`).join('\n');
      const message = pick(routes, key, {
        line_name: p.line_name, shift_label: p.shift_label || '', work_date: p.work_date,
        checked: p.checked ?? '', total: p.total ?? '',
        missing: Array.isArray(p.missing) ? p.missing.join(', ') : '', ng: ngText,
      }, lines.join('\n'));
      await sendTelegram(message, chat).catch(console.error);
      return json({ ok: true });
    }

    /* ── Maintenance Planned PM staged reminder (System 3) ── */
    if (event === 'pm_plan_reminder') {
      const p = body.pm;
      if (!p) return new Response('missing pm', { status: 400 });
      const chat = resolveEvent(routes, 'pm_plan_reminder');
      if (chat === null) return json({ ok: true, skipped: true });
      const overdue = Number(p.days) < 0;
      const dueLine = overdue
        ? `📅 ครบกำหนด: ${p.due_date} — <b>เกินมาแล้ว ${Math.abs(Number(p.days))} วัน</b>`
        : `📅 ครบกำหนด: ${p.due_date} (อีก <b>${p.days}</b> วัน)`;
      const equip = `${p.machine_no ? `${p.machine_no} ` : ''}${p.jig_name || '-'}`.trim();
      const lines = [
        `${p.stage_label || '🗓️ เตือนรอบ PM'}`, ``,
        `🔧 เครื่อง/จิ๊ก: <b>${equip}</b>`,
      ];
      if (p.line_name)      lines.push(`🏭 ไลน์: ${p.line_name}`);
      if (p.part_name)      lines.push(`📦 ชิ้นงาน: ${p.part_name}`);
      if (p.checklist_name) lines.push(`📋 เช็คลิสต์: ${p.checklist_name}${p.frequency ? ` (รอบ ${p.frequency})` : ''}`);
      lines.push(dueLine, ``, `— Smart Maintenance`);
      const message = pick(routes, 'pm_plan_reminder', {
        stage: p.stage, stage_label: p.stage_label, days: p.days, due_date: p.due_date,
        jig_name: p.jig_name || '', machine_no: p.machine_no || '', line_name: p.line_name || '',
        part_name: p.part_name || '', checklist_name: p.checklist_name || '', frequency: p.frequency || '',
      }, lines.join('\n'));
      await sendTelegram(message, chat).catch(console.error);
      return json({ ok: true });
    }

    /* ── 4M change management (in-app always + Telegram by rule) ── */
    if (event === 'pm_plan_reminder') {
      const p = body.pm;
      if (!p) return new Response('missing pm', { status: 400 });
      const chat = resolveEvent(routes, 'pm_plan_reminder');
      if (chat === null) return json({ ok: true, skipped: true });
      const overdue = Number(p.days) < 0;
      const dueLine = overdue ? `📅 ครบกำหนด: ${p.due_date} — <b>เกินมาแล้ว ${Math.abs(Number(p.days))} วัน</b>` : `📅 ครบกำหนด: ${p.due_date} (อีก <b>${p.days}</b> วัน)`;
      const equip = `${p.machine_no ? `${p.machine_no} ` : ''}${p.jig_name || '-'}`.trim();
      const lines = [`${p.stage_label || '🗓️ เตือนรอบ PM'}`, ``, `🔧 เครื่อง/จิ๊ก: <b>${equip}</b>`];
      if (p.line_name) lines.push(`🏭 ไลน์: ${p.line_name}`);
      if (p.part_name) lines.push(`📦 ชิ้นงาน: ${p.part_name}`);
      if (p.checklist_name) lines.push(`📋 เช็คลิสต์: ${p.checklist_name}${p.frequency ? ` (รอบ ${p.frequency})` : ''}`);
      lines.push(dueLine, ``, `— Smart Maintenance`);
      const message = pick(routes, 'pm_plan_reminder', { stage: p.stage, stage_label: p.stage_label, days: p.days, due_date: p.due_date, jig_name: p.jig_name || '', machine_no: p.machine_no || '', line_name: p.line_name || '', part_name: p.part_name || '', checklist_name: p.checklist_name || '', frequency: p.frequency || '' }, lines.join('\n'));
      await sendTelegram(message, chat).catch(console.error);
      return json({ ok: true });
    }

    /* ── Smart Logistic — Customer Demand / Shipping (EDI 830·862) ────────── */
    if (event === 'edi_import') {
      const e = body.edi;
      if (!e) return new Response('missing edi', { status: 400 });
      const chat = resolveEvent(routes, 'edi_import');
      if (chat === null) return json({ ok: true, skipped: true });
      const kindLabel = e.kind === 'orders' ? '862 Shipping Schedule (รอบส่งงาน)' : '830 Planning Forecast';
      const lines = [
        `📡 <b>นำเข้าข้อมูลลูกค้า — EDI ${kindLabel}</b>`, ``,
        `🏭 Ship-to: <b>${e.ship_tos}</b>`,
        `🧾 รายการ: <b>${e.rows}</b> · 📄 ${e.files} ไฟล์`,
        `📅 ช่วง: ${e.date_from} → ${e.date_to}`,
      ];
      if (e.unmatched) lines.push(`⚠️ พาร์ทที่ยังจับคู่ mat_no ไม่ได้: ${e.unmatched}`);
      lines.push(``, `👤 ผู้อัพโหลด: ${e.uploaded_by || '-'}`, `— Smart Logistic`);
      const message = pick(routes, 'edi_import', { kind_label: kindLabel, ship_tos: e.ship_tos, rows: e.rows, files: e.files, date_from: e.date_from, date_to: e.date_to, unmatched: e.unmatched ?? 0, uploaded_by: e.uploaded_by || '-' }, lines.join('\n'));
      await sendTelegram(message, chat).catch(console.error);
      return json({ ok: true });
    }

    if (event === 'shipping_shipped') {
      const s = body.ship;
      if (!s) return new Response('missing ship', { status: 400 });
      const chat = resolveEvent(routes, 'shipping_shipped');
      if (chat === null) return json({ ok: true, skipped: true });
      const lines = [
        `🚚 <b>ส่งงานลูกค้าแล้ว</b>`, ``,
        `🕐 รอบ ${s.ship_time || '-'} · 📅 ${s.due_date}`,
        `🏭 ลูกค้า: <b>${s.customer || '-'}</b>${s.dock_code ? ` · Dock ${s.dock_code}` : ''}`,
        `🔩 ${s.mat_no}${s.customer_part_no ? ` (${s.customer_part_no})` : ''}${s.part_name ? ` — ${s.part_name}` : ''}`,
        `📦 จำนวน: <b>${s.qty}</b> ชิ้น${s.order_no ? ` · PO ${s.order_no}` : ''}`,
        ``, `👤 ผู้ส่ง: ${s.shipped_by || '-'}`, `— Smart Logistic`,
      ];
      const message = pick(routes, 'shipping_shipped', { ship_time: s.ship_time || '-', due_date: s.due_date, customer: s.customer || '-', dock_code: s.dock_code || '', mat_no: s.mat_no, customer_part_no: s.customer_part_no || '', part_name: s.part_name || '', qty: s.qty, order_no: s.order_no || '', shipped_by: s.shipped_by || '-' }, lines.join('\n'));
      await sendTelegram(message, chat).catch(console.error);
      return json({ ok: true });
    }

    if (event === 'shipping_overdue') {
      const s = body.ship;
      if (!s) return new Response('missing ship', { status: 400 });
      const chat = resolveEvent(routes, 'shipping_overdue');
      if (chat === null) return json({ ok: true, skipped: true });
      const items: { ship_time?: string; customer?: string; mat_no?: string; qty?: number }[] = Array.isArray(s.items) ? s.items : [];
      const lines = [
        `🔴 <b>รอบส่งเลยเวลา — ยังไม่ได้ส่ง ${s.count} รอบ</b>`, ``,
        `📅 วันงาน: ${s.work_date}`,
      ];
      for (const it of items.slice(0, 10)) lines.push(`  • ${it.ship_time || '-'} · ${it.customer || '-'} · ${it.mat_no} × ${it.qty}`);
      if (items.length > 10) lines.push(`  • …และอีก ${items.length - 10} รอบ`);
      lines.push(``, `⚠️ รีบตรวจสอบ/อัปเดตสถานะที่หน้า Customer Demand → Shipping Chart`, `— Smart Logistic`);
      const itemsText = items.map((it) => `${it.ship_time || '-'} · ${it.customer || '-'} · ${it.mat_no} × ${it.qty}`).join('\n');
      const message = pick(routes, 'shipping_overdue', { work_date: s.work_date, count: s.count, items: itemsText }, lines.join('\n'));
      await sendTelegram(message, chat).catch(console.error);
      return json({ ok: true });
    }

    if (event === 'shipping_phase_alert') {
      const a = body.alert;
      if (!a) return new Response('missing alert', { status: 400 });
      const chat = resolveEvent(routes, 'shipping_phase_alert');
      if (chat === null) return json({ ok: true, skipped: true });
      const groups: { step_name?: string; offset_min?: number; count?: number; items?: { ship_time?: string; deadline?: string; customer?: string; mat_no?: string; qty?: number; status_label?: string }[] }[] = Array.isArray(a.groups) ? a.groups : [];
      const lines = [
        `🟠 <b>หลุดเฟสงานส่ง ${a.total} รายการ — เร่งตามก่อนตก due ลูกค้า</b>`, ``,
        `📅 วันงาน: ${a.work_date}`,
      ];
      for (const g of groups) {
        lines.push(``, `⏱ เฟส "<b>${g.step_name}</b>" (ต้องเสร็จก่อนส่ง ${g.offset_min} นาที) — ${g.count} รอบ:`);
        for (const it of (g.items ?? []).slice(0, 8)) {
          lines.push(`  • ส่ง ${it.ship_time} (deadline ${it.deadline}) · ${it.customer} · ${it.mat_no} × ${it.qty} — ${it.status_label}`);
        }
        if ((g.items ?? []).length > 8) lines.push(`  • …และอีก ${(g.items ?? []).length - 8} รอบ`);
      }
      lines.push(``, `👉 อัปเดตสถานะที่ Customer Demand → Shipping Chart`, `— Smart Logistic`);
      const itemsText = groups.map((g) => `${g.step_name}: ${(g.items ?? []).map((it) => `${it.ship_time} ${it.mat_no}×${it.qty}`).join(', ')}`).join('\n');
      const message = pick(routes, 'shipping_phase_alert', { work_date: a.work_date, total: a.total, items: itemsText }, lines.join('\n'));
      await sendTelegram(message, chat).catch(console.error);
      return json({ ok: true });
    }

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
      const builtin = await buildTelegramMessage(log, title);
      const message = pick(routes, 'four_m_status', {
        title, work_date: log.work_date, line_name: log.line_name, category: log.category,
        description: log.description, status_label: statusLabel(status),
        creator: await getFullName(log.created_by as string), reject_reason: log.reject_reason || '',
      }, builtin);
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
