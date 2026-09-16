// สรุปงานซ่อม (MO) ค้างประจำวัน — ยิงทุกเช้า 09:00 ไทย (02:00 UTC) ผ่าน pg_cron
//   → รวมใบที่ยังไม่ปิด (status ไม่ใช่ closed/rejected) นับตามทีม + ขั้นที่ค้าง
//   → ส่งภาพรวมเข้าห้อง "smart maintenance" (route ของ event mtn_daily_summary)
//     + แยกรายทีมเข้าห้องที่แท็กทีมไว้ (telegram_channels.team) ถ้ามี
//   → 📥 บล็อก "ใบที่รอฝ่ายผู้แจ้งดำเนินการ" (ขั้น 4/6/7) แยกรายส่วนงาน → ห้องฝั่งผลิต
//     + กระดิ่งในแอปถึงคนในส่วนงานนั้น (event mtn_pickup_pending · 2026-09-16)
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
/* ── 🔔 แจ้งเตือน "ในแอป" (กระดิ่ง + Web Push ผ่าน trigger trg_notify_push) ───────────────
   เดิมฟังก์ชันนี้ส่ง **Telegram ทางเดียว** — ถอด Telegram ออกเมื่อไหร่ การแจ้งเตือนหายสนิท
   (พบตอนสำรวจการย้ายระบบลง on-premise 2026-09-14 · ดู docs/LOCAL-SERVER-MIGRATION-SPEC.md §13)
   ⚠️ ผู้รับมาจาก RPC `notify_recipients` จุดเดียวของระบบ (role × ส่วนงาน × แผนก)
      **ห้ามเขียนเงื่อนไขกรองผู้รับในไฟล์นี้** — Telegram กับในแอปต้องอ้างกติกาแถวเดียวกัน
   ⚠️ ไม่ตั้ง `inapp_roles` ที่ /notification-config = ไม่แจ้งในแอป (opt-in)
      ⇒ deploy แล้วพฤติกรรมเดิมเป๊ะ จนกว่า admin จะตั้งผู้รับ
   คืนค่า: ส่งถึงใครจริงไหม (ผู้เรียกบางจุดใช้ตัดสินว่าจะ mark ว่าแจ้งแล้วหรือยัง) */
async function notifyInApp(eventKey: string, htmlMessage: string, type = 'info',
                           section: string | null = null): Promise<boolean> {
  const { data: rule, error: ruleErr } = await supabase
    .from('notification_rules').select('label, inapp_roles').eq('event_key', eventKey).maybeSingle();
  if (ruleErr) { console.error('mtn-daily-summary: load rule', ruleErr.message); return false; }
  const roles = Array.isArray(rule?.inapp_roles) ? (rule!.inapp_roles as string[]) : [];
  if (!roles.length) return false;                    // ยังไม่ตั้งผู้รับ = เงียบตามเดิม
  let users: string[] = [];
  // ส่ง section ต่อให้ RPC — บล็อก "รอฝ่ายผู้แจ้ง" ยิงถึงคนในส่วนงานนั้นเท่านั้น
  // (กติกากรองอยู่ใน notify_recipients ที่เดียว · inapp_match_section=false = ได้ทุกคนตามเดิม)
  const { data, error } = await supabase.rpc('notify_recipients', { p_event: eventKey, p_section: section });
  if (error) {                                        // RPC ล่ม = ถอยไปตาม role ห้ามเงียบ
    console.error('mtn-daily-summary: notify_recipients', error.message);
    const { data: byRole } = await supabase.from('profiles').select('id').in('role', roles);
    users = (byRole ?? []).map((p) => p.id as string);
  } else {
    users = (data ?? []).map((r: unknown) =>
      typeof r === 'string' ? r : (r as { notify_recipients?: string })?.notify_recipients).filter(Boolean) as string[];
  }
  const ids = [...new Set(users.filter(Boolean))];
  if (!ids.length) return false;
  const body = String(htmlMessage)
    .replace(/<[^>]+>/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
  // supabase-js ไม่ throw — ต้องอ่าน error เอง ไม่งั้นแจ้งเตือนหายเงียบ (กฎเหล็กข้อ 1 ใน CLAUDE.md)
  const { error: insErr } = await supabase.from('notifications').insert(
    ids.map((uid) => ({ user_id: uid, title: rule?.label || eventKey, body, type })),
  );
  if (insErr) { console.error('mtn-daily-summary: insert notifications', insErr.message); return false; }
  return true;
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
    }).then(async (r) => { if (!r.ok) console.error('mtn-daily-summary: telegram', chat, r.status, await r.text().catch(() => '')); })
      .catch((e) => console.error('mtn-daily-summary: telegram', chat, String(e)))));
}

/** ส่งข้อความยาวเป็นหลายก้อน — Telegram ตัดที่ 4096 ตัวอักษร **แล้วคืน 400 ทั้งข้อความ**
 *  (ไม่ใช่ตัดท้ายให้) ⇒ ส่วนงาน/ใบเยอะขึ้นเมื่อไหร่ สรุปจะหายทั้งก้อนเงียบๆ
 *  head = บรรทัดหัวที่ต้องติดไปทุกก้อน · parts = บล็อกที่แบ่งได้ (ไม่ตัดกลางบล็อก) */
async function sendChunked(head: string, parts: string[], chats: string[], limit = 3600) {
  let buf = head;
  for (const part of parts) {
    if (buf.length + part.length + 2 > limit && buf !== head) { await sendTelegram(buf, chats); buf = head; }
    buf += `\n\n${part}`;
  }
  if (buf !== head || !parts.length) await sendTelegram(buf, chats);
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

const deptFor = (it: string) => { const s = (it || '').toUpperCase(); if (s.includes('JIG')) return 'jig_maintenance'; if (s.includes('DIE')) return 'die_maintenance'; return 'maintenance'; };
// ทีมช่างเก็บเป็น key แล้วทั้งระบบ (migration 20260806_unify_team_encoding) — normalize ต่อไปเผื่อข้อมูล/คนกรอกที่ยังเป็นชื่อ
const TEAM_KEY: Record<string, string> = {
  'mtn': 'maintenance', 'maintenance': 'maintenance',
  'jig mtn': 'jig_maintenance', 'jig_maintenance': 'jig_maintenance',
  'die mtn': 'die_maintenance', 'die_maintenance': 'die_maintenance',
  'production': 'production',
};
const teamKey = (v?: string | null): string => { const s = String(v || '').toLowerCase().trim(); return TEAM_KEY[s] || s; };
// key → ชื่อที่ใช้แสดง · ดึงจาก mtn_teams ฝั่ง DR (ทีมถูกเปลี่ยนชื่อแล้วสรุปตามทันที) fallback = ค่าเริ่มต้น
const TEAM_NAME: Record<string, string> = {
  maintenance: 'MTN', jig_maintenance: 'JIG MTN', die_maintenance: 'DIE MTN', production: 'PRODUCTION',
};
async function loadTeamNames() {
  try {
    const r = await fetch(`${DR_URL}/rest/v1/mtn_teams?select=key,dept_name`, { headers: { apikey: DR_KEY, Authorization: `Bearer ${DR_KEY}` } });
    if (!r.ok) return;
    const rows = await r.json() as { key: string; dept_name?: string }[];
    for (const t of rows) if (t?.key && t.dept_name) TEAM_NAME[t.key] = t.dept_name;
  } catch { /* ใช้ค่า fallback — สรุปรายวันห้ามล้มเพราะชื่อทีม */ }
}
const teamName = (v?: string | null): string => TEAM_NAME[teamKey(v)] || String(v || '');

/* ใบยังไม่ปิดค้างที่สถานะไหน → รอทำอะไรต่อ (แสดงเป็นกลุ่มในสรุป)
   ⚠️ `checked` (ผ่านขั้น 4) **แตกเป็น 2 กลุ่มคนละคนต้องกด** ตาม `quality_related`:
        QA ยังไม่ตัดสิน     → รอ QA ตรวจ (ขั้น 5)
        QA ระบุว่าไม่เกี่ยว → รอฝ่ายที่แจ้งมารับมอบ (ขั้น 6)
      กลุ่มรวม "รอยืนยันคุณภาพ / รับมอบ" ทำให้ทุกทีมอ่านว่ายังรอ QA แล้วใบกองค้าง
      (วัดฐานจริง 2026-09-09: checked 76 + qa 64 = 140 ใบรอขั้น 6 โตวันละ ~20 ใบ เก่าสุด 25/08)
   🔴 2026-09-14: ตัวแยกเปลี่ยนจาก `quality_related` (ผู้แจ้งเลือกเองที่ขั้น 4) เป็น `qa_skipped_at`
      (ร่องรอยที่ QA กด) ตามกฎใหม่ "ไม่เกี่ยวกับคุณภาพ = คำตัดสินของ QA เท่านั้น"
   source of truth ของเกณฑ์แยก = `moStatusLabel()`/`isWaitingQa()` ใน `src/utils/mtnStepPerm.js`
   (edge import จาก src/ ไม่ได้ → เขียนซ้ำแบบย่อที่นี่ · แก้ที่นั่นแล้วต้องแก้ที่นี่ด้วย) */
const WAIT_LABEL: Record<string, string> = {
  pending:           'รอช่างรับงาน (ขั้น 2)',
  /* ⚠️ `returned` = ใบที่ทีมช่างตีกลับให้ผู้แจ้ง (แจ้งผิดแผนก) — เคยตกหล่นจาก WAIT_ORDER
     ⇒ ใบถูกดึงมาแล้ว **หายจากทุกบล็อกในสรุปเช้า** ไม่มีใครเห็นว่าต้องไปแก้แผนกแล้วส่งใหม่
     (บันทึกไว้เป็น known gap ตั้งแต่ 09/09 · เติมจริง 14/09) */
  returned:          'ถูกตีกลับ — รอผู้แจ้งแก้แผนกแล้วส่งใหม่ (ขั้น 1)',
  assigned:          'รอดำเนินการซ่อม (ขั้น 3)',
  repairing:         'รอตรวจสอบหลังซ่อม (ขั้น 4)',
  repaired:          'รอตรวจสอบหลังซ่อม (ขั้น 4)',
  checked_qa:        'รอ QA ตรวจคุณภาพ (ขั้น 5)',
  checked_handover:  'รอฝ่ายที่แจ้งรับมอบ (ขั้น 6) — QA ระบุว่าไม่เกี่ยวกับคุณภาพ',
  qa:                'รอรับมอบ (ขั้น 6)',
  handover:          'รออนุมัติปิด (ขั้น 7)',
};
const WAIT_ORDER = ['pending', 'returned', 'assigned', 'repairing', 'repaired', 'checked_qa', 'checked_handover', 'qa', 'handover'];

type MO = { mo_no?: string; status: string; mtn_dept?: string; item_type?: string; machine_no?: string; line_name?: string; report_at?: string; qa_skipped_at?: string | null };

/** คีย์กลุ่ม "รออะไรอยู่" — เท่ากับ status ยกเว้น checked ที่แตกตามคำตัดสินของ QA
 *  🔴 2026-09-14: ใบผ่านขั้น 4 = รอ QA เสมอ · จะไป "รอรับมอบ" ได้ต่อเมื่อ **QA** กดว่าไม่เกี่ยว
 *  (qa_skipped_at) — เดิมดู quality_related ที่ผู้แจ้งเลือกเองที่ขั้น 4 */
const waitKey = (m: MO): string =>
  m.status === 'checked' ? (m.qa_skipped_at ? 'checked_handover' : 'checked_qa') : m.status;

function daysOpen(iso?: string): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

/* ═══ บล็อก "ใบที่รอฝ่ายคุณรับมอบ" — ส่งถึง**ฝ่ายผู้แจ้ง** ไม่ใช่ทีมช่าง (2026-09-16) ═══
   ที่มา: ใบค้างเกิน 7 วันพุ่ง 53 (11/09) → 69 (15/09) → 90 (16/09)
   วัดฐานจริง 16/09 (เปิดอยู่ 196 ใบ · ค้างเกิน 7 วัน 100 ใบ):
     **129 ใบ (66%) รออยู่ที่ฝั่งผู้แจ้ง ไม่ใช่ที่ช่าง** — และในใบที่ค้างเกิน 7 วัน
     **83 จาก 100 ใบ (83%) เป็นของฝั่งผู้แจ้งล้วนๆ** (qa 56 · repaired 22 · checked_handover 4 · handover 1)
   ⇒ สรุปเช้าเดิมส่งเข้าห้องช่างอย่างเดียว = เตือนผิดคนมาตลอด ใบเลยไม่มีวันถูกเคลียร์
   ⚠️ `checked_qa` (ผ่านขั้น 4 · QA ยังไม่ตัดสิน) **ไม่อยู่ในบล็อกนี้** — รอ QA ไม่ใช่รอผู้แจ้ง
   ขั้นที่รอฝั่งผู้แจ้ง (source of truth = `MTN_STEPS[].reporterSide` ใน src/utils/mtnStepPerm.js):
     4 ตรวจรับงานหลังซ่อม (ผู้เปิดใบ) · 6 รับมอบ (หัวหน้าแผนกผู้แจ้ง) · 7 อนุมัติปิด (ผจก.ผู้แจ้ง)
   ⚠️ จัดกลุ่มด้วย **ส่วนงานที่ถอดจาก `line_name`** ห้ามใช้ `dept_section`
      (วัดจริง 16/09: dept_section ว่าง 41/62 ใบสถานะ qa แต่ line_name มีครบ 100%) */
const REPORTER_WAIT = ['repairing', 'repaired', 'checked_handover', 'qa', 'handover'];
const STUCK_DAYS = 7;

/** ชื่อไลน์ → ส่วนงาน (ไลน์ลูกไม่ตั้ง section = ใช้ของไลน์แม่ · กฎเดียวกับ sectionOfLine ใน send-mtn-notification)
 *  production_lines อยู่ Main project (34 แถว) — ดึงทีเดียวแล้ว map ในหน่วยความจำ ไม่ยิงรายใบ */
async function loadLineSections(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const { data, error } = await supabase.from('production_lines').select('name, section, parent_line_name');
  if (error) { console.error('mtn-daily-summary: production_lines', error.message); return out; }
  const byName = new Map((data ?? []).map((l) => [String(l.name), l as Record<string, string | null>]));
  for (const [name, l] of byName) {
    let sec = l.section ? String(l.section).trim() : '';
    if (!sec && l.parent_line_name) sec = String(byName.get(String(l.parent_line_name))?.section || '').trim();
    if (sec) out.set(name, sec);
  }
  return out;
}
const NO_SECTION = '(ไม่ระบุส่วนงาน)';

/** ป้ายอุปกรณ์ในบรรทัดรายการ — ใบส่วนใหญ่ไม่กรอก `item_type` (วัดจริง 16/09: 129 ใบ กรอกแค่ 26)
 *  เดิมต่อสตริงตรงๆ ได้ "- (RB-141)" ⇒ ใช้เท่าที่มี ไม่มีเลยค่อยเป็น '-' */
const equipLabel = (m: MO): string =>
  [String(m.item_type || '').trim(), String(m.machine_no || '').trim()].filter(Boolean).join(' · ') || '-';

/** รายการใบของ 1 ส่วนงาน — แยกตามขั้นที่รอ เรียงใบเก่าสุดขึ้นก่อน (rows เรียง report_at asc มาแล้ว) */
function buildPickupBlock(rows: MO[]): string {
  const byStatus: Record<string, MO[]> = {};
  for (const m of rows) (byStatus[waitKey(m)] ||= []).push(m);
  const lines: string[] = [];
  for (const st of WAIT_ORDER) {
    const list = byStatus[st];
    if (!list || !list.length) continue;
    const stuck = list.filter((m) => daysOpen(m.report_at) >= STUCK_DAYS).length;
    lines.push(`• <b>${WAIT_LABEL[st] || st}</b> — ${list.length} ใบ${stuck ? ` (ค้างเกิน ${STUCK_DAYS} วัน ${stuck} ใบ)` : ''}`);
    for (const m of list.slice(0, 5)) {
      const d = daysOpen(m.report_at);
      lines.push(`   ${d >= STUCK_DAYS ? '🔴' : '·'} ${m.mo_no || '(ยังไม่ออกเลข)'} · ${m.line_name || '-'} · ${equipLabel(m)}${d > 0 ? ` · ค้าง ${d} วัน` : ''}`);
    }
    if (list.length > 5) lines.push(`   … และอีก ${list.length - 5} ใบ (ดูทั้งหมดในหน้าแจ้งซ่อม)`);
  }
  return lines.join('\n');
}

function buildTeamBlock(rows: MO[]): string {
  // จัดกลุ่มตามสถานะที่ค้าง เรียงตามลำดับขั้น
  const byStatus: Record<string, MO[]> = {};
  for (const m of rows) (byStatus[waitKey(m)] ||= []).push(m);
  const lines: string[] = [];
  for (const st of WAIT_ORDER) {
    const list = byStatus[st];
    if (!list || !list.length) continue;
    lines.push(`• <b>${WAIT_LABEL[st] || st}</b> — ${list.length} ใบ`);
    for (const m of list.slice(0, 8)) {
      const d = daysOpen(m.report_at);
      const age = d > 0 ? ` · ค้าง ${d} วัน` : '';
      lines.push(`   ${m.mo_no || '(ยังไม่ออกเลข)'} · ${m.line_name || '-'} · ${equipLabel(m)}${age}`);
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
    await loadTeamNames();   // ชื่อทีมล่าสุดจาก mtn_teams (best-effort)
    /* qa_skipped_at = ตัวแยกกลุ่ม checked (รอ QA / รอรับมอบ) — ขาดคอลัมน์นี้ = สรุปบอกผิดว่าใครต้องกด
       ⚠️ `transferred` (2026-09-14) = ทีมนี้แก้ไม่ได้ ส่งต่อทีมอื่นแล้ว มีใบใหม่รับช่วงต่อ
          ต้องตัดออกเหมือน closed/rejected ไม่งั้นสรุปเช้านับ 1 ปัญหาเป็น 2 ใบค้าง
       source of truth ของ "สถานะไหนถือว่าจบ" = `MO_DONE_STATUSES` ใน src/utils/mtnStepPerm.js */
    const q = `${DR_URL}/rest/v1/mtn_orders?select=mo_no,status,mtn_dept,item_type,machine_no,line_name,report_at,qa_skipped_at`
      + `&status=not.in.(closed,rejected,transferred)&order=report_at.asc`;
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
      // จัดกลุ่มด้วย key เสมอ — ข้อมูลเก่าที่เป็นชื่อจะไม่แตกเป็นคนละกลุ่มกับข้อมูลใหม่
      const dept = teamKey((m.mtn_dept && String(m.mtn_dept).trim()) || deptFor(m.item_type || ''));
      (byDept[dept] ||= []).push({ ...m, mtn_dept: dept });
    }
    const depts = Object.keys(byDept).sort();

    // ภาพรวมทั้งหมด → ห้องหลัก (smart maintenance)
    const header = `🌅 <b>สรุปงานซ่อมค้าง (MO) ประจำวัน</b>\nค้างทั้งหมด <b>${rows.length}</b> ใบ · ${depts.length} ทีม`;
    const overview = [header, '', ...depts.map((d) => {
      const block = buildTeamBlock(byDept[d]);
      return `━━━ <b>${teamName(d)}</b> (${byDept[d].length} ใบ) ━━━\n${block}`;
    })].join('\n');
    await sendTelegram(overview, baseChat);
    // กระดิ่งในแอป: ส่งเฉพาะภาพรวม 1 ครั้ง (ไม่ยิงซ้ำรายทีม — คนเดียวอยู่หลายทีมจะได้ข้อความเดิมหลายรอบ)
    await notifyInApp('mtn_daily_summary', `${header} — เปิดหน้าแจ้งซ่อมเพื่อดูรายการ`);

    // แยกรายทีม → ห้องของทีม (ถ้ามีห้องแท็กทีมไว้)
    for (const d of depts) {
      const room = teamChats[teamKey(d)];
      if (!room || !room.length) continue;
      const msg = `🌅 <b>งานซ่อมค้างของทีม ${teamName(d)}</b>\nค้าง <b>${byDept[d].length}</b> ใบ\n\n${buildTeamBlock(byDept[d])}`;
      await sendTelegram(msg, room);
    }

    /* ── 📥 บล็อก "ใบที่รอฝ่ายคุณรับมอบ" → ฝั่งผู้แจ้ง (ขั้น 4/6/7) ──────────────────
       Telegram: ห้อง mtn_pickup_pending ถ้าตั้งไว้ · ไม่ตั้ง = ห้องหลักเดียวกับภาพรวม
         (telegram_channels แท็กได้แค่ "ทีมช่าง" ยังไม่มีช่องแท็กส่วนงานผลิต → แยกห้องรายส่วนงานยังทำไม่ได้)
       กระดิ่งในแอป: ยิง **รายส่วนงาน** ผ่าน notify_recipients(p_section) = ถึงหัวหน้าไลน์/ผจก.
         ของส่วนงานนั้นโดยตรง ← นี่คือช่องที่ "ถึงตัวคนที่ต้องกด" จริงๆ
       ปิดทั้งบล็อกได้จาก /notification-config (ปิด event mtn_pickup_pending) */
    let pickupSections = 0;
    const pickupChat = resolveEvent(routes, 'mtn_pickup_pending');
    const pickup = rows.filter((m) => REPORTER_WAIT.includes(waitKey(m)));
    if (pickup.length && pickupChat !== null) {
      const secOfLine = await loadLineSections();
      const bySec: Record<string, MO[]> = {};
      for (const m of pickup) (bySec[secOfLine.get(String(m.line_name || '')) || NO_SECTION] ||= []).push(m);
      const secs = Object.keys(bySec).sort();
      pickupSections = secs.length;
      const stuckAll = pickup.filter((m) => daysOpen(m.report_at) >= STUCK_DAYS).length;
      const head = `📥 <b>ใบซ่อมที่รอ "ฝ่ายผู้แจ้ง" ดำเนินการ</b>\n`
        + `<b>${pickup.length}</b> ใบรออยู่ที่ฝั่งผู้แจ้ง (ไม่ใช่ที่ช่าง)`
        + `${stuckAll ? ` · ค้างเกิน ${STUCK_DAYS} วัน <b>${stuckAll}</b> ใบ` : ''}\n`
        + `<i>ตรวจรับงานหลังซ่อม (ขั้น 4) / รับมอบ (ขั้น 6) / อนุมัติปิด (ขั้น 7) — กดในหน้าแจ้งซ่อม</i>`;
      await sendChunked(head, secs.map((sec) =>
        `━━━ <b>${sec}</b> (${bySec[sec].length} ใบ) ━━━\n${buildPickupBlock(bySec[sec])}`), pickupChat);
      for (const sec of secs) {
        const list = bySec[sec];
        const stuck = list.filter((m) => daysOpen(m.report_at) >= STUCK_DAYS).length;
        await notifyInApp('mtn_pickup_pending',
          `📥 ใบซ่อม ${list.length} ใบรอฝ่ายคุณดำเนินการ (${sec})`
          + `${stuck ? ` · ค้างเกิน ${STUCK_DAYS} วัน ${stuck} ใบ` : ''}`
          + ' — ตรวจรับงาน/รับมอบ/อนุมัติปิด ในหน้าแจ้งซ่อม',
          stuck ? 'error' : 'info', sec === NO_SECTION ? null : sec);
      }
    }

    return json({ ok: true, total: rows.length, teams: depts.length, pickup: pickup.length, pickupSections });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
