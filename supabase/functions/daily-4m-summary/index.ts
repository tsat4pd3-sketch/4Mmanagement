import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID');
const CRON_SECRET        = Deno.env.get('CRON_SECRET') ?? '';

/* ── Bangkok date helpers ────────────────────────── */
function bangkokDateStr(offsetDays = 0): string {
  const now = new Date();
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000 + offsetDays * 86400000);
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
    const targetDate: string = body.date ?? bangkokDateStr(-1);
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

    return new Response(
      JSON.stringify({ ok: true, date: targetDate, total: logs.length, counts }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
