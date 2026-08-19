-- QA FME scan — เรียก QA มาตรวจ + เตือนซ้ำเมื่อเกินเวลา · ทุก 5 นาที
-- Project: MAIN (ewhdfqwfwofivojtsizn) — ตรง project ของ edge function qa-fme-scan
-- function deploy ด้วย verify_jwt=false (เหมือน downtime-open-scan / pm-daily-scan)
--
-- ⚠️ ตัว function เช็ค qa_fme_config.is_enabled เองก่อนทำอะไรทั้งสิ้น → cron วิ่งได้ตั้งแต่วันนี้
--    โดยยังไม่มีข้อความออกไปไหน จนกว่าจะกดเปิดที่ /qa (แท็บใบตรวจ → ⚙️ ตั้งค่าการเรียกตรวจ)
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin
  perform cron.unschedule('qa-fme-scan');
exception when others then null;
end $$;

select cron.schedule('qa-fme-scan', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://ewhdfqwfwofivojtsizn.supabase.co/functions/v1/qa-fme-scan',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
$cron$);
