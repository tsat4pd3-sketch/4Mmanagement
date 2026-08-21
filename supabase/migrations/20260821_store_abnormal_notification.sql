-- 🚨 แจ้งเตือนฝั่ง Store — เดิมไม่มีเลยสักตัว  (Main) · apply แล้ว 2026-08-21
--
-- ที่มา (audit 2026-08-21): notification_rules ทั้งระบบ 30 event
--   ซ่อมบำรุง 14 · ผลิต 6 · คุณภาพ 3 · กำลังคน 3 · **logistic 4 และทั้ง 4 เป็นเรื่องส่งลูกค้าล้วน**
--   (edi_import / shipping_shipped / shipping_overdue / shipping_phase_alert)
--   ⇒ ฝั่งสโตร์ (สต๊อกต่ำกว่า Min / ล้น / ใบสั่งซื้อค้าง / รอบส่งภายในเลยเวลา) ไม่เคยมีใครถูกแจ้ง
--     หน้า /store-monitor ตรวจเจอครบ แต่ต้องเปิดหน้าดูเอง → ไม่เปิด = ไม่มีใครรู้
--
-- ⚠️ และทั้ง 4 event เดิม `inapp_roles` ว่างหมด = ไม่มีอะไรเข้ากระดิ่ง/Web Push เลย มีแต่ Telegram
--    ใครไม่ได้อยู่ในห้องนั้นก็ไม่รู้เรื่อง → เติมให้ครบในไฟล์เดียวกัน

insert into public.notification_rules (category, event_key, label, is_enabled, channel_ids, inapp_roles)
select 'logistic', 'store_abnormal',
       '🚨 เฝ้าระวังสโตร์ (สต๊อกต่ำ/ล้น · ใบสั่งซื้อค้าง · รอบส่งเลยเวลา)', true,
       -- ใช้ห้องเดียวกับ shipping_phase_alert ไปก่อน — เปลี่ยนได้ที่ /notification-config
       coalesce((select channel_ids from public.notification_rules where event_key='shipping_phase_alert'), '{}'),
       array['planner_store','sale','manager','admin']::user_role[]
where not exists (select 1 from public.notification_rules where event_key = 'store_abnormal');

update public.notification_rules
   set inapp_roles = array['planner_store','sale','manager','admin']::user_role[]
 where category = 'logistic'
   and coalesce(array_length(inapp_roles, 1), 0) = 0;

-- Rollback:
--   delete from public.notification_rules where event_key = 'store_abnormal';
--   update public.notification_rules set inapp_roles = '{}' where category='logistic';
