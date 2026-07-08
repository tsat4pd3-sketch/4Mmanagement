-- Phase 0 of the CRUD-level permissions plan (docs/PERMISSIONS-DESIGN.md).
-- Target project: main (ewhdfqwfwofivojtsizn).
--
-- PURELY ADDITIVE — creates a new table, a new function, and seeds new
-- `resource:action` rows into role_permissions. Nothing in the app or in any
-- RLS policy references these yet, so applying this cannot change behavior.
-- The seed mirrors today's actual hardcoded role checks exactly.

-- ── permission_catalog: what permissions exist (drives the admin matrix UI) ──
create table if not exists permission_catalog (
  resource   text not null,
  action     text not null,
  label      text not null,
  group_name text not null,
  sort       int  not null default 0,
  primary key (resource, action)
);

alter table permission_catalog enable row level security;

drop policy if exists permission_catalog_select on permission_catalog;
create policy permission_catalog_select on permission_catalog
  for select to authenticated using (true);

drop policy if exists permission_catalog_write_admin on permission_catalog;
create policy permission_catalog_write_admin on permission_catalog
  for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'::user_role))
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'::user_role));

-- ── has_perm(): SQL-side permission check for future RLS policies (Phase 3) ──
-- Fail-closed: no session / no profile / no row → false. Admin always true.
-- In policies always call as (select has_perm('...')) so it runs as an
-- InitPlan (once per query), not per row.
create or replace function has_perm(perm_key text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select p.role = 'admin'::user_role
            or exists (
              select 1 from role_permissions rp
              where rp.role = p.role
                and rp.permission_key = perm_key
                and rp.allowed
            )
     from profiles p
     where p.id = auth.uid()),
    false
  );
$$;

grant execute on function has_perm(text) to authenticated;

-- ── Seed catalog + role_permissions. allowed = today's hardcoded behavior. ──
-- a=admin m=manager s=supervisor l=leader q=qa d=document_control p=display
with cat(resource, action, label, group_name, sort, allowed_roles) as (
  values
  -- ฝ่ายผลิต
  ('checkin',      'record',            'บันทึกเช็คชื่อ & PPE',                 'ฝ่ายผลิต', 10, array['admin','manager','supervisor','leader','qa','document_control','display']),
  ('daily_report', 'open_shift',        'เปิดกะผลิต',                          'ฝ่ายผลิต', 20, array['admin','manager','supervisor','leader']),
  ('daily_report', 'record',            'สแกน Order / งานเสีย / Downtime',      'ฝ่ายผลิต', 21, array['admin','manager','supervisor','leader']),
  ('daily_report', 'request_close',     'ขอปิดกะ',                             'ฝ่ายผลิต', 22, array['admin','manager','supervisor','leader']),
  ('daily_report', 'close_shift',       'ปิดกะ (โดยตรง)',                      'ฝ่ายผลิต', 23, array['admin','manager','supervisor']),
  ('daily_report', 'approve_close',     'อนุมัติคำขอปิดกะ',                    'ฝ่ายผลิต', 24, array['admin','manager','supervisor']),
  ('daily_report', 'delete_session',    'ลบกะในประวัติ',                       'ฝ่ายผลิต', 25, array['admin']),
  ('daily_report', 'setup',             'ตั้งค่า Downtime/งานเสีย/พัก',         'ฝ่ายผลิต', 26, array['admin','manager','supervisor']),
  -- รายงาน / คุณภาพ
  ('four_m',       'approve_sv',        '4M: อนุมัติขั้น Supervisor',           'รายงาน/คุณภาพ', 30, array['admin','manager','supervisor','leader']),
  ('four_m',       'approve_qa',        '4M: อนุมัติขั้น QA',                   'รายงาน/คุณภาพ', 31, array['admin','manager','qa']),
  ('four_m',       'reset',             '4M: Reset สถานะ',                     'รายงาน/คุณภาพ', 32, array['admin','manager']),
  ('four_m',       'manage_docs',       '4M: จัดการเอกสาร Changing Point',      'รายงาน/คุณภาพ', 33, array['admin','manager']),
  ('event_log',    'create',            'CQI-15: บันทึก Event',                'รายงาน/คุณภาพ', 40, array['admin','manager','supervisor','leader','qa']),
  ('event_log',    'approve_o',         'CQI-15: อนุมัติ role O',              'รายงาน/คุณภาพ', 41, array['admin','manager','supervisor','leader']),
  ('event_log',    'approve_qt',        'CQI-15: อนุมัติ role QT',             'รายงาน/คุณภาพ', 42, array['admin','manager','qa']),
  ('event_log',    'approve_jme',       'CQI-15: อนุมัติ role JME',            'รายงาน/คุณภาพ', 43, array['admin','manager','supervisor']),
  ('event_log',    'approve_me',        'CQI-15: อนุมัติ role ME',             'รายงาน/คุณภาพ', 44, array['admin','manager']),
  ('event_log',    'delete',            'CQI-15: ลบ Event',                    'รายงาน/คุณภาพ', 45, array['admin']),
  ('report',       'export',            'Export รายงาน (PDF/CSV)',             'รายงาน/คุณภาพ', 50, array['admin','manager','supervisor','leader','qa','document_control','display']),
  -- Logistic - Store
  ('line_stock',   'issue',             'จ่าย/คืน/ปรับยอด Stock',              'Logistic - Store', 60, array['admin','manager','supervisor','leader']),
  ('line_stock',   'manage_rounds',     'จัดการรอบจัดส่ง Kanban',              'Logistic - Store', 61, array['admin','manager','supervisor']),
  ('heijunka',     'operate',           'กดสถานะบอร์ด Kanban (ส่ง/รับ/ผลิต)',   'Logistic - Store', 62, array['admin','manager','supervisor','leader','qa','document_control','display']),
  ('rack_center',  'operate',           'เรียก/เตรียม/ส่ง/รับภาชนะ',            'Logistic - Store', 63, array['admin','manager','supervisor','leader','qa','document_control','display']),
  -- ตั้งค่าโปรแกรม, ฐานข้อมูล
  ('products',     'create',            'Product: เพิ่มสินค้า/พาร์ท',           'ตั้งค่าโปรแกรม,ฐานข้อมูล', 70, array['admin','manager','supervisor']),
  ('products',     'edit',              'Product: แก้ไข / EC / Import',        'ตั้งค่าโปรแกรม,ฐานข้อมูล', 71, array['admin','manager','supervisor']),
  ('products',     'delete',            'Product: ลบ',                         'ตั้งค่าโปรแกรม,ฐานข้อมูล', 72, array['admin','manager','supervisor']),
  ('machines',     'create',            'เครื่องจักร: เพิ่ม',                   'ตั้งค่าโปรแกรม,ฐานข้อมูล', 73, array['admin','manager','supervisor']),
  ('machines',     'edit',              'เครื่องจักร: แก้ไข/จัดการประเภท',      'ตั้งค่าโปรแกรม,ฐานข้อมูล', 74, array['admin','manager','supervisor']),
  ('machines',     'delete',            'เครื่องจักร: ลบ',                      'ตั้งค่าโปรแกรม,ฐานข้อมูล', 75, array['admin','manager','supervisor']),
  ('employees',    'register',          'พนักงาน: ลงทะเบียนใหม่',              'ตั้งค่าโปรแกรม,ฐานข้อมูล', 76, array['admin','manager','supervisor']),
  ('employees',    'edit',              'พนักงาน: แก้ไขข้อมูล/สกิล',            'ตั้งค่าโปรแกรม,ฐานข้อมูล', 77, array['admin','manager','supervisor','leader']),
  ('employees',    'deactivate',        'พนักงาน: ปิด/เปิดใช้งาน',              'ตั้งค่าโปรแกรม,ฐานข้อมูล', 78, array['admin','manager','supervisor','leader']),
  ('skills',       'edit',              'สกิล: เพิ่ม/แก้นิยามสกิล',             'ตั้งค่าโปรแกรม,ฐานข้อมูล', 80, array['admin','manager','supervisor']),
  ('skills',       'delete',            'สกิล: ลบนิยามสกิล',                   'ตั้งค่าโปรแกรม,ฐานข้อมูล', 81, array['admin','manager']),
  ('skills',       'approve_levelup',   'สกิล: อนุมัติ Level Up (25-75)',       'ตั้งค่าโปรแกรม,ฐานข้อมูล', 82, array['admin','manager','supervisor']),
  ('skills',       'approve_levelup_100','สกิล: อนุมัติ Level 100',             'ตั้งค่าโปรแกรม,ฐานข้อมูล', 83, array['admin','manager']),
  ('skills',       'run_weekly_update', 'สกิล: Run Weekly Update',             'ตั้งค่าโปรแกรม,ฐานข้อมูล', 84, array['admin','manager']),
  ('line_setup',   'edit',              'ผังไลน์: แก้ไขไลน์/จุดงาน/WIP',        'ตั้งค่าโปรแกรม,ฐานข้อมูล', 85, array['admin','manager','supervisor']),
  ('shift_schedule','edit',             'ตารางกะ: แก้กะ/override/ยุบกะ',        'ตั้งค่าโปรแกรม,ฐานข้อมูล', 86, array['admin','manager','supervisor']),
  ('company_calendar','edit',           'ปฏิทินบริษัท: แก้วันทำงาน/OT',         'ตั้งค่าโปรแกรม,ฐานข้อมูล', 87, array['admin','document_control']),
  ('org',          'manage',            'แผนผังองค์กร: จัดการ',                'ตั้งค่าโปรแกรม,ฐานข้อมูล', 88, array['admin']),
  ('users',        'manage',            'ผู้ใช้งานระบบ: สร้าง/แก้ไข',           'ตั้งค่าโปรแกรม,ฐานข้อมูล', 89, array['admin']),
  ('permissions',  'manage',            'จัดการสิทธิ์: แก้ไข',                  'ตั้งค่าโปรแกรม,ฐานข้อมูล', 90, array['admin']),
  -- ซ่อมบำรุง
  ('pm',           'setup',             'PM: ตั้งค่าอุปกรณ์/จุดตรวจ',           'การตรวจสอบและซ่อมบำรุง', 100, array['admin','manager','supervisor']),
  ('pm',           'record',            'PM: บันทึกผลตรวจ',                    'การตรวจสอบและซ่อมบำรุง', 101, array['admin','manager','supervisor','leader','qa','document_control','display']),
  ('pm',           'approve',           'PM: อนุมัติ/ตีกลับผลตรวจ',            'การตรวจสอบและซ่อมบำรุง', 102, array['admin','manager','supervisor','qa'])
),
ins_cat as (
  insert into permission_catalog (resource, action, label, group_name, sort)
  select resource, action, label, group_name, sort from cat
  on conflict (resource, action) do nothing
  returning 1
)
insert into role_permissions (role, permission_key, allowed)
select r.role,
       cat.resource || ':' || cat.action,
       (r.role::text = any(cat.allowed_roles))
from cat
cross join (select unnest(array['admin','manager','supervisor','leader','qa','document_control','display']::user_role[]) as role) r
on conflict (role, permission_key) do nothing;

-- ── Realtime: broadcast role_permissions changes so every open client can
--    refresh its permission cache immediately (App.jsx subscribes). ──
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'role_permissions'
  ) then
    alter publication supabase_realtime add table public.role_permissions;
  end if;
end $$;
