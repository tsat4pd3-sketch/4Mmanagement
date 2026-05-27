import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID');

/* ── Telegram sender ────────────────────────────── */
async function sendTelegram(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
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
    `🔔 <b>${title}</b>`,
    ``,
    `📅 วันที่: ${log.work_date}`,
    `🏭 ไลน์: ${log.line_name}`,
    `📋 ประเภท: ${log.category}`,
    `📝 รายละเอียด: ${log.description}`,
    `🔖 สถานะ: ${statusLabel(log.status as string)}`,
    `👤 ผู้แจ้ง: ${creatorName}`,
  ];

  if (log.sv_approved_by) lines.push(`✅ SV อนุมัติ: ${svName}`);
  if (log.approved_by)    lines.push(`✅ QA อนุมัติ: ${approverName}`);
  if (log.reject_reason)  lines.push(`❌ เหตุผล: ${log.reject_reason}`);

  lines.push(``, `— 4M Management System`);
  return lines.join('\n');
}

/* ── Handler ─────────────────────────────────────── */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });

  try {
    const { event, log } = await req.json();
    if (!log) return new Response('missing log', { status: 400 });

    const status: string = log.status;

    /* Determine notification targets ──────────────── */
    type Target = { userId: string };
    const targets: Target[] = [];

    const addProfilesByRole = async (roles: string[]) => {
      const { data } = await supabase.from('profiles').select('id').in('role', roles);
      for (const p of data ?? []) targets.push({ userId: p.id });
    };

    const addCreator = async () => {
      if (!log.created_by) return;
      targets.push({ userId: log.created_by as string });
    };

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

    /* Deduplicate */
    const seen = new Set<string>();
    const unique = targets.filter(t => { if (seen.has(t.userId)) return false; seen.add(t.userId); return true; });

    const title = event === 'status_change'
      ? `4M ${log.category} · ${log.line_name} → ${statusLabel(status)}`
      : `4M แจ้งเตือน · ${log.line_name}`;
    const body = `${log.work_date} · ${log.description}`;

    /* In-app notifications */
    await Promise.allSettled(unique.map(async (t) => {
      await supabase.from('notifications').insert({
        user_id: t.userId, title, body,
        type: status === 'rejected' ? 'error' : status === 'approved' ? 'success' : 'info',
        ref_table: 'four_m_logs', ref_id: log.id,
      });
    }));

    /* Telegram notification (ส่งครั้งเดียวไปยัง Group) */
    const message = await buildTelegramMessage(log, title);
    await sendTelegram(message).catch(console.error);

    return new Response(JSON.stringify({ ok: true, sent: unique.length }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
