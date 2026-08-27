-- 🏢 หน่วยงานสนับสนุนแก้ผังองค์กร "ของตัวเอง" ได้  (Main)
--
-- ที่มา (user 2026-08-24): "คนที่เป็นบัญชีนี้ก็ไม่เห็นหน้าจัดการผังองค์กร
--   ทำให้ไม่สามารถเข้าไปเพิ่มรายละเอียดผังองค์กรของตัวเอง"
--
-- ทางตันที่เกิดจริง:
--   1. `Planning&Store` ไม่มีแผนกในผังเลย (0 แถว) → ฟอร์มลงทะเบียนพนักงานเลือกแผนกไม่ได้
--   2. ระบบบอกให้ไปเพิ่มที่ `/org-setup` — แต่หน้านั้น seed ไว้ **admin เท่านั้น**
--   3. ติ๊ก "แอดมินหน่วยงาน" ก็ไม่ช่วย เพราะ bucket `dept_admin` **ปลดล็อก `page:*` ไม่ได้โดยดีไซน์**
--   ⇒ หน่วยงานไม่มีทางเพิ่มแผนกของตัวเองได้เลย ต้องรบกวน admin ทุกครั้ง
--
-- โมเดล = precedent เดียวกับ `shift_schedule:edit_dept` (2026-08-20):
--   • เปิด **หน้า** ให้ role สนับสนุน "เข้าดูได้" (ผังองค์กรเป็นข้อมูลที่ทุกคนควรเห็นอยู่แล้ว)
--   • สิทธิ์ **แก้** อยู่ที่คีย์ใหม่ `org:manage_own_unit` → แก้ได้เฉพาะ
--     **แผนก/กลุ่มใต้ส่วนงานของตัวเอง** (`profiles.section`) เท่านั้น
--   • **โครงระดับ Section ยังเป็นของ admin ล้วน** — เพิ่ม/แก้/ลบ section ไม่เปิดให้หน่วยงาน
--     (เปลี่ยนชื่อ/ลบ section = cascade ทั้งระบบ)
--
-- ⚠️ "ส่วนงานของฉัน" ใช้ `profiles.section` (คอลัมน์เดี่ยว) **ห้ามใช้ `sections[]`**
--    `sections[]` เป็น scope ทั้งระบบ ตั้งเมื่อไหร่หน้าอื่นเหลือ 0 แถวทันที (กฎเหล็กเดิม)
-- ⚠️ บัญชีที่ยังไม่ได้ตั้ง `profiles.section` = ยังแก้อะไรไม่ได้ → หน้าจอขึ้นแถบส้มบอกให้ admin ไปตั้งให้
--    (ข้อมูลจริงตอนเขียน: `planner_store` 1 บัญชี · is_dept_admin = true · **section = null**)

-- 1) ทะเบียนคีย์ (ไม่ลงทะเบียน = admin ปรับจากหน้า /permissions ไม่ได้)
insert into public.permission_catalog (resource, action, label, group_name, sort)
select 'org', 'manage_own_unit', 'แก้ผังองค์กรเฉพาะหน่วยงานตัวเอง (แผนก/กลุ่มใต้ส่วนงานของตน)',
       'ตั้งค่าโปรแกรม,ฐานข้อมูล', 905
where not exists (select 1 from public.permission_catalog where resource = 'org' and action = 'manage_own_unit');

-- 2) ใครแก้หน่วยงานตัวเองได้ — หัวหน้าส่วน + แอดมินหน่วยงาน (bucket)
insert into public.role_permissions (role, permission_key, allowed)
select r, 'org:manage_own_unit', true
  from unnest(array['admin','manager','supervisor','dept_admin']::user_role[]) r
where not exists (
  select 1 from public.role_permissions p where p.role = r and p.permission_key = 'org:manage_own_unit');

-- 3) เปิด "หน้า" ให้ role สนับสนุนเข้าดู (แก้ได้เฉพาะผู้ถือคีย์ข้อ 2 + ส่วนงานตัวเอง)
--    ⚠️ ต้อง seed ที่ base role — bucket `dept_admin` ให้ page:* ไม่ได้
insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/org-setup', true
  from unnest(array['manager','supervisor','planner_store','sale','mtn','qa','engineer','document_control']::user_role[]) r
where not exists (
  select 1 from public.role_permissions p where p.role = r and p.permission_key = 'page:/org-setup');

-- Rollback:
--   delete from public.role_permissions where permission_key = 'org:manage_own_unit';
--   delete from public.role_permissions where permission_key = 'page:/org-setup'
--     and role <> 'admin';
--   delete from public.permission_catalog where resource='org' and action='manage_own_unit';
