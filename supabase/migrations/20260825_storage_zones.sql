-- 🏬 STORAGE ZONES — WMS ย่อมๆ บนผังรวมโรงงาน (DR project · 2026-08-25 · คำสั่ง user)
--
-- โจทย์: พื้นที่ตรงกลางผังที่ไม่ใช่ไลน์ผลิต = คลังเก็บสินค้า (FG/WIP/พาร์ทย่อย/เลน OUT)
--   ระบบเดิมรู้สต็อกแค่ระดับ "location หยาบ" (FG WAREHOUSE / STORE ใน line_stock_summary)
--   → เพิ่มชั้น "โซนจัดเก็บ" : ตีกรอบบนผังรวม + ผูกว่า MAT ไหนเก็บโซนไหน + ความจุ (จำนวนภาชนะ)
--   ผังรวมคำนวณสถานะโซนสดจากสต็อกจริง (เต็ม/ใกล้เต็ม/ต่ำกว่า Min) — สูตรอยู่ src/utils/storageZones.js
--
-- ⚠️ เฟส 1 = "ทะเบียนโซน + การผูก MAT" เท่านั้น — **ไม่แตะ write-path ของ stock**
--   (line_stock_transactions ไม่รู้จักโซน · ยอดโซน = ยอด MAT ที่ผูกไว้ในคลังกลาง
--    ถ้า MAT เดียวถูกผูกหลายโซน ยอดจะโชว์ซ้ำ — หน้า /line-stock แท็บโซนมี worklist เตือน)
--
-- pattern เดียวกับ die_storage_areas: ชื่อโซนคือกุญแจจับคู่กรอบบนผังรวม
--   (factory_line_regions.line_name ฝั่ง Main — ข้าม project ทำ FK ไม่ได้ · จับคู่ trim+lowercase
--    เปลี่ยนชื่อโซนจากแท็บจัดการจะ cascade ชื่อกรอบให้ + เตือนเมื่อทำไม่สำเร็จ)
--
-- วิธี rollback: drop table storage_zones; (โค้ดอ่านแบบ tolerant — ตารางหาย = ฟีเจอร์เงียบ ไม่พังหน้า)

-- ⚠️ ต้องมี updated_by_name เพราะอยู่ใน DR_AUDIT_TABLES (supabaseClient.js stamp ให้อัตโนมัติ)
create table if not exists storage_zones (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  kind            text not null default 'fg',   -- key: fg/wip/sub/raw/out/other — ชื่อ/ไอคอน source of truth src/utils/storageZones.js (ไม่ใส่ check constraint — เพิ่ม kind ใหม่ในโค้ดได้ไม่ต้อง migration · key แปลกโชว์ดิบ ไม่หายเงียบ)
  capacity_pkg    int,                          -- ความจุ (จำนวนภาชนะ/กล่อง) — null = ไม่รู้ ห้ามเดา (fill% จะเป็น "ไม่รู้" ไม่ใช่ 0)
  mat_nos         text[] not null default '{}', -- MAT ที่กำหนดให้เก็บโซนนี้ (fixed location ตามหน้างานจริง)
  note            text,
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by_name text
);
comment on table storage_zones is
  'โซนจัดเก็บในคลัง (WMS เฟส 1) — ตีกรอบบนผังรวมด้วยชื่อเดียวกัน (factory_line_regions ฝั่ง Main) · ยอด = สต็อก MAT ที่ผูกไว้จาก line_stock_summary คลังกลาง (FG WAREHOUSE/STORE)';
comment on column storage_zones.capacity_pkg is
  'ความจุโดยประมาณเป็นจำนวนภาชนะ — เทียบกับ Σ⌈qty÷ขนาดกล่อง⌉ ของ MAT ที่ผูก · null = ยังไม่กรอก (จอแสดง "ไม่รู้" ห้ามตีเป็น 0)';

alter table storage_zones enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='storage_zones' and policyname='storage_zones_all') then
    create policy storage_zones_all on storage_zones for all using (true) with check (true);
  end if;
end $$;

-- audit + updated_at (guard แบบเดียวกับ die_storage_areas — DR project บางอันอาจยังไม่มีฟังก์ชัน)
do $$ begin
  if exists (select 1 from pg_proc where proname='fn_set_updated_at') then
    drop trigger if exists trg_storage_zones_updated on storage_zones;
    create trigger trg_storage_zones_updated before update on storage_zones
      for each row execute function fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname='fn_audit') then
    drop trigger if exists trg_storage_zones_audit on storage_zones;
    create trigger trg_storage_zones_audit after insert or update or delete on storage_zones
      for each row execute function fn_audit();
  end if;
end $$;

-- ตรวจหลังรัน:
-- select count(*) from storage_zones;                          -- ควรได้ 0 (ยังไม่ seed — โซนเป็นความรู้หน้างาน ห้ามเดาให้)
-- select policyname from pg_policies where tablename='storage_zones';
