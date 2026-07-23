-- Restore delete of lines / workstations (จุดงาน) / WIP / machine points for
-- หัวหน้าแผนก/หัวหน้าส่วน (role = supervisor).
-- Target project: main (ewhdfqwfwofivojtsizn).
--
-- Why: 20260722_separate_delete_permissions.sql split delete into its own key and
-- defaulted `line_setup:delete` to admin+manager only. That silently removed the
-- 🗑️ delete buttons in /linesetup for supervisors (department heads) — they could
-- still add/edit (line_setup:edit still includes supervisor) but not delete, which
-- read to users as "แก้/ลบไม่ได้". Department heads manage their own lines/จุดงาน,
-- so delete is restored for them here.
--
-- Scope: ONLY line_setup:delete → supervisor. The other tightened deletes
-- (shift_schedule/scrap/mtn_repair/improvements) stay admin+manager by design;
-- widen those from the /permissions page if needed.
-- Idempotent: safe to run more than once. Admin can still re-toggle at /permissions.
update role_permissions
   set allowed = true
 where role = 'supervisor'
   and permission_key = 'line_setup:delete';

-- กันเคสแถวยังไม่ถูก seed (เผื่อ apply ก่อน 20260722) — insert แล้วค่อย update ให้ true
insert into role_permissions (role, permission_key, allowed)
values ('supervisor', 'line_setup:delete', true)
on conflict (role, permission_key) do update set allowed = true;
