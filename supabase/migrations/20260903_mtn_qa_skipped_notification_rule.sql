-- ══════════════════════════════════════════════════════════════════════════
-- แจ้งเตือน "ข้ามการตรวจ QA" ของใบแจ้งซ่อม (event mtn_qa_skipped)   2026-09-03
-- Project: MAIN (ewhdfqwfwofivojtsizn)
--
-- คู่กับ supabase/migrations/20260903_mtn_qa_skip.sql (DR) + edge `send-mtn-notification`
-- ก๊อปห้อง Telegram + role ในแอปจาก `mtn_checked` (ขั้น 4 — คนกลุ่มเดียวกันที่ต้องรู้ว่าใบ
-- ถูกดึงออกจากคิว QA แล้ว) · ไม่ทับถ้ามีแถวอยู่แล้ว · รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════
insert into public.notification_rules (event_key, label, category, is_enabled, channel_ids, inapp_roles, sort_order)
select 'mtn_qa_skipped', 'ข้ามการตรวจ QA — งานไม่เกี่ยวกับคุณภาพ (step5→6)', 'maintenance', true,
       coalesce(r.channel_ids, '{}'), coalesce(r.inapp_roles, '{}'), 34
  from (select 1) x
  left join public.notification_rules r on r.event_key = 'mtn_checked'
on conflict (event_key) do nothing;

-- ตรวจผล:
--   select event_key, channel_ids, inapp_roles from public.notification_rules where event_key = 'mtn_qa_skipped';
-- Rollback:
--   delete from public.notification_rules where event_key = 'mtn_qa_skipped';
