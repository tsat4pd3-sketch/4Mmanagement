-- Main project (ewhdfqwfwofivojtsizn · จอ Supabase "MAIN") · 2026-11-13
-- ตัดคีย์ "ทั้งโรงงาน / เซ็นแทนฝ่ายอื่น" ออกจาก bucket dept_admin (= Key User · flag profiles.is_dept_admin)
-- ที่มา + ผลตรวจรายคีย์: docs/ROLE-SCOPE-AUDIT-2026-11-13.md §4
-- ✅ user รันเองใน SQL Editor 13/11 แล้ว (ผลเช็ค: 16 คีย์ allowed=false · สำรอง 168 แถว)
-- ไฟล์นี้บันทึกไว้ให้ประวัติ schema ครบ — รันซ้ำได้ (idempotent)
-- ย้อน: update public.role_permissions r set allowed = b.allowed
--       from archive.bk_dept_admin_bucket_20261113 b
--       where r.role = b.role and r.permission_key = b.permission_key;

create table if not exists archive.bk_dept_admin_bucket_20261113 as
select * from public.role_permissions where role = 'dept_admin';

update public.role_permissions
set allowed = false
where role = 'dept_admin'
  and allowed = true
  and permission_key in (
    'company_calendar:edit','org:manage_divisions','skills:run_weekly_update',
    'four_m:manage_docs','demand:upload','shipping:config','employees:edit_all_sections',
    'mtn_repair:qa','event_log:approve_qt',
    'daily_report:open_shift','daily_report:close_shift','daily_report:approve_close','daily_report:setup',
    'qa:record','qa:record_action','line_setup:delete'
  );
