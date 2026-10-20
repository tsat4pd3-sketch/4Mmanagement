-- Main project (ewhdfqwfwofivojtsizn · "MAIN") — 2026-10-20 · คำสั่ง user "ข้อ 2 แจ้งแอดมินช่าง"
-- เรื่องแจ้งเตือน `mtn_pr_waiting`: ใบ MO ที่ MTN ตัดสินว่าต้องเปิด PR / รายการขอซื้อที่ยังไม่มีเลข PR จาก SAP
-- ผู้รับในแอป: role mtn (ไม่กรองไลน์/ส่วนงาน — แอดมินช่างไม่ได้สังกัดไลน์) · edge กรองทีมช่างด้วย `team` ที่ส่งมา
-- 🔧 แคบลงให้เหลือแอดมินจริง = ตั้งแผนก/ส่วนงานที่ /notification-config (ห้ามฮาร์ดโค้ดผู้รับในโค้ด)
-- ✅ สถานะ 20/10: apply แล้วผ่าน MCP
insert into public.notification_rules (event_key, label, category, is_enabled, sort_order, channel_ids, inapp_roles, inapp_sections, inapp_depts, inapp_match_section, inapp_match_line, inapp_scope_strict, inapp_cast, link)
values ('mtn_pr_waiting', 'ใบ MO รอเปิด PR / รอเลข PR จาก SAP (แจ้งแอดมินช่าง)', 'maintenance', true, 36, '{}', array['mtn'], '{}', '{}', false, false, false, 'always', '/equipment?tab=spare')
on conflict (event_key) do nothing;
-- ย้อนกลับ: delete from public.notification_rules where event_key = 'mtn_pr_waiting';

-- 20/10 (ต่อ) · user หาลิสต์ MO ที่รอเลข PR ไม่เจอ ⇒ ลิงก์แจ้งเตือนชี้ไปตัวกรองงาน PR ในหน้ารายการ MO (apply แล้ว)
update public.notification_rules set link = '/mtn-repair?pr=waiting' where event_key = 'mtn_pr_waiting';
