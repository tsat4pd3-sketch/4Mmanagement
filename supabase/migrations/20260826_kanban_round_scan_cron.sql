-- ⏰ cron: kanban-round-scan ทุก 10 นาที  (DR)
--
-- คู่กับ edge `kanban-round-scan` + วิว `v_kanban_round_due` + rule `kanban_round_cutoff` (Main)
--
-- ⚠️ ทำไมต้อง */10 ทั้งวัน ทั้งที่ตัดยอดมีแค่ 3 เวลา (08:30/12:00/15:00)
--    เวลาตัดยอดเป็น **ข้อมูล** (`kanban_delivery_rounds.cutoff_time`) ที่หัวหน้าแก้เองได้ที่
--    📦 Line Stock → ⏰ รอบจัดส่ง · hardcode เวลาลง cron = พอมีคนขยับรอบ แจ้งเตือนจะเงียบทันที
--    โดยไม่มีใครรู้ (ล้มเหลวเงียบ) · ให้ cron เดินสม่ำเสมอแล้วให้ "วิว" เป็นคนตัดสินว่าถึงเวลาไหม
--
-- ต้นทุน: วิวกรอง `now_w >= cutoff_w and now_w < cutoff_w + 90` → 141 จาก 144 รอบ/วัน
--    คืน 0 แถวแล้ว edge ออกทันที (คิวรีเดียว) — pattern เดียวกับ shipping-phase-scan
--
-- ไม่ส่ง Authorization เพราะ deploy ด้วย verify_jwt=false (เหมือน store-daily-scan)

select cron.schedule(
  'kanban-round-scan',
  '*/10 * * * *',
  $$
  select net.http_post(
    url     := 'https://eyhclzkifitbhbljgoav.supabase.co/functions/v1/kanban-round-scan',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- ตรวจผล:
--   select jobname, schedule, active from cron.job where jobname = 'kanban-round-scan';
--   select status, start_time, return_message from cron.job_run_details
--     where jobid = (select jobid from cron.job where jobname='kanban-round-scan')
--     order by start_time desc limit 5;
--
-- Rollback: select cron.unschedule('kanban-round-scan');
