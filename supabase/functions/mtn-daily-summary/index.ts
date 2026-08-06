// สรุปงานซ่อม (MO) ค้างประจำวัน — ยิงทุกเช้า 09:00 ไทย (02:00 UTC) ผ่าน pg_cron
//   → รวมใบที่ยังไม่ปิด (status ไม่ใช่ closed/rejected) นับตามทีม + ขั้นที่ค้าง
//   → ส่งภาพรวมเข้าห้อง "smart maintenance" (route ของ event mtn_daily_summary)
//     + แยกรายทีมเข้าห้องที่แท็กทีมไว้ (telegram_channels.team) ถ้ามี
// อ่าน mtn_orders จาก DR project (DR_URL/DR_ANON_KEY) · routing/bot token จาก Main
// ปิด/แก้ห้อง/แก้ข้อความได้จาก /notification-config (category 'maintenance')
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID');
const DR_URL = (Deno.env.get('DR_URL') || '').replace(/\/$/, '');
const DR_KEY = Deno.env.get('DR_ANON_KEY') || '';
let BOT_TOKEN: string | undefined = TELEGRAM_BOT_TOKEN;

async function getBotToken(): Promise<string | undefined> {
  try {
    const { data } = await supabase.from('notification_settings').select('bot_token').eq('id', 1).maybeSingle();
    const t = data?.bot_token ? String(data.bot_token).trim() : '';
    return t || TELEGRAM_BOT_TOKEN || undefined;
  } catch { return TELEGRAM_BOT_TOKEN || undefined; }
}

type Route = { enabled: boolean; chats: string[]; template?: string | null };
async function loadRoutes(): Promise<{ map: Record<string, Route>; teamChats: Record<string, string[]> }> {
  try {
    const [{ data: rules }, { data: channels }] = await Promise.all([
      supabase.from('notification_rules').select('event_key, is_enabled, channel_ids, channel_id, template'),
      supabase.from('telegram_channels').select('id, chat_id, is_active, team'),
    ]);
    const chatById = new Map<string, string>();
    const teamChats: Record<string, string[]> = {};
    for (const c of channels ?? []) {
      if (!(c.is_active && c.chat_id)) continue;
      const chat = String(c.chat_id).trim();
      chatById.set(String(c.id), chat);
      const team = (c as { team?: string | null }).team;
      if (team) (teamChats[teamKey(team)] ||= []).push(chat);
    }
    const map: Record<string, Route> = {};
    for (const r of rules ?? []) {
      const ids: string[] = Array.isArray((r as Record<string, unknown>).channel_ids)
        ? ((r as Record<string, unknown>).channel_ids as string[])
        : (r as { channel_id?: string }).channel_id ? [(r as { channel_id: string }).channel_id] : [];
      const chats = [...new Set(ids.map((id) => chatById.get(String(id))).filter((v): v is string => !!v))];
      map[r.event_key as string] = { enabled: r.is_enabled as boolean, chats, template: (r as { template?: string | null }).template };
    }
    return { map, teamChats };
  } catch { return { map: {}, teamChats: {} }; }
}
function resolveEvent(routes: Record<string, Route>, key: string): string[] | null {
  const r = routes[key];
  if (r && !r.enabled) return null;
  if (r && r.chats.length) return r.chats;
  return TELEGRAM_CHAT_ID ? [TELEGRAM_CHAT_ID] : [];
}
async function sendTelegram(message: string, chats: string[]) {
  const list = [...new Set(chats.filter(Boolean))];
  if (!BOT_TOKEN || !list.length) return;
  await Promise.all(list.map((chat) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: message, parse_mode: 'HTML' }),
    }).catch(() => null)));
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

const deptFor = (it: string) => { const s = (it || '').toUpperCase(); if (s.includes('JIG')) return 'JIG MTN'; if (s.includes('DIE')) return 'DIE MTN'; return 'MTN'; };
// ทีมช่างเก็บได้ 2 encoding: label (mtn_dept / telegram_channels.team) กับ key (checklists.department)
// mtn_teams = single source โยง 2 ฝั่ง — normalize เป็น key ก่อนจับคู่ห้องทีม กันเข้ารหัสไม่ตรงแล้วส่งไม่ถึง
const TEAM_KEY: Record<string, string> = {
  'mtn': 'maintenance', 'maintenance': 'maintenance',
  'jig mtn': 'jig_maintenance', 'jig_maintenance': 'jig_maintenance',
  'die mtn': 'die_maintenance', 'die_maintenance': 'die_maintenance',
  'production': 'production',
};
const teamKey = (v?: string | null): string => { const s = String(v || '').toLowerCase().trim(); return TEAM_KEY[s] || s; };

// ใบยังไม่ปิดค้างที่สถานะไหน → รอทำอะไรต่อ (แสดงเป็นกลุ่มในสรุป)
const WAIT_LABEL: Record<string, string> = {
  pending:   'รอช่างรับงาน (ขั้น 2)',
  assigned:  'รอดำเนินการซ่อม (ขั้น 3)',
  repairing: 'รอตรวจสอบหลังซ่อม (ขั้น 4)',
  repaired:  'รอตรวจสอบหลังซ่อม (ขั้น 4)',
  checked:   'รอยืนยันคุณภาพ / รับมอบ (ขั้น 5-6)',
  qa:        'รอรับมอบ (ขั้น 6)',
  handover:  'รออนุมัติปิด (ขั้น 7)',
};
const WAIT_ORDER = ['pending', 'assigned', 'repairing', 'repaired', 'checked', 'qa', 'handover'];

type MO = { mo_no?: string; status: string; mtn_dept?: string; item_type?: string; machine_no?: string; line_name?: string; report_at?: string };

function daysOpen(iso?: string): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function buildTeamBlock(rows: MO[]): string {
  // จัดกลุ่มตามสถานะที่ค้าง เรียงตามลำดับขั้น
  const byStatus: Record<string, MO[]> = {};
  for (const m of rows) (byStatus[m.status] ||= []).push(m);
  const lines: string[] = [];
  for (const st of WAIT_ORDER) {
    const list = byStatus[st];
    if (!list || !list.length) continue;
    lines.push(`• <b>${WAIT_LABEL[st] || st}</b> — ${list.length} ใบ`);
    for (const m of list.slice(0, 8)) {
      const equip = `${m.item_type || '-'}${m.machine_no ? ` (${m.machine_no})` : ''}`;
      const d = daysOpen(m.report_at);
      const age = d > 0 ? ` · ค้าง ${d} วัน` : '';
      lines.push(`   ${m.mo_no || '(ยังไม่ออกเลข)'} · ${m.line_name || '-'} · ${equip}${age}`);
    }
    if (list.length > 8) lines.push(`   … และอีก ${list.length - 8} ใบ`);
  }
  return lines.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    BOT_TOKEN = await getBotToken();
    const { map: routes, teamChats } = await loadRoutes();
    const baseChat = resolveEvent(routes, 'mtn_daily_summary');
    if (baseChat === null) return json({ ok: true, skipped: 'disabled' }); // event ถูกปิด

    // ดึงใบที่ยังไม่ปิด/ไม่ถูกปฏิเสธ จาก DR project
    if (!DR_URL || !DR_KEY) return json({ error: 'missing DR env' }, 500);
    const q = `${DR_URL}/rest/v1/mtn_orders?select=mo_no,status,mtn_dept,item_type,machine_no,line_name,report_at`
      + `&status=not.in.(closed,rejected)&order=report_at.asc`;
    const res = await fetch(q, { headers: { apikey: DR_KEY, Authorization: `Bearer ${DR_KEY}` } });
    if (!res.ok) return json({ error: `DR fetch ${res.status}` }, 500);
    const rows: MO[] = await res.json();

    if (!rows.length) {
      await sendTelegram('✅ <b>สรุปงานซ่อมค้าง (MO)</b>\nไม่มีใบแจ้งซ่อมค้าง — เคลียร์หมดทุกทีม 🎉', baseChat);
      return json({ ok: true, total: 0 });
    }

    // จัดกลุ่มตามทีม (mtn_dept — ไม่ระบุ = เดาจากชนิดอุปกรณ์)
    const byDept: Record<string, MO[]> = {};
    for (const m of rows) {
      const dept = (m.mtn_dept && String(m.mtn_dept).trim()) || deptFor(m.item_type || '');
      (byDept[dept] ||= []).push({ ...m, mtn_dept: dept });
    }
    const depts = Object.keys(byDept).sort();

    // ภาพรวมทั้งหมด → ห้องหลัก (smart maintenance)
    const header = `🌅 <b>สรุปงานซ่อมค้าง (MO) ประจำวัน</b>\nค้างทั้งหมด <b>${rows.length}</b> ใบ · ${depts.length} ทีม`;
    const overview = [header, '', ...depts.map((d) => {
      const block = buildTeamBlock(byDept[d]);
      return `━━━ <b>${d}</b> (${byDept[d].length} ใบ) ━━━\n${block}`;
    })].join('\n');
    await sendTelegram(overview, baseChat);

    // แยกรายทีม → ห้องของทีม (ถ้ามีห้องแท็กทีมไว้)
    for (const d of depts) {
      const room = teamChats[teamKey(d)];
      if (!room || !room.length) continue;
      const msg = `🌅 <b>งานซ่อมค้างของทีม ${d}</b>\nค้าง <b>${byDept[d].length}</b> ใบ\n\n${buildTeamBlock(byDept[d])}`;
      await sendTelegram(msg, room);
    }

    return json({ ok: true, total: rows.length, teams: depts.length });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
