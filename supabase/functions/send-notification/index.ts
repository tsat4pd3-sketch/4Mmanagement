import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const SMTP_HOST      = Deno.env.get('SMTP_HOST');
const SMTP_PORT      = Deno.env.get('SMTP_PORT');
const SMTP_USER      = Deno.env.get('SMTP_USER');
const SMTP_PASS      = Deno.env.get('SMTP_PASS');
const SMTP_FROM      = Deno.env.get('SMTP_FROM') ?? SMTP_USER;

/* ── Email sender ───────────────────────────────── */
async function sendEmail(to: string, subject: string, html: string) {
  if (RESEND_API_KEY) {
    // Resend API
    const from = Deno.env.get('EMAIL_FROM') ?? 'noreply@thaisummit.co.th';
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({ from, to, subject, html }),
    });
  } else if (SMTP_HOST) {
    // SMTP via Deno SMTP library
    const { SMTPClient } = await import('https://deno.land/x/denomailer@1.6.0/mod.ts');
    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: Number(SMTP_PORT ?? 587),
        tls: Number(SMTP_PORT ?? 587) === 465,
        auth: { username: SMTP_USER!, password: SMTP_PASS! },
      },
    });
    await client.send({ from: SMTP_FROM!, to, subject, html });
    await client.close();
  }
}

/* ── Helpers ────────────────────────────────────── */
function statusLabel(status: string) {
  return { pending: 'รอ SV Approve', pending_qa: 'รอ QA Approve', approved: 'Approved ✅', rejected: 'Rejected ❌' }[status] ?? status;
}

function buildHtml(log: Record<string, unknown>) {
  return `<div style="font-family:sans-serif;max-width:560px">
    <h2 style="color:#1a1a2e">🔔 แจ้งเตือนระบบ 4M</h2>
    <table style="border-collapse:collapse;width:100%">
      <tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold">วันที่</td><td style="padding:6px;border:1px solid #ddd">${log.work_date}</td></tr>
      <tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold">ไลน์</td><td style="padding:6px;border:1px solid #ddd">${log.line_name}</td></tr>
      <tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold">ประเภท</td><td style="padding:6px;border:1px solid #ddd">${log.category}</td></tr>
      <tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold">รายละเอียด</td><td style="padding:6px;border:1px solid #ddd">${log.description}</td></tr>
      <tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold">สถานะ</td><td style="padding:6px;border:1px solid #ddd">${statusLabel(log.status as string)}</td></tr>
      ${log.reject_reason ? `<tr><td style="padding:6px;border:1px solid #ddd;font-weight:bold;color:#ef4444">เหตุผล</td><td style="padding:6px;border:1px solid #ddd;color:#ef4444">${log.reject_reason}</td></tr>` : ''}
    </table>
    <p style="color:#666;font-size:12px;margin-top:16px">— 4M Management System · Thai Summit Group</p>
  </div>`;
}

/* ── Handler ─────────────────────────────────────── */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });

  try {
    const { event, log } = await req.json();
    if (!log) return new Response('missing log', { status: 400 });

    const status: string = log.status;

    /* Determine notification targets ──────────────── */
    type Target = { userId: string; email: string | null };
    const targets: Target[] = [];

    const addProfilesByRole = async (roles: string[], lineId?: string | number) => {
      let q = supabase.from('profiles').select('id, notify_email, role, line_id').in('role', roles);
      if (lineId) q = q.eq('line_id', lineId);
      const { data } = await q;
      for (const p of data ?? []) targets.push({ userId: p.id, email: p.notify_email });
    };

    const addCreator = async () => {
      if (!log.created_by) return;
      const { data } = await supabase.from('profiles').select('id, notify_email').eq('id', log.created_by).single();
      if (data) targets.push({ userId: data.id, email: data.notify_email });
    };

    if (status === 'pending') {
      // New log: notify supervisors/leaders of that line + QA if requires_qa
      await addProfilesByRole(['supervisor', 'leader', 'admin', 'manager']);
      if (log.requires_qa !== false) await addProfilesByRole(['qa']);
    } else if (status === 'pending_qa') {
      // SV approved → notify QA
      await addProfilesByRole(['qa', 'admin', 'manager']);
      await addCreator();
    } else {
      // approved or rejected → notify creator
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
    const html = buildHtml(log);

    await Promise.allSettled(unique.map(async (t) => {
      // In-app notification
      await supabase.from('notifications').insert({
        user_id: t.userId, title, body,
        type: status === 'rejected' ? 'error' : status === 'approved' ? 'success' : 'info',
        ref_table: 'four_m_logs', ref_id: log.id,
      });
      // Email
      if (t.email) {
        await sendEmail(t.email, `[4M System] ${title}`, html).catch(console.error);
      }
    }));

    return new Response(JSON.stringify({ ok: true, sent: unique.length }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
