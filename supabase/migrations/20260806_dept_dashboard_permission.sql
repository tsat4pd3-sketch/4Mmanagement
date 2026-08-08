-- 📊 Dashboard ส่วนงาน (/dept-dashboard) — หน้าเดียว สลับส่วนงานด้วย ?dept= (ผลิต/ซ่อมบำรุง/สโตร์/QA) · 2026-08-06
-- อ่านอย่างเดียว · ข้อมูลกรองตาม scope เดิม (leader = family ไลน์ตัวเอง · role อื่น = ตาม sections)
-- seed ทุก role: หน้าเป็นสรุปงานค้าง + ทางลัด ไม่มีข้อมูลลับเกินกว่าที่หน้านั้นๆ ให้ดูอยู่แล้ว
insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/dept-dashboard', true
from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;
