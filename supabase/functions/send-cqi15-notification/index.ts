import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELEGRAM_BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
const TELEGRAM_CHAT_ID   = Deno.env.get('TELEGRAM_CHAT_ID')   ?? ''
const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')        ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// CQI-15 role → system profile role mapping
// Used to find users to notify in the notifications table
const ROLE_MAP: Record<string, string[]> = {
  O:   ['supervisor', 'leader'],
  QT:  ['qa'],
  JME: ['supervisor'],
  ME:  ['manager', 'admin'],
}

const CAT_META: Record<string, { icon: string; label: string }> = {
  A: { icon: '🔄', label: 'Normal Operations' },
  B: { icon: '🔧', label: 'Intentional Interruption' },
  C: { icon: '🚨', label: 'Unintentional Interruption' },
}

async function sendTelegram(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
    }),
  })
}

serve(async (req) => {
  try {
    const body = await req.json()
    const { event, log, event_def, roles_needed, log_id, role_key, status, approver } = body

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    if (event === 'new_event') {
      // New CQI-15 event logged
      const cat = event_def?.category ?? '?'
      const cm  = CAT_META[cat] ?? { icon: '📋', label: cat }
      const isEmergency = cat === 'C'

      // 1. Telegram — always for Cat C, optional for B
      if (isEmergency || cat === 'B') {
        const lines = [
          `${cm.icon} <b>CQI-15 Event — Category ${cat}</b>`,
          `📍 ไลน์: ${log.line_name}  |  Station: ${log.station_number ?? '—'}`,
          `🔢 Event #${event_def?.event_no}: ${event_def?.name_th ?? event_def?.name_en}`,
          log.issue_description ? `📝 Issue: ${log.issue_description}` : '',
          `📦 OK: ${log.qty_ok}  NG: ${log.qty_ng}  Rework: ${log.qty_rework}  Scrap: ${log.qty_scrap}`,
          `⏰ ${log.work_date} ${log.event_time ?? ''}`,
          '',
          isEmergency
            ? '⚠️ <b>ต้องดำเนินการทันที — กรุณาเข้าระบบเพื่ออนุมัติ</b>'
            : `📋 Roles ที่ต้องอนุมัติ: ${(roles_needed ?? []).join(', ')}`,
        ].filter(Boolean).join('\n')

        await sendTelegram(lines)
      }

      // 2. In-app notifications — per role
      if (roles_needed?.length && log) {
        for (const roleKey of roles_needed) {
          const sysRoles = ROLE_MAP[roleKey] ?? []
          if (sysRoles.length === 0) continue

          // Get profiles matching these roles
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id, role')
            .in('role', sysRoles)

          if (!profiles) continue

          const notifs = profiles.map((p: { id: string }) => ({
            user_id: p.id,
            title: `${cm.icon} CQI-15 Event #${event_def?.event_no} — Cat ${cat}`,
            body: `[${roleKey}] ${event_def?.name_th ?? ''} · ${log.line_name} · ${log.station_number ?? ''}`.trim(),
            type: isEmergency ? 'error' : 'info',
            ref_table: 'cqi15_event_logs',
            ref_id: log.id,
          }))

          if (notifs.length > 0) {
            await supabase.from('notifications').insert(notifs)
          }
        }
      }

    } else if (event === 'approval_update') {
      // Someone approved/rejected a role
      const { data: logData } = await supabase
        .from('cqi15_event_logs')
        .select('*, cqi15_event_definitions(*), cqi15_event_approvals(*)')
        .eq('id', log_id)
        .single()

      if (!logData) return new Response(JSON.stringify({ ok: true }), { status: 200 })

      const def = logData.cqi15_event_definitions
      const cat = def?.category ?? '?'
      const cm  = CAT_META[cat] ?? { icon: '📋', label: cat }
      const allApprovals: Array<{ status: string }> = logData.cqi15_event_approvals ?? []
      const allApproved = allApprovals.length > 0 && allApprovals.every((a) => a.status === 'approved')
      const anyRejected = allApprovals.some((a) => a.status === 'rejected')

      // Telegram for final approval/rejection
      if (allApproved || anyRejected) {
        const msg = anyRejected
          ? `❌ <b>CQI-15 Event ปฏิเสธ</b>\n📍 ${logData.line_name} · Event #${def?.event_no}: ${def?.name_th}\n👤 โดย: ${approver ?? role_key}`
          : `✅ <b>CQI-15 Event อนุมัติครบทุก Role</b>\n📍 ${logData.line_name} · Event #${def?.event_no}: ${def?.name_th}`
        await sendTelegram(msg)
      }

      // In-app notification to the reporter
      if (logData.reported_by) {
        await supabase.from('notifications').insert({
          user_id: logData.reported_by,
          title: `${allApproved ? '✅' : anyRejected ? '❌' : '📋'} Event #${def?.event_no} — [${role_key}] ${status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธ'}`,
          body: `${logData.line_name} · ${def?.name_th ?? ''} · โดย ${approver ?? ''}`,
          type: allApproved ? 'success' : anyRejected ? 'error' : 'info',
          ref_table: 'cqi15_event_logs',
          ref_id: log_id,
        })
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('send-cqi15-notification error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
