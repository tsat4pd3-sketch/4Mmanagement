-- 🏢 ภาพรวมกลุ่มโรงงาน (Group Overview) — หน้า MOCKUP ตอบโจทย์ผู้บริหาร "ดูหลายโรงงานพร้อมกัน" · 2026-08-05
-- โรงงานที่ 1 = ข้อมูลจริงจากระบบ · ที่เหลือปั้นจากข้อมูลชุดเดียวกัน (ไม่เขียน DB ไม่มีตาราง plant จริง)
-- seed เฉพาะ admin/manager (จอผู้บริหาร + ยังเป็นตัวอย่าง ไม่ควรให้หน้างานเข้าใจผิดว่ามีหลายโรงจริง)
-- role อื่นเปิดเพิ่มได้เองจากหน้า /permissions
insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/group-overview', true
from unnest(array['admin','manager']::user_role[]) r
on conflict (role, permission_key) do nothing;
