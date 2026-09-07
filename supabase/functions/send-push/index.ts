// send-push — ส่ง Web Push ไปยังทุก subscription ของ user (เฟส B)
// เรียกโดย trigger fn_notify_push (pg_net) ทุกครั้งที่มี row ใหม่ใน notifications
// verify_jwt=false — ปลอดภัยพอ: รับแค่ user_id/หัวข้อ แล้วส่ง push ให้ user นั้นเท่านั้น
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

// map ที่มา → หน้าเปิดตอนกด notification
// ⚠️ ต้อง mirror กับ NOTIF_ROUTE ใน src/App.jsx เสมอ (กระดิ่งกับ Web Push ต้องพาไปหน้าเดียวกัน)
// 🔴 audit 2026-09-02 — เดิมรู้จักแค่ 4 ตาราง ทั้งที่ระบบเขียน ref_table จริง 11 ค่า
//    ⇒ 1,194 แจ้งเตือนในฐาน แตะ Push แล้วเปิดหน้าแรก `/` เหมือนแอปพัง
const ROUTES: Record<string, string> = {
  four_m_logs: '/event-log',
  mtn_orders: '/mtn-repair',
  downtime_logs: '/daily-report',
  shift_schedules: '/shift-organize',
  defect_logs: '/daily-report',
  skill_level_up_requests: '/operator?tab=levelup',
  ojt_trainings: '/ojt-training',
  improvements: '/improvements',
  cqi15_event_logs: '/event-log',
  inspections: '/pm?tab=check',
  meeting_action_items: '/morning-meeting',
  lpa_audits: '/daily-checker?tab=lpa',
  scrap_reports: '/scrap-report',
  pe_change_requests: '/pe-docs',
  rack_requests: '/rack-center',
  wip_replenish_requests: '/heijunka',
  qa_ncr: '/qa?tab=ncr',
  qa_capa: '/qa?tab=capa',
  qa_customer_claims: '/qa?tab=claims',
  quality_bin_records: '/qa?tab=bins',
  material_requests: '/qa?tab=matreq',
};
function routeFor(refTable?: string): string {
  return (refTable && ROUTES[refTable]) || '/';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  try {
    const body = await req.json().catch(() => ({}));
    const userId = body.user_id;
    if (!userId) return json({ ok: false, reason: 'missing user_id' }, 400);

    // VAPID keys จาก notification_settings (service role อ่านได้)
    const { data: cfg, error: cfgErr } = await supabase
      .from('notification_settings')
      .select('vapid_public_key, vapid_private_key, vapid_subject')
      .eq('id', 1).maybeSingle();
    // ⚠️ อ่าน config ไม่ได้ ≠ "ยังไม่ได้ตั้ง VAPID" — เดิมตอบ skipped:'no vapid keys' ซึ่งชี้ทางผิด
    //    คนไล่ปัญหาจะไปหาที่การตั้งค่า ทั้งที่ปัญหาคือคิวรีล้ม
    if (cfgErr) { console.error('send-push read config failed', cfgErr.message); return json({ ok: false, error: 'read config failed: ' + cfgErr.message }, 500); }
    if (!cfg?.vapid_public_key || !cfg?.vapid_private_key) return json({ ok: true, skipped: 'no vapid keys' });
    webpush.setVapidDetails(cfg.vapid_subject || 'mailto:admin@example.com', cfg.vapid_public_key, cfg.vapid_private_key);

    const { data: subs, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId);
    // ⚠️ อ่านรายชื่อ subscription ไม่ได้ ≠ "user ยังไม่เปิด Push" — เดิมตอบ ok:true sent:0 เหมือนกันเป๊ะ
    //    เรียกจาก pg_net แบบ fire-and-forget ไม่มีใครอ่าน response → ต้องดังใน log ไว้ก่อน
    if (subErr) { console.error('send-push read subscriptions failed', subErr.message); return json({ ok: false, error: 'read subscriptions failed: ' + subErr.message }, 500); }
    if (!subs?.length) return json({ ok: true, sent: 0 });

    const payload = JSON.stringify({
      title: body.title || 'ESM แจ้งเตือน',
      body:  body.body || '',
      url:   routeFor(body.ref_table),
      tag:   body.ref_table && body.ref_id ? `${body.ref_table}:${body.ref_id}` : undefined,
    });

    let sent = 0, failed = 0;
    const dead: string[] = [];
    const codes: Record<string, number> = {};
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) { dead.push(s.id); return; } // subscription หมดอายุ → ลบทิ้ง
        // ⚠️ error อื่นเดิมถูกกลืนทั้งหมด (401 VAPID ผิด · 403 · 413 payload ใหญ่ · 429 โดนจำกัด)
        //    แล้วยังตอบ ok:true sent:0 → **Push ตายทั้งระบบได้โดยไม่มีใครรู้**
        //    (เรียกจาก pg_net แบบ fire-and-forget ไม่มีใครอ่าน response → log ต้องดังไว้ก่อน)
        failed++;
        codes[String(code ?? 'unknown')] = (codes[String(code ?? 'unknown')] ?? 0) + 1;
        console.error('send-push failed', code, String(err).slice(0, 200));
      }
    }));
    if (dead.length) await supabase.from('push_subscriptions').delete().in('id', dead);

    return json({ ok: failed === 0, sent, failed, removed: dead.length, codes },
      failed && !sent ? 502 : 200);
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
});
