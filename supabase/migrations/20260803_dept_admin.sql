-- แอดมินหน่วยงาน (Department Admin) — ชั้น 2 ต่อหน่วยงานสนับสนุน (indirect ที่ไม่ใช่ฝ่ายผลิต) · 2026-08-03
-- โจทย์ (คำสั่ง user): แยกเป็น 2 ชั้นในหน่วยงานเดียวกัน
--   • user หน่วยงาน   = ดู/ใช้งานหน้าได้ แต่แก้/ตั้งค่าไม่ได้ (role เดิม: mtn/qa/sale/planner_store/...)
--   • แอดมินหน่วยงาน = แก้ข้อมูล master/config + อนุมัติ workflow ของหน่วยงานตัวเอง — ไม่ใช่ admin ระบบ
--     (ไม่ได้ /permissions, /org-setup, add-user ทั้งระบบ — เฉพาะ action ในหน้าที่ base role เข้าถึงได้)
--
-- โมเดล: flag ต่อ user (profiles.is_dept_admin) ซ้อนบน role เดิม — ไม่เพิ่ม role รายหน่วยงานเป็นสิบตัว
--   'dept_admin' เป็น "bucket สิทธิ์" ใน role_permissions (ไม่ assign เป็น base role ให้ใคร)
--   hasPermission: ถ้า user มี flag → ได้สิทธิ์ตาม bucket dept_admin เพิ่ม (เฉพาะ action ไม่รวม page:*)
--   scope จำกัดตาม section/ทีมของ base role ตามเดิม (แอดมินหน่วยงานเห็น/แก้ได้เฉพาะข้อมูลหน่วยงานตัวเอง)
--   ปรับ "แอดมินหน่วยงานทำอะไรได้" ที่ /permissions คอลัมน์ 🛡️ แอดมินหน่วยงาน (data-driven)

alter type user_role add value if not exists 'dept_admin';

alter table public.profiles add column if not exists is_dept_admin boolean default false;

-- seed bucket = action ทั้งหมดที่ manager ทำได้ (ไม่รวม page:* — dept admin ใช้หน้าตาม base role)
-- admin ปรับเพิ่ม/ลดได้เองที่ /permissions ภายหลัง
insert into public.role_permissions (role, permission_key, allowed)
select 'dept_admin'::user_role, permission_key, true
from public.role_permissions
where role = 'manager' and allowed = true and permission_key not like 'page:%'
on conflict (role, permission_key) do nothing;
