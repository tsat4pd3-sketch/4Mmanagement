// Production — scheduled scan for machine downtime that stays OPEN too long.
// Runs on the Product DB project (DR) via pg_cron (every 5 min). New downtime
// no longer alerts Telegram immediately (2026-07-14 overhaul); instead this
// scanner finds downtime_logs still open (no end time / no duration) whose
// started_at is older than dt_alert_config.open_alert_min minutes and that
// hasn't been alerted yet, then POSTs a 'downtime_open_15min' event to the MAIN
// send-notification function (which owns the bot token + room routing).
// Deduped by stamping open_alerted_at so each open-downtime fires exactly once.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const NOTIFY_URL = 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/send-notification';
const NOTIFY_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3aGRmcXdmd29maXZvanRzaXpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODA5NjYsImV4cCI6MjA5MjQ1Njk2Nn0.mGrLjRFmtNtpyAu3aBduKqixyb3AjQDCid06qpBzrxw';

const fmtHM = (iso: string | null) => {
  if (!iso) return null;
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
  return p === '24:00' ? '00:00' : p;
};

Deno.serve(async () => {
  try {
    // เกณฑ์เวลา config ได้จากหน้า ตั้งค่าการแจ้งเตือน (dt_alert_config, แถวเดียว)
    const { data: cfg } = await db.from('dt_alert_config').select('open_alert_min').eq('id', 1).maybeSingle();
    const openMin = Math.max(1, Number(cfg?.open_alert_min ?? 15));
    const cutoffISO = new Date(Date.now() - openMin * 60000).toISOString();

    // downtime ที่ยังเปิดค้าง (ไม่มีเวลาจบ/ระยะเวลา) · ยังไม่เคยแจ้ง · เริ่มมาแล้วเกินเกณฑ์
    const { data: rows, error } = await db.from('downtime_logs')
      .select('id, machine_no, mat_no, description, started_at, reported_by_name, ' +
        'dr_downtime_types(name_th, category), ' +
        'production_sessions(line_name, shift, work_date, status)')
      .is('ended_at', null).is('duration_min', null).is('open_alerted_at', null)
      .lte('started_at', cutoffISO);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

    // เฉพาะกะที่ยังเปิดอยู่ (เครื่องยังหยุดจริง — session ปิดแล้วไม่ต้องปลุก)
    const open = (rows ?? []).filter((r) => ['open', 'pending_close'].includes(r.production_sessions?.status));

    let sent = 0;
    for (const r of open) {
      const s = r.production_sessions;
      const t = r.dr_downtime_types;
      const elapsed = Math.round((Date.now() - new Date(r.started_at).getTime()) / 60000);
      const payload = {
        event: 'downtime_open_15min',
        downtime: {
          id:           r.id, // ให้ send-notification จำ message_id ผูกรายการนี้ (reply = คอมเมนต์)
          line_name:    s?.line_name || '-',
          shift:        s?.shift || 'day',
          work_date:    s?.work_date || '',
          machine_no:   r.machine_no || null,
          machine_name: '',
          type_name:    t?.name_th || '',
          category:     t?.category || '',
          start_time:   fmtHM(r.started_at),
          mat_no:       r.mat_no || null,
          description:  r.description || null,
          reported_by:  r.reported_by_name || '-',
          open_min:     elapsed,
        },
      };
      const res = await fetch(NOTIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${NOTIFY_KEY}`, 'apikey': NOTIFY_KEY },
        body: JSON.stringify(payload),
      }).catch(() => null);
      // stamp กันแจ้งซ้ำ (ทำเฉพาะเมื่อ POST สำเร็จ — ล้มเหลวปล่อยให้รอบถัดไปลองใหม่)
      if (res && res.ok) {
        await db.from('downtime_logs').update({ open_alerted_at: new Date().toISOString() }).eq('id', r.id);
        sent++;
      }
    }
    return new Response(JSON.stringify({ ok: true, open_alert_min: openMin, candidates: open.length, sent }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
