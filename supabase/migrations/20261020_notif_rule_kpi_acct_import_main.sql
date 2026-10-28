-- 2026-10-20 · MAIN ("MAIN" ewhdfqwfwofivojtsizn) · apply แล้วผ่าน MCP 20/10
-- กฎแจ้งเตือนในแอป: ผลนำเข้าตัวเลขบัญชีอัตโนมัติ (GitHub Actions acct-import → scripts/acct-import/run_queue.mjs)
-- user 20/10: "ไม่ใช้ Telegram ละ โฟกัสระบบแจ้งเตือนในแอพ" ⇒ ไม่มี channel_ids · ผู้รับตาม inapp_roles (+inapp_sections)
-- บทเรียน docs/modules/notify-inapp-audit.md: ยิงตาม role กว้าง = ไม่มีใครอ่าน ⇒ seed แค่ admin · ปรับได้ที่ /notification-config
-- category 'kpi' ใหม่ (ป้าย CATEGORY_LABEL ใน NotificationConfig.jsx เพิ่มแล้ว)
insert into public.notification_rules
  (event_key, label, category, sort_order, is_enabled,
   inapp_roles, inapp_match_section, inapp_scope_strict, inapp_cast, link)
values
  ('kpi_acct_import', 'ผลนำเข้าตัวเลขบัญชีรายเดือน (อัตโนมัติจากเมล → ตัวเลขฐาน KPI ทั้งโรงงาน)', 'kpi', 10, true,
   array['admin']::text[], false, false, 'always', '/obeya?tab=kpi')
on conflict (event_key) do update
  set label = excluded.label,
      category = excluded.category,
      sort_order = excluded.sort_order,
      link = coalesce(public.notification_rules.link, excluded.link);
-- ตรวจ: select event_key, category, is_enabled, inapp_roles, inapp_sections, link from public.notification_rules where event_key = 'kpi_acct_import';
-- ย้อน: delete from public.notification_rules where event_key = 'kpi_acct_import';
