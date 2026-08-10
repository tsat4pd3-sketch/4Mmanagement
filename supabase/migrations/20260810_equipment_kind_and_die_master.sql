-- แกน "ชนิดอุปกรณ์" + ทะเบียนแม่พิมพ์ — DR project (2026-08-10)
--
-- ⚠️ ทำไมไม่แยกเป็น 3 ตาราง (machines / jigs / dies) ตามที่ user ถาม
--   `machines` เป็น "ตารางตัวตนของอุปกรณ์" อยู่แล้ว — machine_no unique · MO / downtime /
--   prod_orders / QR / ผังเครื่องจักร / supply route อ้างด้วยเลขนี้รวม 12+ ตาราง
--   แยกเป็นหลายตาราง = ทุกตารางที่อ้างอุปกรณ์ต้องกลายเป็น polymorphic (kind + id)
--   + QR ต้องเพิ่ม prefix ต่อชนิด + ทำลายหัวใจของระบบซ่อมบำรุงรวมคือ
--   "เปิดอุปกรณ์ตัวนี้ เห็นประวัติทั้งหมดในที่เดียว"
--   → ใช้โมเดลเดียวกับ SAP PM / Maximo: **1 ตัวตน + แกนชนิด + ตารางส่วนขยายต่อชนิด**
--     รายละเอียดเชิงลึกของแม่พิมพ์อยู่ `equipment_die` (1:1 กับ machines)
--     ชนิดอื่นที่ต้องการรายละเอียดเฉพาะ ให้เพิ่มตารางส่วนขยายแบบเดียวกัน
--   **แยก "หน้าจอ" ได้เต็มที่ — แยกหน้าจอ ≠ แยกฐานข้อมูล**
--
-- ⚠️ `equipment_kind` คนละแกนกับ `equipment_category` (production/facility = ที่ตั้ง/การใช้งาน)
--    เครื่องจักรอยู่ facility ได้ · แม่พิมพ์อยู่ production — สองแกนตัดกัน ห้ามยุบรวม

-- ── 1) แกนชนิดอุปกรณ์ ────────────────────────────────────────────────────
alter table machines add column if not exists equipment_kind text;
comment on column machines.equipment_kind is
  'ชนิดอุปกรณ์: machine/die/jig/facility — null = machine (backward-compatible) · คนละแกนกับ equipment_category';
create index if not exists machines_kind_idx on machines (equipment_kind);

-- ── 2) master ประเภทกระบวนการของแม่พิมพ์ (data-driven เพิ่มเองได้) ─────────
-- ⚠️ ต้องมี updated_by_name เพราะอยู่ใน DR_AUDIT_TABLES (supabaseClient.js stamp ให้อัตโนมัติ)
--    ตารางที่อยู่ในลิสต์นั้นแต่ไม่มีคอลัมน์นี้ = write พังทันที
create table if not exists die_op_types (
  key             text primary key,
  label           text not null,
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  updated_at      timestamptz not null default now(),
  updated_by_name text
);
alter table die_op_types enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='die_op_types' and policyname='die_op_types_all') then
    create policy die_op_types_all on die_op_types for all using (true) with check (true);
  end if;
end $$;

insert into die_op_types (key, label, sort_order) values
  ('blank','Blank (ตัดแผ่น)',10),      ('draw','Draw (ขึ้นรูปลึก)',20),
  ('form','Form (ขึ้นรูป)',30),        ('bend','Bend (ดัด)',40),
  ('trim','Trim (ตัดขอบ)',50),         ('pierce','Pierce (เจาะ)',60),
  ('cam','Cam (เจาะ/ตัดด้านข้าง)',70), ('flange','Flange (พับขอบ)',80),
  ('restrike','Restrike (ปั๊มซ้ำ)',90),('hem','Hem (พับตะเข็บ)',100),
  ('emboss','Emboss (ปั๊มนูน)',110),   ('separate','Separate (แยกชิ้น)',120),
  ('other','อื่นๆ',999)
on conflict (key) do update set label=excluded.label, sort_order=excluded.sort_order;

-- ── 3) ชุดแม่พิมพ์ (die set) — 1 พาร์ท 1 ชุด · หลาย OP ────────────────────
--   tandem      = หลายแม่พิมพ์ เรียง OP10/20/30/40 คนละเครื่องปั๊ม  ← "1/4 2/4 3/4 4/4"
--   progressive = บล็อกเดียว หลาย station ป้อนม้วนเหล็ก 1 stroke ทำทุก station
--   transfer    = เครื่องเดียว หลาย station มีแขนย้ายชิ้น · single = OP เดียวจบ
create table if not exists die_sets (
  id                uuid primary key default gen_random_uuid(),
  set_code          text unique,
  part_no           text,
  part_name         text,
  model             text,
  line_name         text,
  kind              text not null default 'tandem',
  op_total          int,
  pieces_per_stroke int not null default 1,   -- 1 stroke ได้กี่ชิ้น (งานคู่ LH/RH = 2)
  note              text,
  mat_no            text,                    -- โยงพาร์ทใน Product Master (เบอร์ 100/200)
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by_name   text,
  constraint die_sets_kind_chk check (kind in ('tandem','progressive','transfer','single'))
);
create index if not exists die_sets_mat_idx on die_sets (mat_no);
comment on column die_sets.mat_no is
  'เลข MAT SAP ของพาร์ทที่ชุดนี้ปั๊มออกมา — เบอร์ 200 (child ส่งกระบวนการถัดไป) และ 100 (FG ขายลูกค้า) ผูกเหมือนกัน';
comment on column die_sets.pieces_per_stroke is
  '1 stroke ได้กี่ชิ้น — งานคู่ LH/RH = 2 · ใช้แปลง shot ↔ จำนวนชิ้นตอนนับอายุแม่พิมพ์';

alter table die_sets enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='die_sets' and policyname='die_sets_all') then
    create policy die_sets_all on die_sets for all using (true) with check (true);
  end if;
end $$;

-- ── 4) ส่วนขยาย "แม่พิมพ์" ของอุปกรณ์ (1:1 กับ machines) ──────────────────
create table if not exists equipment_die (
  machine_id        uuid primary key references machines(id) on delete cascade,
  die_set_id        uuid references die_sets(id) on delete set null,
  op_seq            int,                       -- เลข OP (10/20/30/40) ตามที่โรงงานเรียก
  op_name           text,
  op_type           text references die_op_types(key),
  tonnage_ton       numeric,
  pieces_per_stroke int,                       -- null = ใช้ค่าของชุด
  shot_total        bigint not null default 0,
  regrind_count     int not null default 0,
  regrind_limit     int,
  note              text,
  updated_at        timestamptz not null default now(),
  updated_by_name   text
);
create index if not exists equipment_die_set_idx on equipment_die (die_set_id, op_seq);
comment on table equipment_die is
  'รายละเอียดเชิงลึกเฉพาะแม่พิมพ์ — ตัวตนยังอยู่ที่ machines (machine_no/ชื่อ/ไลน์) ห้ามซ้ำที่นี่';

alter table equipment_die enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='equipment_die' and policyname='equipment_die_all') then
    create policy equipment_die_all on equipment_die for all using (true) with check (true);
  end if;
end $$;

-- audit + updated_at (ถ้ามี trigger กลางอยู่แล้ว)
do $$ begin
  if exists (select 1 from pg_proc where proname='fn_set_updated_at') then
    drop trigger if exists trg_die_op_types_updated on die_op_types;
    create trigger trg_die_op_types_updated before update on die_op_types
      for each row execute function fn_set_updated_at();
    drop trigger if exists trg_die_sets_updated on die_sets;
    create trigger trg_die_sets_updated before update on die_sets
      for each row execute function fn_set_updated_at();
    drop trigger if exists trg_equipment_die_updated on equipment_die;
    create trigger trg_equipment_die_updated before update on equipment_die
      for each row execute function fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname='fn_audit') then
    drop trigger if exists trg_die_op_types_audit on die_op_types;
    create trigger trg_die_op_types_audit after insert or update or delete on die_op_types
      for each row execute function fn_audit();
    drop trigger if exists trg_die_sets_audit on die_sets;
    create trigger trg_die_sets_audit after insert or update or delete on die_sets
      for each row execute function fn_audit();
    drop trigger if exists trg_equipment_die_audit on equipment_die;
    create trigger trg_equipment_die_audit after insert or update or delete on equipment_die
      for each row execute function fn_audit();
  end if;
end $$;
