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
function routeFor(refTable?: string): string {
  switch (refTable) {
    case 'four_m_logs':  return '/event-log';
    case 'mtn_orders':   return '/mtn-repair';
    case 'downtime_logs':return '/daily-report';
    case 'shift_schedules': return '/shift-organize';
    default:             return '/';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  try {
    const body = await req.json().catch(() => ({}));
    const userId = body.user_id;
    if (!userId) return json({ ok: false, reason: 'missing user_id' }, 400);

    // VAPID keys จาก notification_settings (service role อ่านได้)
    const { data: cfg } = await supabase
      .from('notification_settings')
      .select('vapid_public_key, vapid_private_key, vapid_subject')
      .eq('id', 1).maybeSingle();
    if (!cfg?.vapid_public_key || !cfg?.vapid_private_key) return json({ ok: true, skipped: 'no vapid keys' });
    webpush.setVapidDetails(cfg.vapid_subject || 'mailto:admin@example.com', cfg.vapid_public_key, cfg.vapid_private_key);

    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId);
    if (!subs?.length) return json({ ok: true, sent: 0 });

    const payload = JSON.stringify({
      title: body.title || 'ESM แจ้งเตือน',
      body:  body.body || '',
      url:   routeFor(body.ref_table),
      tag:   body.ref_table && body.ref_id ? `${body.ref_table}:${body.ref_id}` : undefined,
    });

    let sent = 0;
    const dead: string[] = [];
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) dead.push(s.id); // subscription หมดอายุ → ลบทิ้ง
      }
    }));
    if (dead.length) await supabase.from('push_subscriptions').delete().in('id', dead);

    return json({ ok: true, sent, removed: dead.length });
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
});
