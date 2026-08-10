-- ตำแหน่งงานเป็น master ที่มี "ระดับงาน" (level) — Main project (2026-08-06)
--
-- ปัญหา: `employees.position` / `profiles.position` เป็น free text ปนไทย-อังกฤษ
--   Operator 195 + พนักงานฝ่ายผลิต 6 = อันเดียวกัน · Technician 17 + ช่างเทคนิค 6 · Engineer 1 + วิศวกร 5
--   → เอาไปตัดสินใจอะไรไม่ได้เลย และเป็นสาเหตุที่ระบบ "แยก AM (พนักงานหน้างาน) กับ PM (ช่าง) ไม่ได้"
--   ข้อมูลจริงวันนี้: ธุรการที่ role=mtn ได้ pm:approve เต็ม เพราะไม่มีแกน "ระดับงาน" ให้แยก
--
-- หลักที่ยึด (เหมือน team / role / process_type ทั้งระบบ): **เก็บรหัส แสดงชื่อ**
--   ชื่อตำแหน่งเปลี่ยนได้/มีหลายภาษา — ถ้าเก็บชื่อ ข้อมูลเก่ากำพร้าทันที
--
-- แบ่ง 2 ชั้นโดยตั้งใจ:
--   positions (ตารางนี้)  = "ชื่อตำแหน่ง" — ข้อมูล เปลี่ยนบ่อย ต่างกันได้ทุกโรงงานตอน rollout
--   POSITION_LEVELS (โค้ด) = "ระดับงาน" — แนวคิด TPM ที่นิ่ง (operator/technician/engineer/…)
--   เพิ่มตำแหน่งใหม่ = เพิ่มแถวที่นี่ + ชี้ไป level เดิม · ไม่ต้องแตะโค้ด

create table if not exists positions (
  key        text primary key,
  label_th   text not null,
  label_en   text,
  level      text not null,          -- ตรงกับ POSITION_LEVELS ใน src/utils/positions.js
  sort_order int  not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table positions is
  'master ตำแหน่งงาน — employees.position / profiles.position เก็บ "key" ของตารางนี้ (แสดงผลผ่าน positionLabel())';
comment on column positions.level is
  'ระดับงาน: operator/staff/technician/engineer/leader/supervisor/manager — ใช้ตัดสินว่าใครทำ AM ใครทำ PM';

alter table positions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='positions' and policyname='positions_read') then
    create policy positions_read on positions for select to authenticated using (true);
  end if;
  -- แก้ master ตำแหน่งเป็นงานตั้งค่าระบบ — จำกัดที่ admin ไปก่อน (ยังไม่มีหน้า UI แก้)
  if not exists (select 1 from pg_policies where tablename='positions' and policyname='positions_write_admin') then
    create policy positions_write_admin on positions for all to authenticated
      using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
      with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
  end if;
end $$;

insert into positions (key, label_th, label_en, level, sort_order) values
  ('operator',     'พนักงานฝ่ายผลิต', 'Operator',          'operator',   10),
  ('technician',   'ช่างเทคนิค',      'Technician',        'technician', 20),
  ('engineer',     'วิศวกร',          'Engineer',          'engineer',   30),
  ('qc',           'QC',              'QC Inspector',      'technician', 35),
  ('line_leader',  'หัวหน้าไลน์',     'Line Leader',       'leader',     40),
  ('dept_head',    'หัวหน้าแผนก',     'Department Head',   'supervisor', 50),
  ('section_head', 'หัวหน้าส่วน',     'Section Head',      'supervisor', 60),
  ('manager',      'ผู้จัดการฝ่าย',   'Division Manager',  'manager',    70),
  ('officer',      'เจ้าหน้าที่',     'Officer',           'staff',      80),
  ('clerk',        'ธุรการ',          'Admin Clerk',       'staff',      85),
  ('secretary',    'เลขา',            'Secretary',         'staff',      90)
on conflict (key) do update
  set label_th = excluded.label_th, label_en = excluded.label_en,
      level = excluded.level, sort_order = excluded.sort_order;

-- ── normalize ข้อมูลเดิม (ไทย/อังกฤษ/ตัวพิมพ์ต่างกัน) → key ─────────────────
-- idempotent: แปลงเฉพาะแถวที่ยังไม่ใช่ key · ค่าที่ไม่รู้จัก **คงไว้ ไม่ทิ้งเงียบ**
create or replace view _pos_map(alias_low, key) as
select * from (values
  ('operator','operator'), ('พนักงานฝ่ายผลิต','operator'), ('พนักงานผลิต','operator'),
  ('technician','technician'), ('ช่างเทคนิค','technician'), ('ช่าง','technician'),
  ('engineer','engineer'), ('วิศวกร','engineer'),
  ('qc','qc'),
  ('leader','line_leader'), ('หัวหน้าไลน์','line_leader'), ('line leader','line_leader'),
  ('หัวหน้าแผนก','dept_head'), ('department head','dept_head'),
  ('หัวหน้าส่วน','section_head'), ('section head','section_head'),
  ('manager','manager'), ('ผู้จัดการฝ่าย','manager'), ('ผู้จัดการ','manager'),
  ('เจ้าหน้าที่','officer'), ('officer','officer'),
  ('ธุรการ','clerk'), ('admin clerk','clerk'),
  ('เลขา','secretary'), ('secretary','secretary')
) v(alias_low, key);

update employees e set position = m.key
from _pos_map m
where e.position is not null and lower(trim(e.position)) = m.alias_low and e.position <> m.key;

update profiles p set position = m.key
from _pos_map m
where p.position is not null and lower(trim(p.position)) = m.alias_low and p.position <> m.key;

drop view _pos_map;

-- ตรวจหลังรัน (ควรเห็นเฉพาะ key + ค่าแปลกที่ยังไม่ได้ map):
--   select position, count(*) from employees where position is not null group by position order by 2 desc;
--   select position, count(*) from profiles  where position is not null group by position order by 2 desc;
