// ── telegram-webhook — ขา "รับ" ของบอท ESM (Main project · 2026-07-16) ──────────
// Telegram ยิงทุก update เข้ามาที่นี่ (ตั้งด้วย setWebhook + secret_token — ดู README ใต้ไฟล์)
// ความสามารถ:
//   1. กวาดเก็บข้อความจากกลุ่มที่ลงทะเบียนใน telegram_channels → telegram_messages (วิเคราะห์ย้อนหลัง)
//   2. reply ใต้ข้อความแจ้งเตือนของบอท → บันทึกเป็นคอมเมนต์ event_comments (DR) ผูกใบงานอัตโนมัติ
//      (ต้องมี mapping ใน telegram_sent_messages — ฟังก์ชันส่งถูก patch ให้จำ message_id แล้ว)
//   3. AI intake: "/dt RB80 โรบอทชนจิ๊ก 14.00-14.20" (ทุกกลุ่มลงทะเบียน) หรือพิมพ์อิสระ
//      ในกลุ่มที่อยู่ใน env AI_INTAKE_CHAT_IDS → Claude แยกฟิลด์ → ground กับ machines/
//      dr_downtime_types/production_sessions จริง → ส่งข้อความสรุป + ปุ่ม [✅ บันทึก][❌ ยกเลิก]
//      คนกดยืนยันแล้วเท่านั้นถึง insert downtime_logs — AI ห้ามเขียนฐานเองเด็ดขาด
// กฎ work date เดียวกับทั้งระบบ: ตัด 08:00 เวลาไทย (ห้าม UTC)
//
// Secrets ที่ต้องตั้ง (Supabase dashboard → Edge Functions → telegram-webhook):
//   TELEGRAM_WEBHOOK_SECRET  รหัสลับที่ตั้งตอน setWebhook (บังคับ)
//   DR_URL / DR_ANON_KEY     project DR (event_comments/machines/downtime_logs — ตาราง anon-open)
//   ANTHROPIC_API_KEY        เปิดใช้ AI intake (ไม่ตั้ง = ข้อ 3 ปิด, ข้อ 1-2 ยังทำงาน)
//   AI_INTAKE_CHAT_IDS       chat_id ที่ให้แปลทุกข้อความ (คั่น comma) — กลุ่มอื่นใช้ /dt เท่านั้น
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const WEBHOOK_SECRET = Deno.env.get('TELEGRAM_WEBHOOK_SECRET') || '';
const DR_URL = (Deno.env.get('DR_URL') || '').replace(/\/$/, '');
const DR_KEY = Deno.env.get('DR_ANON_KEY') || '';
const AI_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const AI_CHATS = (Deno.env.get('AI_INTAKE_CHAT_IDS') || '').split(',').map((s) => s.trim()).filter(Boolean);
let BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '';

async function getBotToken(): Promise<string> {
  try {
    const { data } = await supabase.from('notification_settings').select('bot_token').eq('id', 1).maybeSingle();
    return (data?.bot_token ? String(data.bot_token).trim() : '') || BOT_TOKEN;
  } catch { return BOT_TOKEN; }
}

/* ── Telegram API helpers ── */
const tg = (method: string, body: Record<string, unknown>) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => null);

const reply = (chatId: string | number, text: string, replyTo?: number, keyboard?: unknown) =>
  tg('sendMessage', {
    chat_id: chatId, text, parse_mode: 'HTML',
    ...(replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {}),
    ...(keyboard ? { reply_markup: keyboard } : {}),
  });

/* ── DR project REST (ตาราง anon-open ตาม convention DR) ── */
async function dr(path: string, init?: RequestInit): Promise<unknown[] | null> {
  if (!DR_URL || !DR_KEY) return null;
  try {
    const res = await fetch(`${DR_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: DR_KEY, Authorization: `Bearer ${DR_KEY}`, 'Content-Type': 'application/json',
        Prefer: init?.method === 'POST' ? 'return=representation' : 'count=none',
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) { console.warn('DR', path, res.status, await res.text()); return null; }
    return res.status === 204 ? [] : await res.json();
  } catch (e) { console.warn('DR fetch fail', e); return null; }
}

/* ── work date ไทย ตัด 08:00 (กฎเดียวกับ getWorkDate ทั้งระบบ — ห้าม UTC) ── */
function bkkNowParts() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g: Record<string, string> = {}; for (const x of p) g[x.type] = x.value;
  return { y: +g.year, m: +g.month, d: +g.day, hh: +g.hour, mi: +g.minute };
}
function workDateBkk(): string {
  const { y, m, d, hh } = bkkNowParts();
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (hh < 8) dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}
// เวลา HH:MM บนกรอบวันงาน → ISO (+07:00) · ชั่วโมง < 08:00 = ข้ามเที่ยงคืน (กะดึกช่วงเช้ามืดวันถัดไป)
// ⚠️ ใช้ Date.UTC เป็นตัวนับวันแบบ date-only เท่านั้น — ห้าม new Date('...+07:00') แล้วอ่าน getUTC*
// (จะ shift ไป 1 วันเพราะ instant เที่ยงคืนไทย = 17:00 UTC วันก่อน → downtime ลงผิดวัน = OEE เพี้ยน)
function frameTimeToIso(workDate: string, hm: string): string | null {
  const m = hm.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const hh = +m[1], mi = +m[2];
  if (hh > 23 || mi > 59) return null;
  const [wy, wmo, wd] = workDate.split('-').map(Number);
  if (!wy || !wmo || !wd) return null;
  const base = new Date(Date.UTC(wy, wmo - 1, wd)); // เที่ยงคืน UTC ของวันงาน = ตัวนับวันบริสุทธิ์
  if (hh < 8) base.setUTCDate(base.getUTCDate() + 1);
  const y = base.getUTCFullYear(), mo = String(base.getUTCMonth() + 1).padStart(2, '0'), d = String(base.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}T${String(hh).padStart(2, '0')}:${String(mi).padStart(2, '0')}:00+07:00`;
}

/* ── AI: แยกฟิลด์จากภาษาคน (Claude Haiku — ตีความอย่างเดียว ไม่แตะฐานข้อมูล) ── */
async function aiExtract(text: string, typeNames: string[]): Promise<{ intent: string; machine?: string; cause?: string; type_name?: string; start?: string; end?: string } | null> {
  if (!AI_KEY) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001', max_tokens: 300,
        system: [
          'คุณเป็นตัวแยกข้อมูลรายงานปัญหาในโรงงาน ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่น',
          'รูปแบบ: {"intent":"downtime"|"none","machine":"รหัสเครื่อง","cause":"อาการตามที่พิมพ์","type_name":"ประเภทที่ใกล้สุดจากรายการ","start":"HH:MM","end":"HH:MM"}',
          'intent=downtime เมื่อข้อความรายงานเครื่องจักรหยุด/เสีย/ขัดข้อง มีรหัสเครื่องหรือเวลาประกอบ — ไม่แน่ใจให้ intent=none',
          'type_name ต้องเลือกจากรายการนี้แบบตรงตัวอักษรเท่านั้น (เลือกใกล้เคียงอาการที่สุด): ' + JSON.stringify(typeNames),
          'เวลาเขียนได้หลายแบบ (14.00, 14:00, บ่ายสอง) ให้แปลงเป็น HH:MM 24 ชม. · ไม่มีเวลาจบให้เว้น end',
        ].join('\n'),
        messages: [{ role: 'user', content: text }],
      }),
    });
    if (!res.ok) { console.warn('anthropic', res.status, await res.text()); return null; }
    const data = await res.json();
    const out = (data?.content?.[0]?.text || '').trim().replace(/^```json?\s*|```$/g, '');
    return JSON.parse(out);
  } catch (e) { console.warn('aiExtract fail', e); return null; }
}

/* ── AI intake: ground กับฐานจริง → สร้างคิวรอยืนยัน ── */
async function handleIntake(chatId: string, msg: Record<string, any>, text: string) {
  const fromName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'ไม่ระบุ';

  const types = (await dr('dr_downtime_types?select=id,name_th,category&order=name_th') || []) as Record<string, any>[];
  const extract = await aiExtract(text, types.map((t) => String(t.name_th)));
  if (!extract || extract.intent !== 'downtime') return; // ไม่ใช่รายงานปัญหา — เงียบ

  if (!extract.machine) { await reply(chatId, '🤖 อ่านไม่ออกว่าเครื่องไหนครับ — พิมพ์รหัสเครื่องด้วย เช่น "RB80 โรบอทชนจิ๊ก 14.00-14.20"', msg.message_id); return; }

  // ground เครื่องกับทะเบียนจริง (ไม่เดา) — หาแบบตรงก่อน แล้วค่อย fuzzy
  const mcode = String(extract.machine).toUpperCase().replace(/\s/g, '');
  let machines = (await dr(`machines?select=machine_no,line_name,name&machine_no=ilike.${encodeURIComponent(mcode)}`) || []) as Record<string, any>[];
  if (!machines.length) machines = (await dr(`machines?select=machine_no,line_name,name&machine_no=ilike.${encodeURIComponent('%' + mcode + '%')}&limit=5`) || []) as Record<string, any>[];
  if (!machines.length) { await reply(chatId, `🤖 ไม่พบเครื่อง "<b>${mcode}</b>" ในทะเบียนเครื่องจักร — ตรวจรหัสอีกครั้งครับ`, msg.message_id); return; }
  if (machines.length > 1) {
    await reply(chatId, `🤖 พบหลายเครื่องใกล้เคียง "<b>${mcode}</b>": ${machines.map((x) => `${x.machine_no} (${x.line_name || '-'})`).join(' · ')}\nพิมพ์รหัสเต็มอีกครั้งครับ`, msg.message_id);
    return;
  }
  const mc = machines[0];

  // หากะที่เปิดอยู่ของไลน์นั้น (วันงานปัจจุบัน)
  const wd = workDateBkk();
  const sessions = (await dr(`production_sessions?select=id,line_name,shift,status&work_date=eq.${wd}&line_name=eq.${encodeURIComponent(mc.line_name)}&status=in.(open,pending_close)`) || []) as Record<string, any>[];
  if (!sessions.length) { await reply(chatId, `🤖 ไลน์ <b>${mc.line_name}</b> ยังไม่เปิดกะของวันงานนี้ — ลงจากหน้าเว็บได้เมื่อเปิดกะแล้วครับ`, msg.message_id); return; }
  const startIso = extract.start ? frameTimeToIso(wd, extract.start) : null;
  const endIso = extract.end ? frameTimeToIso(wd, extract.end) : null;
  const startHH = extract.start ? +extract.start.split(/[:.]/)[0] : bkkNowParts().hh;
  const shiftGuess = startHH >= 8 && startHH < 20 ? 'day' : 'night';
  const session = sessions.find((s) => s.shift === shiftGuess) || sessions[0];
  const durMin = startIso && endIso ? Math.max(1, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000)) : null;

  const typeRow = types.find((t) => String(t.name_th) === String(extract.type_name || ''));
  if (!typeRow) { await reply(chatId, `🤖 จับคู่ประเภท downtime ไม่ได้ — ระบุอาการชัดขึ้น หรือลงจากหน้าเว็บครับ`, msg.message_id); return; }

  const payload = {
    insert: {
      session_id: session.id, downtime_type_id: typeRow.id, machine_no: mc.machine_no,
      description: `${extract.cause || text} (จาก Telegram โดย ${fromName})`,
      started_at: startIso, ended_at: endIso, duration_min: durMin,
      reported_by_name: `${fromName} (Telegram)`,
    },
    display: { line: mc.line_name, machine: mc.machine_no, type: typeRow.name_th, start: extract.start || '-', end: extract.end || '-', dur: durMin },
  };
  const { data: pend, error } = await supabase.from('telegram_pending_actions')
    .insert({ chat_id: String(chatId), requested_by: fromName, action: 'log_downtime', payload }).select('id').single();
  if (error || !pend) { console.warn('pending insert', error?.message); return; }

  const summary = [
    `🤖 <b>จะบันทึก Downtime — กดยืนยันก่อนถึงลงจริง</b>`,
    `🏭 ไลน์: <b>${mc.line_name}</b> (${session.shift === 'day' ? '☀️ กะเช้า' : '🌙 กะดึก'})`,
    `⚙️ เครื่อง: <b>${mc.machine_no}</b>${mc.name ? ` (${mc.name})` : ''}`,
    `🛑 ประเภท: ${typeRow.name_th}`,
    `🕐 เวลา: ${extract.start || '-'}${extract.end ? ` – ${extract.end}` : ''}${durMin ? ` (${durMin} นาที)` : ' (ยังไม่ปิดรายการ)'}`,
    `📝 "${extract.cause || text}"`,
    `🙋 ผู้แจ้ง: ${fromName}`,
  ].join('\n');
  const sent = await reply(chatId, summary, msg.message_id, {
    inline_keyboard: [[
      { text: '✅ บันทึก', callback_data: `dt_ok:${pend.id}` },
      { text: '❌ ยกเลิก', callback_data: `dt_no:${pend.id}` },
    ]],
  });
  const sentId = sent?.result?.message_id;
  if (sentId) await supabase.from('telegram_pending_actions').update({ message_id: sentId }).eq('id', pend.id);
}

/* ── ปุ่มยืนยัน/ยกเลิก ── */
async function handleCallback(cb: Record<string, any>) {
  const dataStr = String(cb.data || '');
  const m = dataStr.match(/^dt_(ok|no):(.+)$/);
  if (!m) { await tg('answerCallbackQuery', { callback_query_id: cb.id }); return; }
  const [, verb, id] = m;
  const who = [cb.from?.first_name, cb.from?.last_name].filter(Boolean).join(' ') || cb.from?.username || 'ไม่ระบุ';
  const { data: pend } = await supabase.from('telegram_pending_actions').select('*').eq('id', id).maybeSingle();
  if (!pend || pend.status !== 'pending') {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'รายการนี้ถูกจัดการไปแล้ว' }); return;
  }
  // หมดอายุ 6 ชม. — กันกดยืนยันข้ามกะแล้วข้อมูลผิดบริบท
  if (Date.now() - new Date(pend.created_at).getTime() > 6 * 3600e3) {
    await supabase.from('telegram_pending_actions').update({ status: 'expired', decided_at: new Date().toISOString(), decided_by: who }).eq('id', id);
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'หมดอายุแล้ว — พิมพ์แจ้งใหม่ครับ' }); return;
  }
  const chatId = cb.message?.chat?.id, msgId = cb.message?.message_id;
  if (verb === 'no') {
    await supabase.from('telegram_pending_actions').update({ status: 'cancelled', decided_at: new Date().toISOString(), decided_by: who }).eq('id', id);
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'ยกเลิกแล้ว' });
    if (chatId && msgId) await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: `${cb.message?.text || ''}\n\n❌ ยกเลิกโดย ${who}` });
    return;
  }
  // ยืนยัน → เขียนลง DR downtime_logs (แถวเดียวกับที่กรอกจากหน้าเว็บ)
  const ins = await dr('downtime_logs', { method: 'POST', body: JSON.stringify(pend.payload.insert) });
  if (!ins) {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'บันทึกไม่สำเร็จ — ลองจากหน้าเว็บครับ', show_alert: true }); return;
  }
  await supabase.from('telegram_pending_actions').update({ status: 'confirmed', decided_at: new Date().toISOString(), decided_by: who }).eq('id', id);
  await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ บันทึกแล้ว' });
  if (chatId && msgId) await tg('editMessageText', { chat_id: chatId, message_id: msgId, text: `${cb.message?.text || ''}\n\n✅ บันทึกลงระบบแล้ว โดย ${who}` });
}

/* ── Handler ── */
Deno.serve(async (req) => {
  // ยืนยันว่ามาจาก Telegram จริง (secret ที่ตั้งตอน setWebhook) — ไม่ตรง = ทิ้งเงียบ
  if (WEBHOOK_SECRET && req.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  BOT_TOKEN = await getBotToken();
  let update: Record<string, any>;
  try { update = await req.json(); } catch { return new Response('ok'); }

  try {
    if (update.callback_query) { await handleCallback(update.callback_query); return new Response('ok'); }

    const msg = update.message || update.edited_message;
    if (!msg?.chat?.id) return new Response('ok');
    const chatId = String(msg.chat.id);

    // เก็บเฉพาะกลุ่มที่ลงทะเบียน (telegram_channels) — กลุ่มอื่น/แชทแปลกปลอมทิ้งเงียบ
    const { data: chans } = await supabase.from('telegram_channels').select('chat_id, is_active');
    const registered = (chans || []).some((c) => c.is_active && String(c.chat_id).trim() === chatId);
    if (!registered) return new Response('ok');

    const text = String(msg.text || msg.caption || '');
    const fromName = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || null;

    // 1) กวาดเก็บ (dedupe ด้วย update_id — Telegram retry ได้)
    await supabase.from('telegram_messages').upsert({
      update_id: update.update_id ?? null, chat_id: chatId, chat_title: msg.chat.title || null,
      message_id: msg.message_id, from_id: msg.from?.id ? String(msg.from.id) : null, from_name: fromName,
      text: text || null, reply_to_message_id: msg.reply_to_message?.message_id ?? null,
      kind: update.edited_message ? 'edited' : text.startsWith('/') ? 'command' : msg.reply_to_message ? 'reply' : 'message',
      msg_at: msg.date ? new Date(msg.date * 1000).toISOString() : null, raw: update,
    }, { onConflict: 'update_id', ignoreDuplicates: true });

    // 2) reply ใต้ข้อความแจ้งเตือนของบอท → คอมเมนต์ผูกใบงาน (event_comments ฝั่ง DR)
    if (msg.reply_to_message?.message_id && text) {
      const { data: map } = await supabase.from('telegram_sent_messages').select('ref_kind, ref_id')
        .eq('chat_id', chatId).eq('message_id', msg.reply_to_message.message_id).maybeSingle();
      if (map) {
        const ok = await dr('event_comments', {
          method: 'POST',
          body: JSON.stringify({ ref_kind: map.ref_kind, ref_id: String(map.ref_id), author_name: `${fromName || 'ไม่ระบุ'} (Telegram)`, body: text }),
        });
        if (ok) await tg('setMessageReaction', { chat_id: chatId, message_id: msg.message_id, reaction: [{ type: 'emoji', emoji: '✍' }] });
        return new Response('ok');
      }
    }

    // 3) AI intake — /dt ทุกกลุ่มลงทะเบียน · พิมพ์อิสระเฉพาะกลุ่มใน AI_INTAKE_CHAT_IDS
    if (text.startsWith('/dt ')) await handleIntake(chatId, msg, text.slice(4).trim());
    else if (AI_CHATS.includes(chatId) && text && !text.startsWith('/') && !update.edited_message) await handleIntake(chatId, msg, text);
  } catch (e) {
    console.error('telegram-webhook', e);
  }
  return new Response('ok'); // ตอบ 200 เสมอ — กัน Telegram retry ถล่ม
});
