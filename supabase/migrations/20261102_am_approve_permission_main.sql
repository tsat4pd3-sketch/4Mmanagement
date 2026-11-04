-- ═══════════════════════════════════════════════════════════════════════════
-- ✍️ แยกแกนสิทธิ์ "รับทราบ/อนุมัติผลตรวจ AM" (am:approve) ออกจาก pm:approve   ·   project = Main "MAIN" (ewhdfqwfwofivojtsizn)
--
-- ที่มา: ประชุมหน้างาน 2026-11-02 (B2) — AM ต้องไล่ขั้น พนักงาน → หัวหน้ากลุ่มรับทราบ → หัวหน้าแผนก/ส่วน
--   แต่ role `leader` ไม่มี `pm:approve` ⇒ หัวหน้ากลุ่มกดรับทราบใบ AM ไม่ได้ งานกองไปที่ supervisor/manager ("กระโดดไปผู้จัดการ")
--   ลำดับขั้นตามตำแหน่งตัดสินที่ `src/utils/amApproval.js` · คีย์นี้ = ชั้น ② "กดปุ่มเป็นไหม"
--
-- วิธี: seed `am:approve` = ผู้ถือ `pm:approve` เดิมทุกแถว + เพิ่ม `leader` (หัวหน้ากลุ่ม)
--   ⚠️ ห้าม seed ด้วย enum_range(user_role) — คัดลอกจากแถวที่มีจริง (กับดักเดิม · 20260806_am_pm_permission_axis.sql)
--   ⚠️ display = จอ ไม่ใช่คน ห้ามอนุมัติ
-- ไม่แตะ RLS (DR `inspections` เป็น anon-open ตามกฎ supabaseDR · Main ไม่มีตารางที่เกี่ยว)
-- ยังไม่ apply: โค้ดถอยไปใช้ `pm:approve` (isActionSeeded('am','approve') = false) = พฤติกรรมเดิม
-- ย้อน: delete from role_permissions where permission_key='am:approve';
--       delete from permission_catalog where resource='am' and action='approve';
-- ═══════════════════════════════════════════════════════════════════════════

insert into permission_catalog (resource, action, label, group_name, sort)
values ('am', 'approve', 'AM: รับทราบ/อนุมัติผลตรวจ (ไล่ขั้นตามตำแหน่ง)', 'การตรวจสอบและซ่อมบำรุง', 99)
on conflict (resource, action) do update
  set label = excluded.label, group_name = excluded.group_name, sort = excluded.sort;

insert into role_permissions (role, permission_key, allowed)
select rp.role, 'am:approve', rp.allowed
from role_permissions rp
where rp.permission_key = 'pm:approve' and rp.role::text <> 'display'
  and not exists (select 1 from role_permissions x where x.role = rp.role and x.permission_key = 'am:approve');

insert into role_permissions (role, permission_key, allowed)
select 'leader'::user_role, 'am:approve', true
where not exists (select 1 from role_permissions x where x.role = 'leader'::user_role and x.permission_key = 'am:approve');

-- ตรวจหลังรัน:
--   select permission_key, role, allowed from role_permissions
--    where permission_key in ('am:approve','pm:approve') order by permission_key, role;
