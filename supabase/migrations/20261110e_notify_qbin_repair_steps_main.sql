-- ═══════════════════════════════════════════════════════════════════════════
-- 🔔 แจ้งเตือนขั้นซ่อมของใบถังเหลือง (แบบใบ MO)   ·   project = Main "MAIN" (ewhdfqwfwofivojtsizn)
--   qbin_repair_needed   QA ตัดสิน "ซ่อม"     → หัวหน้าไลน์/แผนก ของส่วนงานนั้น (ขั้น 3)
--   qbin_repair_done     ฝ่ายผลิตลงผลซ่อม     → QA (ขั้น 4 ตรวจรับ)
--   qbin_repair_rejected QA ตีกลับงานซ่อม     → หัวหน้าไลน์/แผนก ของส่วนงานนั้น (กลับขั้น 3)
-- ในแอปเท่านั้น · can_mute=false (งานรอคนลงมือ) · ยุบ 180 นาที
-- ย้อน: delete from notification_rules where event_key in ('qbin_repair_needed','qbin_repair_done','qbin_repair_rejected');
-- ═══════════════════════════════════════════════════════════════════════════
insert into notification_rules (event_key, label, category, is_enabled, sort_order, channel_ids,
  inapp_roles, inapp_match_section, inapp_scope_strict, link, inapp_rollup_min, can_mute)
values
 ('qbin_repair_needed',   '🔧 QA ให้ซ่อมของในถังเหลือง (ขั้น 3 · ฝ่ายผลิต)', 'quality', true, 371, '{}',
  '{supervisor,leader}', true, true, '/scrap-report?tab=bins', 180, false),
 ('qbin_repair_done',     '🔎 ซ่อมเสร็จ รอ QA ตรวจรับ (ขั้น 4)',               'quality', true, 372, '{}',
  '{qa}', false, false, '/qa?tab=bins', 180, false),
 ('qbin_repair_rejected', '↩️ QA ตีกลับงานซ่อม (กลับขั้น 3)',                  'quality', true, 373, '{}',
  '{supervisor,leader}', true, true, '/scrap-report?tab=bins', 180, false)
on conflict (event_key) do nothing;
-- ตรวจ: select event_key, inapp_roles, link from notification_rules where event_key like 'qbin_repair_%';
