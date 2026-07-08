import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID');

/* ── Telegram senders ──────────────────────────── */
async function sendTelegram(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }),
  });
}

async function sendTelegramPhoto(photoUrl: string, caption: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, photo: photoUrl, caption, parse_mode: 'HTML' }),
  });
}

async function sendTelegramMediaGroup(photos: { url: string; caption: string }[]) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !photos.length) return;
  if (photos.length === 1) {
    await sendTelegramPhoto(photos[0].url, photos[0].caption);
    return;
  }
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMediaGroup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      media: photos.map((p, i) => ({
        type: 'photo',
        media: p.url,
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
    `🔔 <b>${title}</b>`,
    ``,
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

/* ── Handler ─────────────────────────────────────── */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });

  try {
    const body = await req.json();
    const { event } = body;

    /* ── Checkin Summary ─────────────────────────── */
    if (event === 'checkin_summary') {
      const s = body.summary;
      if (!s) return new Response('missing summary', { status: 400 });
      const otNote = s.has_ot_night ? `\n⏰ เปิด OT กะดึก (${s.start_time} น.)` : `\n🕗 เวลาเริ่ม: ${s.start_time} น.`;
      const message = [
        `✅ <b>เช็คชื่อเสร็จแล้ว</b>`,
        ``,
        `🏭 ไลน์: <b>${s.line_name}</b> · ${s.shift_label}`,
        `📅 วันที่: ${s.work_date}${otNote}`,
        ``,
        `👥 เข้างาน: <b>${s.present}/${s.total}</b>`,
        `⏰ OT: ${s.ot}`,
        `🏖️ ลา: ${s.leave}`,
        `❌ ขาด: ${s.absent}`,
        ``,
        `✍️ ตรวจโดย: ${s.checked_by}`,
        `— 4M Management System`,
      ].join('\n');
      await sendTelegram(message).catch(console.error);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    /* ── Machine downtime alert ──────────────────── */
    if (event === 'downtime') {
      const d = body.downtime;
      if (!d) return new Response('missing downtime', { status: 400 });
      const shiftLabel = d.shift === 'day' ? 'กะเช้า' : 'กะดึก';
      const ongoing = !d.end_time && d.duration_min == null;
      const lines = [
        `🚨🚨 <b>เครื่องจักร DOWNTIME</b> 🚨🚨`,
        ``,
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
      await sendTelegram(lines.join('\n')).catch(console.error);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    /* ── Production session close workflow ───────── */
    if (event === 'prod_close') {
      const s = body.session;
      if (!s) return new Response('missing session', { status: 400 });
      const shiftLabel = s.shift === 'day' ? 'กะเช้า' : 'กะดึก';
      const map = {
        pending_close:    { title: '🟡 ขอปิดกะ — รอ SV อนุมัติ', extra: '' },
        closed:           { title: '✅ ปิดกะสำเร็จ', extra: '' },
        closed_approved:  { title: '✅ SV อนุมัติปิดกะแล้ว', extra: `\n🙋 ผู้ขอปิดกะ: ${s.requested_by || '-'}` },
        closed_rejected:  { title: '❌ SV ปฏิเสธคำขอปิดกะ', extra: `\n🙋 ผู้ขอปิดกะ: ${s.requested_by || '-'}` },
      };
      const m = map[s.status] ?? { title: `🔔 Production · ${s.status}`, extra: '' };
      const lines = [
        `<b>${m.title}</b>`,
        ``,
        `🏭 ไลน์: ${s.line_name} · ${shiftLabel}`,
        `📅 วันที่: ${s.work_date}`,
      ];
      if (s.qty_ok != null) lines.push(`✅ ดี: ${s.qty_ok}  ❌ NG: ${s.qty_ng ?? 0}${s.qty_suspect ? `  ⚠️ สงสัย: ${s.qty_suspect}` : ''}`);
      if (s.oee != null)    lines.push(`📊 OEE: ${s.oee}%`);
      lines.push(`${m.extra}`, ``, `👤 ผู้ดำเนินการ: ${s.actor}`, `— Production System`);
      await sendTelegram(lines.join('\n')).catch(console.error);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    const { log } = body;
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
    const notifBody = `${log.work_date} · ${log.description}`;

    /* In-app notifications */
    await Promise.allSettled(unique.map(async (t) => {
      await supabase.from('notifications').insert({
        user_id: t.userId, title, body: notifBody,
        type: status === 'rejected' ? 'error' : status === 'approved' ? 'success' : 'info',
        ref_table: 'four_m_logs', ref_id: log.id,
      });
    }));

    /* Telegram text notification */
    const message = await buildTelegramMessage(log, title);
    await sendTelegram(message).catch(console.error);

    /* Telegram image attachments ─────────────────── */
    /* pending_qa: SV อนุมัติแล้ว ส่งรูป OJT ให้ QA ดู */
    if (status === 'pending_qa' && log.request_image_url) {
      await sendTelegramPhoto(
        log.request_image_url as string,
        `📎 <b>รูปหลักฐาน OJT</b>\n${log.category} · ${log.line_name}\n${log.description}`
      ).catch(console.error);
    }

    /* approved: ส่งทั้งรูป OJT + รูป QA เป็น album */
    if (status === 'approved') {
      const photos: { url: string; caption: string }[] = [];
      if (log.request_image_url) {
        photos.push({
          url: log.request_image_url as string,
          caption: `✅ <b>อนุมัติแล้ว — 4M ${log.category}</b>\n🏭 ${log.line_name} · 📅 ${log.work_date}\n📝 ${log.description}\n\n📎 รูปหลักฐาน OJT (ผู้แจ้ง)`,
        });
      }
      if (log.qa_image_url) {
        photos.push({ url: log.qa_image_url as string, caption: `🔍 รูปยืนยันคุณภาพ (QA)` });
      }
      if (photos.length) await sendTelegramMediaGroup(photos).catch(console.error);
    }

    return new Response(JSON.stringify({ ok: true, sent: unique.length }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
