-- แยกแกนสิทธิ์ AM (พนักงานหน้างาน) ออกจาก PM (ช่าง) — Main project (2026-08-06)
--
-- ปัญหา: AM กับ PM ใช้ `pm:record` ตัวเดียวกัน → ใครบันทึก AM ได้ ก็บันทึก PM ได้ทันที
--   ขัดกับนิยาม: AM = พนักงานหน้างานตรวจเองทุกกะ · PM = ช่าง (technician/engineer) ตรวจตามรอบ/เงื่อนไข
--   และทำให้ "รัดสิทธิ์ทีหลัง" ทำไม่ได้เลย เพราะไม่มีแกนให้รัด
--
-- วิธี: เพิ่ม `am:record` เป็นแกนใหม่ แล้ว **seed ให้เท่ากับ pm:record เดิมทุกประการ**
--   → ระบบ "มีแกน" ทันที แต่ **พฤติกรรมวันนี้ไม่เปลี่ยน ไม่มีใครหลุดสิทธิ์**
--   → admin ค่อยไปรัดที่ /permissions เมื่อพร้อม (เช่น ถอด pm:record ออกจาก leader ให้เหลือแต่ AM)
--
-- ⚠️ ห้าม seed ด้วย enum_range(user_role) — กับดักที่ทำให้ role ที่เพิ่มทีหลังไม่มีแถว = fail-closed เงียบ
--    (เคยเกิดกับ engineer/planner_store) → คัดลอกจากแถว pm:record ที่มีอยู่จริงแทน

-- 1) ลงทะเบียนใน permission_catalog (ให้โผล่ในหน้า /permissions แท็บ "สิทธิ์การทำงาน")
insert into permission_catalog (resource, action, label, group_name, sort)
values ('am', 'record', 'AM: บันทึกผลตรวจ (พนักงานหน้างาน)', 'การตรวจสอบและซ่อมบำรุง', 99)
on conflict (resource, action) do update
  set label = excluded.label, group_name = excluded.group_name, sort = excluded.sort;

-- อธิบายให้ pm:record ชัดขึ้นว่าคือฝั่งช่าง (เดิมชื่อกำกวมเพราะครอบทั้ง AM+PM)
update permission_catalog set label = 'PM: บันทึกผลตรวจ (ช่าง)'
where resource = 'pm' and action = 'record';

-- 2) คัดลอกสิทธิ์จาก pm:record → am:record (ยกเว้น display ที่กำลังจะถอด)
insert into role_permissions (role, permission_key, allowed)
select rp.role, 'am:record', rp.allowed
from role_permissions rp
where rp.permission_key = 'pm:record' and rp.role <> 'display'
  and not exists (select 1 from role_permissions x where x.role = rp.role and x.permission_key = 'am:record');

-- 3) จอแสดงผล (display) = อุปกรณ์ ไม่ใช่คน — ห้ามบันทึก/อนุมัติผลตรวจ
--    role นี้ใช้กับจอ TV/บอร์ดหน้าไลน์ที่ไม่ได้ login เป็นคน ไม่มีใครรับผิดชอบสิ่งที่ถูกบันทึก
update role_permissions set allowed = false
where role = 'display' and permission_key in ('pm:record', 'pm:approve', 'am:record');

-- ตรวจหลังรัน:
--   select permission_key, role, allowed from role_permissions
--    where permission_key in ('am:record','pm:record','pm:approve') order by permission_key, role;
