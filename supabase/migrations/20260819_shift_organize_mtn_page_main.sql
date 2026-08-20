-- ═══ เปิดหน้า /shift-organize ให้ role mtn — หัวหน้าทีมช่างตั้งกะหน่วยงานตัวเอง (2026-08-19) ═══
-- โปรเจค: Main (ewhdfqwfwofivojtsizn)
--
-- ที่มา: ตารางกะหน่วยงานสนับสนุน (shift_schedules.dept_name · 2026-08-11) รองรับแผนก MTN/JIG/DIE
--   แล้ว แต่ page:/shift-organize seed ไว้แค่ admin/mgr/sv ตั้งแต่ 20260706 — ก่อน role mtn เกิด
--   (กับดัก enum_range) = แอดมินหน่วยงานช่างเข้าหน้าไม่ได้เลย ทั้งที่ bucket dept_admin
--   มี shift_schedule:edit พร้อมอยู่แล้ว (bucket ปลดล็อก page:* ไม่ได้โดยดีไซน์)
-- ผล: mtn ทุกคนเข้าดูตารางกะได้ · แก้ได้เฉพาะคนที่ถือ shift_schedule:edit
--   (แอดมินหน่วยงาน ผ่าน bucket dept_admin) — ชั้นสิทธิ์เดิมไม่เปลี่ยน
-- role support อื่น (qa/planner_store/sale) ยังไม่เปิด — admin ติ๊กเองที่ /permissions ถ้าหัวหน้า
--   หน่วยงานนั้นต้องตั้งกะเอง
--
-- Rollback: delete from role_permissions where role='mtn' and permission_key='page:/shift-organize';

insert into public.role_permissions (role, permission_key, allowed)
select 'mtn'::user_role, 'page:/shift-organize', true
where not exists (select 1 from public.role_permissions rp
                  where rp.role = 'mtn'::user_role and rp.permission_key = 'page:/shift-organize');
