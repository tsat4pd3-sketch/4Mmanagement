-- ═══════════════════════════════════════════════════════════════════════════════
-- การ์ด "AM พบ NG" (แดง) แยกกติกาจาก PM ช่าง + เพิ่ม leader (2026-11-25 · คำสั่ง user) · project: MAIN (ewhdfqwfwofivojtsizn)
--
-- เดิมใบ AM กับใบ PM ของช่างยิงคีย์เดียวกัน `pm_inspection_ng` ⇒ เพิ่ม leader ที่นั่น = leader ได้การ์ด NG ของช่างด้วย
-- ⇒ แถวใหม่ `am_inspection_ng` = ค่าเดียวกับ pm_inspection_ng ทุกช่อง + `leader` · ลิงก์ตั้งต้นหน้า AM
--   (โค้ด `PMCheckData.jsx` ส่งลิงก์ตรงอุปกรณ์อยู่แล้ว · title_match ไม่ใช้ เพราะส่ง link เอง)
-- · `pm_inspection_ng` ไม่แตะ ⇒ ผู้รับการ์ด NG ของช่างเหมือนเดิมเป๊ะ
-- ย้อนกลับ: revert โค้ดก่อน (ไม่งั้นใบ AM ยิงคีย์ที่ไม่มีแถว = edge 400) แล้วค่อย
--   delete from public.notification_rules where event_key = 'am_inspection_ng';
-- ═══════════════════════════════════════════════════════════════════════════════
insert into public.notification_rules
  (event_key, label, category, channel_id, is_enabled, sort_order, channel_ids, template,
   inapp_roles, inapp_sections, inapp_depts, inapp_match_section, link, title_match,
   inapp_scope_strict, inapp_match_line, inapp_cast, inapp_rollup_min, can_mute)
select 'am_inspection_ng', 'ตรวจ AM พบ NG (แดง · แจ้งทีม AM + หัวหน้าไลน์/แผนก)', category, channel_id, is_enabled, sort_order + 1,
       channel_ids, template,
       array['leader', 'mtn', 'supervisor', 'manager'], inapp_sections, inapp_depts, inapp_match_section,
       '/daily-checker?tab=amcheck', null,
       inapp_scope_strict, inapp_match_line, inapp_cast, inapp_rollup_min, can_mute
  from public.notification_rules where event_key = 'pm_inspection_ng'
on conflict (event_key) do nothing;
