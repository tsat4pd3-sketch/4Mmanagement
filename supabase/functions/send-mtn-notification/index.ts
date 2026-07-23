// MTN Work-Order (ใบแจ้งซ่อม MO) Telegram notifications — Main project.
// รูปแบบข้อความ mirror ระบบ AppSheet เดิม (JIG MTN) · แจ้งครบทุกสเตป (คำสั่ง user 2026-07-14)
// แยกจาก send-notification (กันไฟล์ใหญ่พัง) แต่ route ผ่าน notification_rules + telegram_channels เดียวกัน
//   → ปรับ/ปิด/เลือกห้อง/แก้ข้อความได้จาก /notification-config (category 'maintenance').
// Events: mtn_reported/assigned/repaired/checked/qa/handover/closed (step 1..7)
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
// teamChats = ห้องที่แท็กทีมไว้ (JIG MTN/DIE MTN/MTN/PRODUCTION) → ส่งแจ้งเตือนเข้าห้องของทีมนั้นก่อน
async function loadRoutes(): Promise<{ map: Record<string, Route>; teamChats: Record<string, string[]>; chatTeam: Map<string, string> }> {
  try {
    const [{ data: rules }, { data: channels }] = await Promise.all([
      supabase.from('notification_rules').select('event_key, is_enabled, channel_ids, channel_id, template'),
      supabase.from('telegram_channels').select('id, chat_id, is_active, team'),
    ]);
    const chatById = new Map<string, string>();
    const teamChats: Record<string, string[]> = {};
    const chatTeam = new Map<string, string>();   // chat_id → ทีมที่แท็กไว้ (ถ้ามี) — ใช้กันรั่วข้ามทีม
    for (const c of channels ?? []) {
      if (!(c.is_active && c.chat_id)) continue;
      const chat = String(c.chat_id).trim();
      chatById.set(String(c.id), chat);
      const team = (c as { team?: string | null }).team;
      if (team) { const t = String(team).trim(); (teamChats[t] ||= []).push(chat); chatTeam.set(chat, t); }
    }
    const map: Record<string, Route> = {};
    for (const r of rules ?? []) {
      const ids: string[] = Array.isArray((r as Record<string, unknown>).channel_ids)
        ? ((r as Record<string, unknown>).channel_ids as string[])
        : (r as { channel_id?: string }).channel_id ? [(r as { channel_id: string }).channel_id] : [];
      const chats = [...new Set(ids.map((id) => chatById.get(String(id))).filter((v): v is string => !!v))];
      map[r.event_key as string] = { enabled: r.is_enabled as boolean, chats, template: (r as { template?: string | null }).template };
    }
    return { map, teamChats, chatTeam };
  } catch { return { map: {}, teamChats: {}, chatTeam: new Map() }; }
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
// คืนรายการ {chat, message_id} ที่ส่งสำเร็จ — ใช้ผูก reply ใน Telegram กลับมาหาใบงาน (telegram-webhook)
async function sendTelegram(message: string, chats: string[]): Promise<{ chat: string; message_id: number }[]> {
  const list = [...new Set(chats.filter(Boolean))];
  if (!BOT_TOKEN || !list.length) return [];
  const res = await Promise.all(list.map((chat) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' }),
    }).then(async (r) => (r.ok ? { chat, message_id: (await r.json())?.result?.message_id as number } : null)).catch(() => null)));
  return res.filter((x): x is { chat: string; message_id: number } => !!x?.message_id);
}
async function sendTelegramPhoto(photoUrl: string, caption: string, chats: string[]): Promise<{ chat: string; message_id: number }[]> {
  const list = [...new Set(chats.filter(Boolean))];
  if (!BOT_TOKEN || !list.length) return [];
  const cap = caption.length > 1000 ? caption.slice(0, 1000) : caption;
  const res = await Promise.all(list.map((chat) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, photo: photoUrl, caption: cap, parse_mode: 'HTML' }),
    }).then(async (r) => (r.ok ? { chat, message_id: (await r.json())?.result?.message_id as number } : null)).catch(() => null)));
  return res.filter((x): x is { chat: string; message_id: number } => !!x?.message_id);
}
// จำ message_id ที่ส่ง ผูกกับใบงาน (best-effort — ล้มเงียบ ห้ามทำการแจ้งเตือนพัง)
async function recordSentRefs(sent: { chat: string; message_id: number }[], refKind: string, refId: unknown, event: string) {
  if (!refId || !sent.length) return;
  try {
    await supabase.from('telegram_sent_messages').upsert(
      sent.map((s) => ({ chat_id: s.chat, message_id: s.message_id, ref_kind: refKind, ref_id: String(refId), event })),
      { onConflict: 'chat_id,message_id', ignoreDuplicates: true },
    );
  } catch { /* ตารางยังไม่สร้าง (migration 20260716_telegram_intake) — ข้าม */ }
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

function beDate(iso?: string | null): string {
  if (!iso) return '';
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const g: Record<string, string> = {}; for (const x of p) g[x.type] = x.value;
  return `${+g.day}/${+g.month}/${Number(g.year) + 543}`;
}
const deptFor = (it: string) => { const s = (it || '').toUpperCase(); if (s.includes('JIG')) return 'JIG MTN'; if (s.includes('DIE')) return 'DIE MTN'; return 'MTN'; };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const body = await req.json();
    const { event, mo } = body;
    if (!mo) return json({ error: 'missing mo' }, 400);
    BOT_TOKEN = await getBotToken();
    const { map: routes, teamChats, chatTeam } = await loadRoutes();
    const baseChat = resolveEvent(routes, event);
    if (baseChat === null) return json({ ok: true, skipped: true }); // event ถูกปิด

    const dept = mo.mtn_dept || deptFor(mo.item_type);
    // ── routing แบบ "แท็กทีม = exclusive" (กันรั่วข้ามทีม) ──
    //   ห้องแท็กทีม X → รับเฉพาะ MO ของทีม X · ห้อง "ทุกทีม (รวม)" (ไม่แท็ก) → รับทุกทีม
    //   ห้องทีมอื่นถูกตัดออกเสมอ แม้ถูกติ๊กไว้ใน rule ของ event (เดิมรั่ว: MO ของ MTN เข้าห้อง PRODUCTION)
    let chat: string[];
    if (event === 'mtn_returned') {
      // ตีกลับ → ให้ผู้แจ้ง/ผลิตเห็น: ใช้ห้องตาม rule ตามที่แอดมินตั้ง (ไม่ผูกทีมช่าง)
      chat = baseChat;
    } else {
      const generalRule = (baseChat || []).filter((c) => !chatTeam.get(c));   // ห้อง "รวม" ที่เลือกไว้ใน event
      const teamRooms = teamChats[dept] || [];                                 // ห้องของทีมนี้
      chat = [...new Set([...teamRooms, ...generalRule])];
      // safety: ถ้าไม่เหลือห้องเลย (rule มีแต่ห้องทีมอื่น + ไม่มีห้องทีมนี้) → ห้อง fallback รวม ห้ามเงียบ/ห้ามรั่วทีมอื่น
      if (!chat.length) chat = TELEGRAM_CHAT_ID ? [TELEGRAM_CHAT_ID] : [];
    }
    const v = {
      dept, mo_no: mo.mo_no || '(ยังไม่ออกเลข)', line_name: mo.line_name || '-', item_type: mo.item_type || '-',
      machine_no: mo.machine_no || '', problem: mo.problem_characteristic || '-',
      reporter_prod: mo.reporter_prod || mo.reported_by_name || '', reporter_qa: mo.reporter_qa || '',
      want_at: beDate(mo.want_at), repair_type: mo.repair_type || '-', assigned_to: mo.assigned_to || '-',
      tech_main: mo.tech_main || mo.assigned_to || '-', root_cause: mo.root_cause || '-', solution: mo.solution || '-',
      check_result: mo.check_result || '-', quality_related: mo.quality_related || '-', checker_name: mo.checker_name || '-',
      qa_result: mo.qa_result || '-', qa_checker: mo.qa_checker || '-', follow_up: mo.follow_up || '-', ho_checker: mo.ho_checker || '-',
      approver: mo.approver_name || '-',
    };
    const equip = `${v.item_type}${v.machine_no ? ` (${v.machine_no})` : ''}`;
    let builtin = ''; let photo: string | null = null;
    switch (event) {
      case 'mtn_reported':
        builtin = [`🛠️ <b>แจ้งซ่อม ${dept}</b>`, `ไลน์การผลิต: ${v.line_name}`, `ชื่อรายการ: ${equip}`, `ปัญหา: ${v.problem}`,
          `PD ผู้แจ้ง: ${v.reporter_prod}`, `QA ผู้แจ้ง: ${v.reporter_qa}`, v.want_at ? `เป้าหมาย: ${v.want_at}` : '', `สถานะ: รอดำเนินการ`].filter(Boolean).join('\n');
        photo = mo.before_img || null; break;
      case 'mtn_assigned':
        builtin = [`📋 <b>รับงานซ่อม — ${v.mo_no}</b>`, `${dept} · ${v.line_name} · ${equip}`, `ปัญหา: ${v.problem}`,
          `ประเภทงานซ่อม: ${v.repair_type}`, `มอบหมายช่าง: ${v.assigned_to}`].join('\n'); break;
      case 'mtn_repaired':
        builtin = [`🔧 <b>สรุปผลซ่อม ${dept}</b>`, `ไลน์การผลิต: ${v.line_name}`, `ชื่อรายการ: ${equip}`, `ปัญหา: ${v.problem}`, ``,
          `เลขแจ้งซ่อม: <b>${v.mo_no}</b>`, `ช่างซ่อม: ${v.tech_main}`, `สาเหตุ: ${v.root_cause}`, `วิธีแก้ไข: ${v.solution}`].join('\n');
        photo = mo.after_img || null; break;
      case 'mtn_checked':
        builtin = [`🔎 <b>ตรวจสอบหลังซ่อม — ${v.mo_no}</b>`, `${dept} · ${v.line_name} · ${equip}`,
          `ผลงานหลังซ่อม: ${v.check_result}`, `เกี่ยวคุณภาพ: ${v.quality_related}`, `ผู้ตรวจ: ${v.checker_name}`].join('\n'); break;
      case 'mtn_qa':
        builtin = [`🧪 <b>ยืนยันคุณภาพหลังซ่อม — ${v.mo_no}</b>`, `${dept} · ${v.line_name} · ${equip}`,
          `ผลคุณภาพ: ${v.qa_result}`, `ผู้ตรวจ QA: ${v.qa_checker}`].join('\n');
        photo = mo.qa_img || null; break;
      case 'mtn_handover':
        builtin = [`🤝 <b>รับมอบหลังซ่อม — ${v.mo_no}</b>`, `${dept} · ${v.line_name} · ${equip}`,
          `ติดตามผล: ${v.follow_up}`, `ผู้รับมอบ: ${v.ho_checker}`].join('\n'); break;
      case 'mtn_closed':
        builtin = [`✅ <b>อนุมัติปิดแจ้งซ่อม</b>`, `ไลน์การผลิต: ${v.line_name}`, `ชื่อรายการ: ${equip}`, `ปัญหา: ${v.problem}`, ``,
          `เลขแจ้งซ่อม: <b>${v.mo_no}</b>`, `ช่างซ่อม: ${v.tech_main}`, `วิธีแก้ไข: ${v.solution}`, `ผู้อนุมัติ: ${v.approver}`].join('\n');
        photo = mo.after_img || null; break;
      case 'mtn_returned':
        builtin = [`↩️ <b>ตีกลับใบแจ้งซ่อม (ผิดแผนก)</b>`, `ไลน์การผลิต: ${v.line_name}`, `ชื่อรายการ: ${equip}`, `ปัญหา: ${v.problem}`, ``,
          `🛑 เหตุผลที่ตีกลับ: <b>${mo.reject_reason || '-'}</b>`, mo.returned_from_dept ? `ตีกลับจากทีม: ${mo.returned_from_dept}` : '',
          ``, `📌 ผู้แจ้ง (${v.reporter_prod || '-'}) โปรดแก้แผนกให้ถูกต้องแล้วส่งใหม่`].filter(Boolean).join('\n'); break;
      default: return json({ error: 'unknown event' }, 400);
    }
    // เด้งบอก "ขั้นต่อไป" ให้ห้องแชททีมรู้ว่าต้องรออะไรต่อ (ตามที่ user ต้องการ)
    const NEXT: Record<string, string> = {
      mtn_reported: 'รอช่างรับงาน (ขั้น 2)',
      mtn_assigned: 'รอดำเนินการซ่อม (ขั้น 3)',
      mtn_repaired: 'รอตรวจสอบหลังซ่อม (ขั้น 4)',
      mtn_checked: 'รอยืนยันคุณภาพ / รับมอบ (ขั้น 5-6)',
      mtn_qa: 'รอรับมอบ (ขั้น 6)',
      mtn_handover: 'รออนุมัติปิด (ขั้น 7)',
    };
    if (NEXT[event]) builtin += `\n⏳ ขั้นต่อไป: ${NEXT[event]}`;
    const message = pick(routes, event, v, builtin);
    const sent = photo
      ? await sendTelegramPhoto(photo, message, chat).catch(() => [])
      : await sendTelegram(message, chat).catch(() => []);
    await recordSentRefs(sent || [], 'mtn_order', mo.id, event); // reply ใต้ข้อความนี้ = คอมเมนต์ใบ MO
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
