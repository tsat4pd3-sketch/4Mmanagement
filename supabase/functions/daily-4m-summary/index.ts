import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID');
const CRON_SECRET        = Deno.env.get('CRON_SECRET') ?? '';

/* ── Bangkok date helpers ────────────────────────── */
// work date ตามกฎระบบ (CLAUDE.md Date/Time): ก่อน 08:00 Bangkok นับเป็นวันก่อนหน้า (กะดึกข้ามวัน)
// four_m_logs.work_date ถูกเขียนด้วยกฎเดียวกันจาก getWorkDate() ฝั่งแอป — สรุป "เมื่อวาน" ต้องใช้กฎนี้
// ไม่ใช่วันปฏิทิน ไม่งั้น cron ที่รันช่วง 00:00-07:59 จะไปสรุป work date ที่กะดึกยังไม่จบ
function bangkokWorkDateStr(offsetDays = 0): string {
  const bkk = new Date(Date.now() + 7 * 60 * 60 * 1000);
  if (bkk.getUTCHours() < 8) bkk.setUTCDate(bkk.getUTCDate() - 1);
  bkk.setUTCDate(bkk.getUTCDate() + offsetDays);
  return bkk.toISOString().split('T')[0];
}

function thaiDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const months = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${d} ${months[m]} ${y + 543}`;
}

/* ── Telegram sender ─────────────────────────────── */
async function sendTelegram(text: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured — message:\n', text);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
  });
  const json = await res.json();
  if (!json.ok) console.error('Telegram error:', JSON.stringify(json));
}

/* ── Profile name cache ──────────────────────────── */
const nameCache = new Map<string, string>();
async function getNames(ids: string[]): Promise<Map<string, string>> {
  const missing = ids.filter(id => id && !nameCache.has(id));
  if (missing.length) {
    const { data } = await supabase.from('profiles').select('id, full_name').in('id', missing);
    for (const p of data ?? []) nameCache.set(p.id, p.full_name || '?');
  }
  return nameCache;
}

/* ── Category icon ───────────────────────────────── */
function catIcon(cat: string) {
  return { Man: '👷', Machine: '⚙️', Material: '📦', Method: '📋' }[cat] ?? '🔹';
}

/* ── 🔔 แจ้งเตือน "ในแอป" (กระดิ่ง + Web Push ผ่าน trigger trg_notify_push) ───────────────
   เดิมฟังก์ชันนี้ส่ง **Telegram ทางเดียว** — ถอด Telegram ออกเมื่อไหร่ การแจ้งเตือนหายสนิท
   (พบตอนสำรวจการย้ายระบบลง on-premise 2026-09-14 · ดู docs/LOCAL-SERVER-MIGRATION-SPEC.md §13)
   ⚠️ ผู้รับมาจาก RPC `notify_recipients` จุดเดียวของระบบ (role × ส่วนงาน × แผนก)
      **ห้ามเขียนเงื่อนไขกรองผู้รับในไฟล์นี้** — Telegram กับในแอปต้องอ้างกติกาแถวเดียวกัน
   ⚠️ ไม่ตั้ง `inapp_roles` ที่ /notification-config = ไม่แจ้งในแอป (opt-in)
      ⇒ deploy แล้วพฤติกรรมเดิมเป๊ะ จนกว่า admin จะตั้งผู้รับ
   คืนค่า: ส่งถึงใครจริงไหม (ผู้เรียกบางจุดใช้ตัดสินว่าจะ mark ว่าแจ้งแล้วหรือยัง) */
async function notifyInApp(eventKey: string, htmlMessage: string, type = 'info'): Promise<boolean> {
  const { data: rule, error: ruleErr } = await supabase
    .from('notification_rules').select('label, inapp_roles').eq('event_key', eventKey).maybeSingle();
  if (ruleErr) { console.error('daily-4m-summary: load rule', ruleErr.message); return false; }
  const roles = Array.isArray(rule?.inapp_roles) ? (rule!.inapp_roles as string[]) : [];
  if (!roles.length) return false;                    // ยังไม่ตั้งผู้รับ = เงียบตามเดิม
  let users: string[] = [];
  const { data, error } = await supabase.rpc('notify_recipients', { p_event: eventKey, p_section: null });
  if (error) {                                        // RPC ล่ม = ถอยไปตาม role ห้ามเงียบ
    console.error('daily-4m-summary: notify_recipients', error.message);
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
  if (insErr) { console.error('daily-4m-summary: insert notifications', insErr.message); return false; }
  return true;
}

/* ── Main ────────────────────────────────────────── */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });

  /* Auth: accept pg_cron calls (via Authorization service_role) or CRON_SECRET header */
  const authHeader = req.headers.get('Authorization') ?? '';
  const secretHeader = req.headers.get('x-cron-secret') ?? '';
  const isScheduled = secretHeader === CRON_SECRET && CRON_SECRET !== '';
  const isServiceRole = authHeader.startsWith('Bearer ') && authHeader.length > 20;
  if (!isScheduled && !isServiceRole) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    /* Allow override date for testing: { "date": "2026-05-28" } */
    const targetDate: string = body.date ?? bangkokWorkDateStr(-1);
    const dateLabel = thaiDateLabel(targetDate);

    /* Query all 4M logs for target date */
    const { data: logs, error } = await supabase
      .from('four_m_logs')
      .select('id, line_name, category, description, status, created_by, sv_approved_by, approved_by, reject_reason, change_subtype, requires_qa')
      .eq('work_date', targetDate)
      .order('created_at');

    if (error) throw error;
    if (!logs || logs.length === 0) {
      await sendTelegram(
        `📊 <b>สรุป 4M Changes</b> — ${dateLabel}\n\n` +
        `ไม่มีรายการเปลี่ยนแปลง 4M วันนี้ ✅\n\n— 4M Management System`
      );
      return new Response(JSON.stringify({ ok: true, date: targetDate, total: 0 }), { headers: { 'Content-Type': 'application/json' } });
    }

    /* Count by status */
    const counts = { approved: 0, pending_qa: 0, pending: 0, rejected: 0 };
    for (const l of logs) {
      if (l.status in counts) counts[l.status as keyof typeof counts]++;
    }

    /* Collect user IDs for name lookup */
    const allIds = [...new Set(logs.flatMap(l => [l.created_by, l.sv_approved_by, l.approved_by].filter(Boolean)))] as string[];
    const names = await getNames(allIds);

    /* Build summary header */
    const lines: string[] = [
      `📊 <b>สรุป 4M Changes</b> — ${dateLabel}`,
      ``,
      `📈 รวมทั้งหมด: <b>${logs.length} รายการ</b>`,
      `✅ Approved: <b>${counts.approved}</b>`,
      counts.pending_qa  > 0 ? `🔍 รอ QA Approve: <b>${counts.pending_qa}</b>` : '',
      counts.pending     > 0 ? `⏳ รอ SV Approve: <b>${counts.pending}</b>` : '',
      counts.rejected    > 0 ? `❌ Rejected: <b>${counts.rejected}</b>` : '',
    ].filter(Boolean);

    /* Pending items — ต้องติดตาม */
    const pendingItems = logs.filter(l => l.status === 'pending' || l.status === 'pending_qa');
    if (pendingItems.length > 0) {
      lines.push(``, `⏰ <b>รายการที่รอดำเนินการ (${pendingItems.length})</b>`, `─────────────────`);
      for (const l of pendingItems) {
        const icon = l.status === 'pending_qa' ? '🔍' : '⏳';
        const waitLabel = l.status === 'pending_qa' ? 'รอ QA Approve' : 'รอ SV Approve';
        const creator = names.get(l.created_by) ?? '?';
        lines.push(
          `${icon} ${catIcon(l.category)} <b>${l.category}</b> · ${l.line_name}`,
          `   📝 ${l.description}`,
          `   👤 แจ้งโดย: ${creator}  |  🔖 ${waitLabel}`,
        );
      }
    }

    /* Rejected items — ต้องตรวจสอบ */
    const rejectedItems = logs.filter(l => l.status === 'rejected');
    if (rejectedItems.length > 0) {
      lines.push(``, `❌ <b>รายการที่ถูก Reject (${rejectedItems.length})</b>`, `─────────────────`);
      for (const l of rejectedItems) {
        const creator = names.get(l.created_by) ?? '?';
        lines.push(
          `❌ ${catIcon(l.category)} <b>${l.category}</b> · ${l.line_name}`,
          `   📝 ${l.description}`,
          `   👤 แจ้งโดย: ${creator}`,
          l.reject_reason ? `   💬 เหตุผล: ${l.reject_reason}` : '',
        );
      }
    }

    lines.push(``, `— 4M Management System`);
    const message = lines.filter(l => l !== '').join('\n');

    await sendTelegram(message);

    /* กระดิ่งในแอป — เด้งเฉพาะเมื่อ "มีงานต้องทำ" (ค้างอนุมัติ / ถูก reject)
       วันที่ทุกใบผ่านแล้วไม่ต้องรบกวน 87 บัญชี (บทเรียนคิว 4M ค้าง 323 ใบ: แจ้งทุกวันจนคนเลิกอ่าน = เท่ากับไม่แจ้ง) */
    const actionable = counts.pending + counts.pending_qa + counts.rejected;
    if (actionable > 0) {
      await notifyInApp(
        'four_m_daily_summary',
        `สรุป 4M ${dateLabel} — ค้างอนุมัติ ${counts.pending + counts.pending_qa} ใบ`
        + ` · ถูก reject ${counts.rejected} ใบ · ทั้งหมด ${logs.length} ใบ`,
        counts.rejected > 0 ? 'error' : 'info',
      );
    }

    return new Response(
      JSON.stringify({ ok: true, date: targetDate, total: logs.length, counts }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
