-- ═══ เปิดหน้า /operator ให้ role mtn — ช่างเข้าไปเพิ่ม/แก้สกิลทีมตัวเอง (feedback 2026-08-19) ═══
-- โปรเจค: Main (ewhdfqwfwofivojtsizn)
--
-- ที่มา: RLS employee_skills เปิด skills:edit ให้ mtn แล้ว (20260817) และ UI แยกสิทธิ์สกิล
--   ออกจาก employees:edit แล้ว (canEditSkillsFor) — แต่ role mtn ไม่มีแถว page:/operator
--   (กับดัก enum_range: หน้า seed ก่อน role เกิด) = เข้าหน้าฐานพนักงานไม่ได้เลย
-- ให้เฉพาะ page:/operator — ไม่แจก employees:edit (แก้ประวัติพนักงานยังเป็นของฝ่ายบุคคล/หัวหน้าผลิต
--   ช่างได้เฉพาะแผงสกิลตาม skills:edit ที่มีอยู่แล้ว)
--
-- Rollback: delete from role_permissions where role='mtn' and permission_key='page:/operator';

insert into public.role_permissions (role, permission_key, allowed)
select 'mtn'::user_role, 'page:/operator', true
where not exists (select 1 from public.role_permissions rp
                  where rp.role = 'mtn'::user_role and rp.permission_key = 'page:/operator');
