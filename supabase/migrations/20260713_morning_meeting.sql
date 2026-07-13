-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- ประชุมแถวเช้า (Morning Meeting) — หน้า /morning-meeting
-- 1) ตาราง meeting_action_items: action item จากที่ประชุม ติดตามข้ามวันจนปิดงาน
-- 2) สิทธิ์: page:/morning-meeting (ทุก role ดูได้) + morning_meeting:record (leader ขึ้นไป)
-- 3) notification_rules: event ใหม่ morning_meeting (ส่งสรุปประชุมเข้า Telegram)
-- ปลอดภัยต่อการรันซ้ำ (if not exists / on conflict do nothing)

-- ── 1) Action items ──────────────────────────────────────────────
create table if not exists meeting_action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_date date not null,            -- วันประชุม (= work_date ของวันที่สรุป)
  section text,                          -- section ของไลน์ (denormalized ไว้กรอง scope)
  line_name text,                        -- ไลน์ที่เกี่ยวข้อง (null = เรื่องรวมของ section)
  problem text not null,                 -- ปัญหา/สิ่งที่ต้องทำ
  root_cause text,                       -- สาเหตุ (ระบุในที่ประชุม)
  ref_kind text,                         -- อ้างอิงที่มาอัตโนมัติ: 'downtime' | 'defect' | '4m' | 'order_miss' | null
  ref_id text,                           -- id ของรายการต้นเรื่อง (uuid เป็น text — ข้าม project ได้)
  assignee text,                         -- ผู้รับผิดชอบ (ชื่อ free text)
  due_date date,                         -- กำหนดเสร็จ
  status text not null default 'open' check (status in ('open','doing','done','cancelled')),
  created_by uuid,                       -- profiles.id ผู้บันทึก
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);

create index if not exists idx_meeting_action_items_date   on meeting_action_items (meeting_date);
create index if not exists idx_meeting_action_items_status on meeting_action_items (status);

alter table meeting_action_items enable row level security;

-- อ่าน: ทุก user ที่ login (กรอง section scope ที่ client ตาม pattern ระบบ)
drop policy if exists meeting_action_items_select on meeting_action_items;
create policy meeting_action_items_select on meeting_action_items
  for select to authenticated using (true);

-- เขียน: user ที่ login (สิทธิ์ action คุมที่ client ผ่าน can('morning_meeting','record') —
-- Phase 3 ค่อยย้ายเป็น (select has_perm('morning_meeting:record')) ตาม docs/PERMISSIONS-DESIGN.md)
drop policy if exists meeting_action_items_write on meeting_action_items;
create policy meeting_action_items_write on meeting_action_items
  for all to authenticated using (true) with check (true);

-- ── 2) สิทธิ์ ────────────────────────────────────────────────────
-- หน้า: ทุก role ดูได้ (รวม display สำหรับจอ TV)
insert into role_permissions (role, permission_key, allowed)
select r.role, 'page:/morning-meeting', true
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do nothing;

-- action บันทึก action item / ส่งสรุป Telegram: leader ขึ้นไป
insert into permission_catalog (resource, action, label, group_name, sort)
values ('morning_meeting', 'record', 'บันทึก Action Item / ส่งสรุปประชุม', 'ประชุมแถวเช้า', 95)
on conflict (resource, action) do nothing;

insert into role_permissions (role, permission_key, allowed)
select r.role, 'morning_meeting:record',
       r.role in ('admin'::user_role, 'manager'::user_role, 'supervisor'::user_role, 'leader'::user_role)
from (select unnest(enum_range(null::user_role)) as role) r
on conflict (role, permission_key) do nothing;

-- ── 3) Notification rule ─────────────────────────────────────────
-- (กัน insert ซ้ำแบบไม่พึ่ง unique constraint — notification_rules ไม่มี PK บน event_key)
insert into notification_rules (event_key, label, category, is_enabled, sort_order)
select 'morning_meeting', 'สรุปประชุมแถวเช้า (Morning Meeting)', 'production', true, 45
where not exists (select 1 from notification_rules where event_key = 'morning_meeting');
