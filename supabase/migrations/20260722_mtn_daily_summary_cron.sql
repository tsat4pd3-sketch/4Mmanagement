-- สรุปงานซ่อม (MO) ค้าง — ยิงทุกเช้า 09:00 ไทย (02:00 UTC) ผ่าน pg_cron + pg_net
-- Project: MAIN (ewhdfqwfwofivojtsizn) — ตรง project ของ edge function mtn-daily-summary
-- function deploy ด้วย verify_jwt=false → เรียกได้โดยไม่ต้องแนบ JWT (ปลอดภัยพอ: read-only + ส่ง Telegram)
-- function อ่าน mtn_orders จาก DR (DR_URL/DR_ANON_KEY) แล้ว route ผ่าน notification_rules/telegram_channels ฝั่ง Main
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  perform cron.unschedule('mtn-daily-summary');
exception when others then null;
end $$;

select cron.schedule('mtn-daily-summary', '0 2 * * *', $cron$
  select net.http_post(
    url := 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/mtn-daily-summary',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
$cron$);
