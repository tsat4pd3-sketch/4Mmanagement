-- ============================================================================
-- Transport carriers + vehicles + round assignment (Teiki-bin phase 1: ก)
-- ============================================================================
-- TARGET PROJECT: DR / "Product DB" (eyhclzkifitbhbljgoav) — supabaseDR client.
--
-- เฟส 1 ก้อน (ก) ของ Transport/AMR (ดู docs/TRANSPORT_AMR_DESIGN.md):
--   ชั้น carrier (คนขับ/ผู้ขน) + สกิลยานพาหนะ + มอบหมาย carrier ให้ "รอบส่ง" ที่มีอยู่
--   ต่อยอดบน kanban_delivery_rounds ไม่สร้างคิว/บอร์ดใหม่ ไม่คำนวณ demand ซ้ำ
--
-- RLS mirrors other DR tables (allow_all, public) — supabaseDR เป็น anon เสมอ.
-- additive ล้วน: ไม่มีตารางเดิมถูกแก้ · ยังไม่ apply = หน้า /transport เตือน + ทำงานไม่ได้
--   แต่ระบบเดิม (Kanban/Store/Rack) ไม่กระทบเลย
-- ============================================================================

-- master ยานพาหนะ (data-driven — เพิ่ม/แก้ได้ ไม่ล็อกในโค้ด)
create table if not exists public.transport_vehicles (
  code       text primary key,
  name       text not null,
  icon       text default '🚚',
  sort_order int  default 0,
  is_active  boolean default true,
  created_at timestamptz not null default now()
);

insert into public.transport_vehicles (code, name, icon, sort_order) values
  ('handlift', 'รถลากมือ (Hand pallet)',      '🛒', 1),
  ('tow',      'รถลากไฟฟ้า (Electric tow)',    '🚜', 2),
  ('forklift', 'โฟล์คลิฟท์ (Forklift)',        '🏗️', 3),
  ('cart',     'รถเข็น (Cart)',                 '🛒', 4),
  ('amr',      'AMR (รถขนอัตโนมัติ)',           '🤖', 5)
on conflict (code) do nothing;

-- carrier = คนขับ/ผู้ขน (1 คน = 1 กะ/หลายไลน์) · vehicles = สกิลยานพาหนะที่ขับได้
create table if not exists public.transport_carriers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  emp_code        text,                 -- รหัสพนักงาน (ผูก employees ภายหลัง — เฟส 1 free text)
  shift           text,                 -- 'day' | 'night' | 'both' | null
  vehicles        text[] not null default '{}',   -- codes จาก transport_vehicles
  section         text,                 -- scope ส่วนงาน (optional)
  is_active       boolean not null default true,
  note            text,
  updated_by_name text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- มอบหมาย carrier ให้ "รอบส่ง" รายวัน (1 รอบ/วัน = 1 carrier)
create table if not exists public.transport_round_assignments (
  id              uuid primary key default gen_random_uuid(),
  work_date       date not null,
  round_id        uuid not null references public.kanban_delivery_rounds(id) on delete cascade,
  carrier_id      uuid references public.transport_carriers(id) on delete set null,
  assigned_by     text,
  assigned_at     timestamptz not null default now(),
  updated_by_name text,
  unique (work_date, round_id)
);

create index if not exists idx_transport_carriers_active on public.transport_carriers(is_active);
create index if not exists idx_transport_round_assign_date on public.transport_round_assignments(work_date);

alter table public.transport_vehicles          enable row level security;
alter table public.transport_carriers          enable row level security;
alter table public.transport_round_assignments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['transport_vehicles','transport_carriers','transport_round_assignments'] loop
    if not exists (select 1 from pg_policies where schemaname='public'
                   and tablename=t and policyname='allow_all_'||t) then
      execute format('create policy %I on public.%I for all to public using (true) with check (true)',
                     'allow_all_'||t, t);
    end if;
  end loop;
end $$;
