-- สิทธิ์หน้า มอบหมายขนส่ง (Transport) — Teiki-bin phase 1 · 2026-07-21
-- TARGET PROJECT: Main (ewhdfqwfwofivojtsizn) — role_permissions อยู่ฝั่ง Main
-- page:/transport = ดูได้ทุก role (logistic ใช้งานหลัก) · transport:manage = จัดการ carrier/มอบหมาย

insert into public.role_permissions (role, permission_key, allowed)
select r, 'page:/transport', true
from unnest(enum_range(null::user_role)) r
on conflict (role, permission_key) do nothing;

insert into public.role_permissions (role, permission_key, allowed)
select r, 'transport:manage', true
from unnest(array['admin','manager','supervisor','leader','planner_store']::user_role[]) r
on conflict (role, permission_key) do nothing;
