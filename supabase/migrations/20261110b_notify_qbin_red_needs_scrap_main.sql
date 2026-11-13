-- ═══════════════════════════════════════════════════════════════════════════
-- 🔔 เรื่องแจ้งเตือนใหม่ `qbin_red_needs_scrap` — ของลงถังแดงแล้ว ต้องออกใบรายงานของเสีย   ·   project = Main "MAIN" (ewhdfqwfwofivojtsizn)
--
-- ที่มา: คำสั่ง user 2026-11-10 "หัวหน้าแผนก ให้ไปทวงงานจากหัวหน้าไลน์"
--   แท็กแดงอายุ 1 วัน (WI-PD3-087 §5.6) · วัด 10/11: ถังแดงยังไม่ออกใบ 74 รายการ · เคยผูกใบ 0 — ไม่มีใครถูกแจ้งเลย
-- ผู้รับ = role `supervisor` (หัวหน้าแผนก/ส่วน) **เฉพาะส่วนงานของไลน์นั้น** (match_section + scope_strict)
--   ในแอปเท่านั้น (channel_ids ว่าง · กฎ "แจ้งเตือนใหม่ = ในแอป ห้ามเพิ่ม Telegram")
--   can_mute=false — เป็นงานที่รอคนลงมือ (กฎ notification_rules.can_mute) · ยุบรวม 180 นาทีกันถี่
-- คู่กับแถวในคิวงานของฉัน `binred_unit` (src/utils/myQueue.js) — แจ้งตอนเกิด + คิวค้างให้ทวงต่อ
-- ย้อน: delete from notification_rules where event_key = 'qbin_red_needs_scrap';
-- ═══════════════════════════════════════════════════════════════════════════

insert into notification_rules (event_key, label, category, is_enabled, sort_order, channel_ids,
  inapp_roles, inapp_match_section, inapp_scope_strict, link, inapp_rollup_min, can_mute)
values ('qbin_red_needs_scrap', '🔴 ของลงถังแดง — ต้องออกใบรายงานของเสีย (หัวหน้าแผนกทวงหัวหน้าไลน์)', 'quality', true, 375, '{}',
  '{supervisor}', true, true, '/scrap-report?tab=bins', 180, false)
on conflict (event_key) do nothing;

-- ตรวจหลังรัน:
--   select event_key, inapp_roles, inapp_match_section, inapp_scope_strict, link, can_mute
--     from notification_rules where event_key = 'qbin_red_needs_scrap';
