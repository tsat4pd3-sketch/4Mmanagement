import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TELEGRAM_BOT_TOKEN   = Deno.env.get('TELEGRAM_BOT_TOKEN')        ?? ''
const TELEGRAM_CHAT_ID     = Deno.env.get('TELEGRAM_CHAT_ID')          ?? ''
const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')              ?? ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// ─── Department labels (Thai) ───────────────────────────────────────────────
const DEPT: Record<string, { th: string; icon: string }> = {
  O:   { th: 'ฝ่ายผลิต (Operator)',          icon: '🏭' },
  QT:  { th: 'ฝ่ายคุณภาพ (Quality Tech)',    icon: '🔍' },
  JME: { th: 'ซ่อมบำรุง Jig (JIG Maint.)',   icon: '🔩' },
  ME:  { th: 'วิศวกรรม/ซ่อมบำรุง (Maint. Eng)', icon: '⚙️' },
}

// ─── CQI-15 role → system profile roles ────────────────────────────────────
const ROLE_MAP: Record<string, string[]> = {
  O:   ['supervisor', 'leader'],
  QT:  ['qa'],
  JME: ['supervisor'],
  ME:  ['manager', 'admin'],
}

// ─── Category metadata ───────────────────────────────────────────────────────
const CAT_META: Record<string, { icon: string; label: string; urgent: boolean }> = {
  A: { icon: '🔄', label: 'Normal Operations',          urgent: false },
  B: { icon: '🔧', label: 'Intentional Interruption',   urgent: true  },
  C: { icon: '🚨', label: 'Unintentional Interruption', urgent: true  },
}

// ─── Telegram helper ─────────────────────────────────────────────────────────
async function sendTelegram(message: string) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }),
  })
}

// ─── Build department action list from event check matrix ────────────────────
// Returns lines like "🔍 ฝ่ายคุณภาพ: Visual Inspection, Gauge Check, ..."
function buildDeptActionLines(
  matrix: Array<{ check_no: number; responsible: string; is_critical: boolean }>,
  checkItems: Array<{ check_no: number; name_th: string }>,
): string[] {
  // Group check_no list by primary role (first in O/JME splits)
  const deptChecks: Record<string, Array<{ name: string; critical: boolean }>> = {}

  for (const entry of matrix) {
    const roles = entry.responsible.replace(/\*/g, '').split('/').map((r: string) => r.trim())
    // Use the first named role as primary department owner
    const primary = roles.find((r: string) => DEPT[r]) ?? roles[0]
    if (!DEPT[primary]) continue
    if (!deptChecks[primary]) deptChecks[primary] = []
    const item = checkItems.find((c) => c.check_no === entry.check_no)
    if (item && !deptChecks[primary].find((x) => x.name === item.name_th)) {
      deptChecks[primary].push({ name: item.name_th, critical: entry.is_critical })
    }
  }

  const lines: string[] = []
  for (const [roleKey, checks] of Object.entries(deptChecks)) {
    const dept = DEPT[roleKey]
    const items = checks.map((c) => (c.critical ? `⚠ ${c.name}` : c.name)).join('\n      • ')
    lines.push(`${dept.icon} <b>${dept.th}</b> (${checks.length} รายการ)\n      • ${items}`)
  }
  return lines
}

// ─── Main handler ─────────────────────────────────────────────────────────────
serve(async (req) => {
  try {
    const body = await req.json()
    const { event, log, event_def, roles_needed, log_id, role_key, status, approver } = body

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // ── NEW EVENT ─────────────────────────────────────────────────────────────
    if (event === 'new_event') {
      const cat = event_def?.category ?? '?'
      const cm  = CAT_META[cat] ?? { icon: '📋', label: cat, urgent: false }

      // Fetch matrix + check items for this event to build department action list
      const [{ data: matrixRows }, { data: checkItems }] = await Promise.all([
        supabase
          .from('cqi15_event_check_matrix')
          .select('check_no, responsible, is_critical')
          .eq('event_no', event_def?.event_no),
        supabase.from('cqi15_check_items').select('check_no, name_th'),
      ])

      const deptLines = buildDeptActionLines(matrixRows ?? [], checkItems ?? [])

      // ── Telegram: Cat B and C notify immediately ──────────────────────────
      if (cm.urgent) {
        const urgentTag = cat === 'C'
          ? '🚨 <b>แจ้งเตือนด่วน — หยุดกระทันหัน</b>'
          : '🔧 <b>แจ้งเตือน — หยุดตามแผน</b>'

        const msg = [
          urgentTag,
          `━━━━━━━━━━━━━━━━━━━━━━`,
          `📍 <b>ไลน์:</b> ${log.line_name}${log.station_number ? `  |  Station: ${log.station_number}` : ''}`,
          `🔢 <b>Event #${event_def?.event_no} (Cat ${cat}):</b> ${event_def?.name_th ?? event_def?.name_en}`,
          log.issue_description
            ? `📝 <b>Issue:</b> ${log.issue_description}`
            : '',
          log.weld_cell_operator
            ? `👤 <b>Operator:</b> ${log.weld_cell_operator}`
            : '',
          `📦 <b>Qty:</b> Total ${log.qty_total}  |  OK ${log.qty_ok}  NG ${log.qty_ng}  Rework ${log.qty_rework}  Scrap ${log.qty_scrap}`,
          `⏰ ${log.work_date} ${log.event_time ?? ''}`,
          `━━━━━━━━━━━━━━━━━━━━━━`,
          `<b>📋 แผนกที่ต้องดำเนินการทันที:</b>`,
          ...deptLines.map((l) => `\n${l}`),
          `━━━━━━━━━━━━━━━━━━━━━━`,
          cat === 'C'
            ? `⚠️ <b>ชิ้นงานในกระบวนการต้องตรวจสอบทุกชิ้น — ห้ามผ่านก่อนอนุมัติครบทุกแผนก</b>`
            : `📌 กรุณาเข้าระบบเพื่อตรวจสอบและอนุมัติ`,
        ].filter(Boolean).join('\n')

        await sendTelegram(msg)
      }

      // ── In-app notifications: ส่งทุก role ที่ต้องดำเนินการ ──────────────
      if (roles_needed?.length && log) {
        for (const roleKey of (roles_needed as string[])) {
          const sysRoles = ROLE_MAP[roleKey] ?? []
          if (sysRoles.length === 0) continue

          const { data: profiles } = await supabase
            .from('profiles')
            .select('id')
            .in('role', sysRoles)

          if (!profiles?.length) continue

          // Build per-role check summary
          const myChecks = (matrixRows ?? []).filter((m: { responsible: string }) =>
            m.responsible.replace(/\*/g, '').split('/').map((r: string) => r.trim()).includes(roleKey)
          )
          const checkNames = myChecks
            .map((m: { check_no: number }) => checkItems?.find((c) => c.check_no === m.check_no)?.name_th)
            .filter(Boolean)
            .slice(0, 3)
            .join(', ')
          const moreCount = Math.max(0, myChecks.length - 3)

          const notifTitle = cm.urgent
            ? `${cm.icon} [${roleKey}] ต้องดำเนินการ — CQI-15 Event #${event_def?.event_no} Cat ${cat}`
            : `${cm.icon} [${roleKey}] CQI-15 Event #${event_def?.event_no} Cat ${cat}`

          const notifBody = [
            `${log.line_name}${log.station_number ? ' · ' + log.station_number : ''}`,
            `${event_def?.name_th ?? ''}`,
            checkNames ? `Checks: ${checkNames}${moreCount > 0 ? ` +${moreCount} รายการ` : ''}` : '',
          ].filter(Boolean).join(' · ')

          await supabase.from('notifications').insert(
            profiles.map((p: { id: string }) => ({
              user_id: p.id,
              title: notifTitle,
              body: notifBody,
              type: cat === 'C' ? 'error' : cat === 'B' ? 'info' : 'info',
              ref_table: 'cqi15_event_logs',
              ref_id: log.id,
            }))
          )
        }
      }
    }

    // ── APPROVAL UPDATE ───────────────────────────────────────────────────────
    else if (event === 'approval_update') {
      const { data: logData } = await supabase
        .from('cqi15_event_logs')
        .select('*, cqi15_event_definitions(*), cqi15_event_approvals(*)')
        .eq('id', log_id)
        .single()

      if (!logData) return new Response(JSON.stringify({ ok: true }), { status: 200 })

      const def = logData.cqi15_event_definitions
      const cat = def?.category ?? '?'
      const allApprovals: Array<{ status: string; role_key: string }> = logData.cqi15_event_approvals ?? []
      const allApproved = allApprovals.length > 0 && allApprovals.every((a) => a.status === 'approved')
      const anyRejected = allApprovals.some((a) => a.status === 'rejected')

      // Pending roles still waiting
      const pendingRoles = allApprovals.filter((a) => a.status === 'pending').map((a) => a.role_key)
      const approvedRoles = allApprovals.filter((a) => a.status === 'approved').map((a) => a.role_key)

      // Telegram: progress update
      if (allApproved || anyRejected) {
        const msg = anyRejected
          ? [
              `❌ <b>CQI-15 Event ปฏิเสธ</b>`,
              `📍 ${logData.line_name} · Event #${def?.event_no}: ${def?.name_th}`,
              `👤 โดย [${role_key}]: ${approver ?? ''}`,
              logData.reject_reason ? `📝 เหตุผล: ${logData.reject_reason}` : '',
            ].filter(Boolean).join('\n')
          : [
              `✅ <b>CQI-15 Event อนุมัติครบทุกแผนก</b>`,
              `📍 ${logData.line_name} · Event #${def?.event_no}: ${def?.name_th}`,
              `✔ Approved by: ${approvedRoles.map((r) => `[${r}]`).join(' ')}`,
              `🟢 กระบวนการผ่านการตรวจสอบ — สามารถเดินสายผลิตต่อได้`,
            ].join('\n')
        await sendTelegram(msg)
      } else {
        // Partial approval — update progress to Telegram
        const progressMsg = [
          `📋 <b>CQI-15 อัปเดต — [${role_key}] ${status === 'approved' ? 'อนุมัติแล้ว ✓' : 'ปฏิเสธ ✗'}</b>`,
          `📍 ${logData.line_name} · Event #${def?.event_no}`,
          approvedRoles.length ? `✅ อนุมัติแล้ว: ${approvedRoles.map((r) => `[${r}]`).join(' ')}` : '',
          pendingRoles.length  ? `⏳ รอ: ${pendingRoles.map((r) => {
            const d = DEPT[r]
            return d ? `${d.icon}[${r}]${d.th}` : `[${r}]`
          }).join('  ')}` : '',
        ].filter(Boolean).join('\n')
        await sendTelegram(progressMsg)
      }

      // In-app: notify reporter
      if (logData.reported_by) {
        await supabase.from('notifications').insert({
          user_id: logData.reported_by,
          title: `${allApproved ? '✅' : anyRejected ? '❌' : '📋'} Event #${def?.event_no} — [${role_key}] ${status === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธ'}`,
          body: `${logData.line_name} · ${def?.name_th ?? ''} · โดย ${approver ?? ''}${pendingRoles.length ? ` · รอ: ${pendingRoles.join(', ')}` : ''}`,
          type: allApproved ? 'success' : anyRejected ? 'error' : 'info',
          ref_table: 'cqi15_event_logs',
          ref_id: log_id,
        })
      }

      // In-app: notify remaining pending roles
      if (!allApproved && !anyRejected && pendingRoles.length > 0) {
        for (const pRole of pendingRoles) {
          const sysRoles = ROLE_MAP[pRole] ?? []
          if (sysRoles.length === 0) continue
          const { data: profiles } = await supabase.from('profiles').select('id').in('role', sysRoles)
          if (!profiles?.length) continue
          await supabase.from('notifications').insert(
            profiles.map((p: { id: string }) => ({
              user_id: p.id,
              title: `⏳ [${pRole}] รอการอนุมัติ — CQI-15 Event #${def?.event_no}`,
              body: `${logData.line_name} · ${def?.name_th ?? ''} · [${role_key}] อนุมัติแล้ว`,
              type: 'info',
              ref_table: 'cqi15_event_logs',
              ref_id: log_id,
            }))
          )
        }
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
