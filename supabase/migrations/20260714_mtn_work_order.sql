-- MTN Work-Order (ใบแจ้งซ่อม MO) — clone ระบบ AppSheet เดิมมาอยู่ใน ESM (2026-07-14)
-- Project: DR (eyhclzkifitbhbljgoav) — อยู่กลุ่มเดียวกับ machines/jigs/PM · app คุยผ่าน supabaseDR (anon เสมอ)
--   → RLS ต้อง anon-open ทุกตาราง (ตามกฎเหล็ก CLAUDE.md — ห้ามตั้ง TO authenticated ฝั่ง DR)
-- Workflow 7 ขั้น: 1 แจ้งซ่อม → 2 รับ/จ่ายงาน(ออกเลข MO) → 3 ซ่อม → 4 ตรวจหลังซ่อม
--                  → 5 คุณภาพ(เฉพาะงานเกี่ยวคุณภาพ) → 6 รับมอบ/ติดตาม → 7 อนุมัติปิด (Close MO)

-- ── Master: ช่าง ────────────────────────────────────────────
create table if not exists public.mtn_technicians (
  id uuid primary key default gen_random_uuid(),
  name       text not null,
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ── Master: อะไหล่ + สต็อก ──────────────────────────────────
create table if not exists public.mtn_spare_parts (
  id uuid primary key default gen_random_uuid(),
  code       text,
  name       text not null,
  unit       text default 'ชิ้น',
  stock_qty  numeric not null default 0,
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ── Master: taxonomy ลักษณะปัญหา → รายละเอียด (cascade) ──────
create table if not exists public.mtn_problem_types (
  id uuid primary key default gen_random_uuid(),
  characteristic text not null,        -- ลักษณะปัญหา (เช่น "เซนเซอร์ ชำรุด")
  detail         text,                 -- รายละเอียด (เช่น "(Sensor-Proximity,...)")
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ── Master: ประเภทงานซ่อม (+ prefix เลข MO) ─────────────────
create table if not exists public.mtn_repair_types (
  id uuid primary key default gen_random_uuid(),
  name       text not null,            -- Breakdown Maintenance ฯลฯ
  prefix     text not null,            -- BM/IM/RE/CM/PM/AM
  is_active  boolean not null default true,
  sort_order int not null default 0
);

-- ── Master: ชนิดอุปกรณ์ (ชื่อรายการ) ────────────────────────
create table if not exists public.mtn_item_types (
  id uuid primary key default gen_random_uuid(),
  name       text not null,            -- JIG / ROBOT HANDLING / CONVEYOR ฯลฯ
  is_active  boolean not null default true,
  sort_order int not null default 0
);

-- ── ใบแจ้งซ่อม MO (แถวเดียวต่อใบ เก็บครบ 7 ขั้น) ────────────
create table if not exists public.mtn_orders (
  id uuid primary key default gen_random_uuid(),
  mo_no      text,                     -- เลข MO auto (ออกตอน step2) เช่น BM-301025-01
  mo_seq     int,                      -- ลำดับที่รายวัน
  status     text not null default 'pending',
    -- pending → assigned → repairing → checked → qa → handover → closed · rejected
  current_step int not null default 1, -- ขั้นสูงสุดที่ทำเสร็จ (1..7) ใช้คิด % ความคืบหน้า

  -- Step 1: แจ้งซ่อม
  report_at    timestamptz not null default now(),
  work_date    date,                   -- getWorkDate ตอนแจ้ง (ตัด 08:00)
  repair_scope text,                   -- in_line | off_line (ซ่อมในไลน์/นอกไลน์)
  want_at      timestamptz,            -- วันที่ต้องการ
  dept_section text,                   -- แผนก (PD1..PD4)
  work_area    text,                   -- ส่วนงาน (ASSY2/HDF ฯลฯ)
  line_name    text,                   -- ไลน์การผลิต (→ production_lines.name)
  item_type    text,                   -- ชนิดอุปกรณ์
  machine_no   text,                   -- หมายเลขเครื่อง (→ machines.machine_no)
  cost_center  text,
  model        text,
  customer     text,
  code         text,
  before_img   text,                   -- รูปก่อนซ่อม (url)
  problem_characteristic text,
  problem_detail         text,
  report_note  text,                   -- ระบุรายละเอียด (free)
  is_sample    boolean default false,  -- งานตัวอย่าง
  reporter_prod text,                  -- ผลิตผู้แจ้ง
  reporter_qa   text,                  -- คุณภาพผู้แจ้ง
  reported_by_name text,
  reported_by_uid  text,
  source_downtime_id uuid,             -- ถ้าเกิดจากปุ่ม "เรียกช่าง" ใน Daily Report

  -- Step 2: รับ/จ่ายงาน (ออกเลข MO)
  accept_at    timestamptz,
  accepted_by  text,                   -- ผู้รับปัญหางาน
  repair_type  text,                   -- Breakdown Maintenance ฯลฯ
  assign_note  text,
  target_done_at timestamptz,          -- วันที่ต้องการให้เสร็จ
  assigned_to  text,                   -- มอบหมายช่าง
  reject_reason text,                  -- ถ้า repair_type = Reject MO

  -- Step 3: ดำเนินการซ่อม
  repair_done_at timestamptz,
  after_img    text,                   -- รูปหลังซ่อม
  root_cause   text,
  solution     text,
  tech_main    text,                   -- ช่างซ่อมหลัก
  tech_secondary text,                 -- ช่างซ่อมรอง

  -- Step 4: ตรวจสอบหลังซ่อม
  check_at     timestamptz,
  check_result text,                   -- ตรวจสอบผ่าน/ไม่ผ่าน
  check_note   text,
  quality_related text,                -- เกี่ยวกับคุณภาพ/ไม่เกี่ยวกับคุณภาพ
  checker_name text,
  checker_sign text,                   -- ลายเซ็น (url)

  -- Step 5: คุณภาพหลังซ่อม (เฉพาะงานเกี่ยวคุณภาพ)
  qa_at        timestamptz,
  qa_img       text,
  qa_result    text,                   -- ผ่านคุณภาพ/ไม่ผ่าน
  qa_note      text,
  qa_checker   text,
  qa_sign      text,

  -- Step 6: รับมอบหลังซ่อม/ติดตาม
  ho_at        timestamptz,
  follow_up    text,                   -- ไม่เกิดปัญหาซ้ำ/แจ้งเฝ้าระวัง/เกิดปัญหาซ้ำ/แก้ไขไม่ได้
  ho_reporter  text,
  ho_checker   text,
  ho_sign      text,

  -- Step 7: อนุมัติปิด
  approve_at   timestamptz,
  approver_name text,
  approve_sign text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_mtn_orders_status on public.mtn_orders(status);
create index if not exists idx_mtn_orders_line   on public.mtn_orders(line_name);
create index if not exists idx_mtn_orders_workdate on public.mtn_orders(work_date);

-- ── Log การเบิกอะไหล่ต่อใบ ──────────────────────────────────
create table if not exists public.mtn_order_parts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.mtn_orders(id) on delete cascade,
  part_id  uuid references public.mtn_spare_parts(id),
  part_name text,                      -- snapshot ชื่ออะไหล่ (เผื่อ master ถูกลบ)
  qty      numeric not null default 1,
  unit     text,
  tech     text,                       -- ช่างที่เบิก
  logged_at timestamptz not null default now(),
  logged_by text
);
create index if not exists idx_mtn_order_parts_order on public.mtn_order_parts(order_id);

-- ── เลข MO auto (ลำดับรายวัน · atomic กันชนกัน) ──────────────
create table if not exists public.mtn_mo_counter (
  ymd      text primary key,           -- DDMMYY (เวลาไทย)
  last_seq int not null default 0
);

create or replace function public.mtn_assign_mo_no(p_order_id uuid, p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_ymd text; v_seq int; v_no text; v_existing text;
begin
  select mo_no, to_char(coalesce(report_at, now()) at time zone 'Asia/Bangkok', 'DDMMYY')
    into v_existing, v_ymd
  from public.mtn_orders where id = p_order_id;
  if v_existing is not null and v_existing <> '' then
    return v_existing;                 -- idempotent — ออกเลขครั้งเดียวต่อใบ
  end if;
  insert into public.mtn_mo_counter(ymd, last_seq) values (v_ymd, 1)
    on conflict (ymd) do update set last_seq = public.mtn_mo_counter.last_seq + 1
    returning last_seq into v_seq;
  v_no := p_prefix || '-' || v_ymd || '-' || lpad(v_seq::text, 2, '0');
  update public.mtn_orders set mo_no = v_no, mo_seq = v_seq, updated_at = now() where id = p_order_id;
  return v_no;
end $$;
grant execute on function public.mtn_assign_mo_no(uuid, text) to anon, authenticated;

-- ── RLS: anon-open ทุกตาราง (ตามกฎ DR project) ──────────────
do $$
declare t text;
begin
  foreach t in array array['mtn_technicians','mtn_spare_parts','mtn_problem_types',
                           'mtn_repair_types','mtn_item_types','mtn_orders','mtn_order_parts','mtn_mo_counter']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_all', t);
    execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true)', t||'_all', t);
  end loop;
end $$;

-- ── Seed master ─────────────────────────────────────────────
insert into public.mtn_repair_types(name, prefix, sort_order) values
  ('Breakdown Maintenance','BM',1),('Improvement Maintenance','IM',2),
  ('Corrective Maintenance','CM',3),('Preventive Maintenance','PM',4),
  ('Autonomous Maintenance','AM',5),('Reject MO','RE',9)
on conflict do nothing;

insert into public.mtn_item_types(name, sort_order) values
  ('JIG',1),('ROBOT HANDLING',2),('ROBOT SPOT WELD',3),('ROBOT ARC WELD',4),
  ('STATIONARY',5),('CONVEYOR',6),('NUT FEEDER',7)
on conflict do nothing;

insert into public.mtn_problem_types(characteristic, detail, sort_order) values
  ('ปรับจิ๊กฟิกเจอร์','(Ajust Jig Fixture-DataOutSpec)',1),
  ('เซนเซอร์ ชำรุด','(Sensor-Proximity,ReedSwitch,PhotoSensor,LaserSensor,RetroReflex)',2),
  ('กระบอกลม ชำรุด','(Cylinder-แกนงอ,คด,ลมรั่ว)',3),
  ('โลเคเตอร์ ชำรุด','(Locator-Gripper,JIG fixture)',4),
  ('แคลมป์ ชำรุด','(Clamp-Gripper,JIG fixture)',5),
  ('ลมรั่ว','(Air Leak-fitting,สายลม,SolenoidValve,Regulator)',6),
  ('ระบบไฟฟ้า ชำรุด','(Electric System-สายสัญญาณ,สายไฟ,อุปกรณ์ไฟฟ้า,Gripper,JigFixture,PLCBox)',7),
  ('สต็อปเปอร์ ชำรุด','(Stopper-Gripper,JIG fixture)',8),
  ('นัทฟีดเดอร์ ชำรุด','(NutFeederDamage)',9),
  ('เครื่องมาร์ค ชำรุด','(Marking-Alarm,Damage)',10),
  ('ปรับ Poka-yoke','(Adjust Pokayoke-Sensor ไม่สามารถตรวจจับความผิดปกติของชิ้นงานได้)',11),
  ('พาเลท ชำรุด','(Pallet ชำรุด)',12),
  ('ดาตั้มซัพพอร์ต ชำรุด','(Datum or Support-Gripper,JIG fixture)',13),
  ('โซลินอยด์วาวล์ ชำรุด','(SolenoidValve-Gripper,JIG fixture)',14),
  ('ปรับโรบอทเชื่อมจุด','(Robot Spot Weld-ปัญหาคุณภาพ)',15),
  ('ปรับโรบอทแฮนเดอร์ริ่ง','(Robot Handling-ปัญหาคุณภาพ)',16),
  ('ปรับโรบอทเชื่อมแก๊ส','(Robot Arc Weld-ปัญหาคุณภาพ)',17),
  ('แก้ไขโรบอทอะลาร์ม','(Robot Alarm-เบื้องต้น)',18),
  ('นัทหรือโบลท์ ชำรุด','(Nut or Bolt-Gripper,JIG fixture)',19),
  ('อื่นๆ','อื่นๆ',99)
on conflict do nothing;

insert into public.mtn_technicians(name, sort_order) values
  ('นายอภิเดช  กะจันต๊ะ',1),('นายสหพลล์  แสงชา',2),('นายวัชระ  ใจนิ่ม',3),
  ('นายณรงค์ศักดิ์  วงศ์เสนา',4),('นายณัฐภัทร  ถานันต๊ะ',5),('นายพิศาล  พลเสนา',6),
  ('นายวุฒิชัย  คงทน',7),('นายไพรัชช์  ยืนยง',8)
on conflict do nothing;

-- ── Storage: bucket รูป MO + ลายเซ็น (anon-open ตาม DR) ──────
insert into storage.buckets(id, name, public, file_size_limit)
  values ('mtn-images','mtn-images', true, 5242880)
on conflict (id) do update set public = true, file_size_limit = 5242880;

drop policy if exists mtn_images_read   on storage.objects;
drop policy if exists mtn_images_insert on storage.objects;
drop policy if exists mtn_images_update on storage.objects;
drop policy if exists mtn_images_delete on storage.objects;
create policy mtn_images_read   on storage.objects for select to anon, authenticated using (bucket_id = 'mtn-images');
create policy mtn_images_insert on storage.objects for insert to anon, authenticated with check (bucket_id = 'mtn-images');
create policy mtn_images_update on storage.objects for update to anon, authenticated using (bucket_id = 'mtn-images') with check (bucket_id = 'mtn-images');
create policy mtn_images_delete on storage.objects for delete to anon, authenticated using (bucket_id = 'mtn-images');
