-- ═══════════════════════════════════════════════════════════════════════════════
-- BBS พบพฤติกรรมไม่ปลอดภัย = แจ้งในแอป (2026-11-25 · คำสั่ง user "BBS แจ้งเตือนด้วย") · project: MAIN (ewhdfqwfwofivojtsizn)
-- ยิงจาก `BbsCheck.jsx`: ทาช่อง "ไม่เหมาะสม" (ใหม่) 1 การ์ด · เติมอัตโนมัติจาก PPE ที่พบไม่สวม = รวม 1 การ์ดต่อครั้ง
-- ผู้รับ: leader + supervisor ของส่วนงานไลน์ (ปรับได้ที่ /notification-config) · Telegram ไม่ส่ง (channel ว่าง · นโยบายในแอปก่อน)
-- ย้อนกลับ: revert โค้ดก่อน แล้ว delete from public.notification_rules where event_key = 'bbs_unsafe';
-- ═══════════════════════════════════════════════════════════════════════════════
insert into public.notification_rules
  (event_key, label, category, is_enabled, sort_order, channel_ids, inapp_roles, inapp_sections, inapp_depts,
   inapp_match_section, link, inapp_cast, can_mute)
values
  ('bbs_unsafe', '🦺 BBS พบพฤติกรรมไม่ปลอดภัย', 'safety', true, 423, '{}',
   array['leader','supervisor'], '{}', '{}', true, '/daily-checker?tab=bbs', 'always', true)
on conflict (event_key) do nothing;
