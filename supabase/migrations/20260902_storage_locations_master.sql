-- ═══ ทะเบียนรหัสคลัง (Storage Location / SAP Stor.Loc.) ═══════════════════════════
--
-- ที่มา (2026-09-02 · user กำหนดรูปแบบเอง):
--   "storage loc id จะเป็นตัวหนังสือและตามด้วย int 3 หลัก เช่น
--    s401 พื้นที่สโตร์เก็บชิ้นส่วน · P401 พื้นที่ผลิต1 · P402 ผลิต2 ·
--    W401 พื้นที่ warehouse · R401 พื้นที่สโตร์เหล็ก(raw material)"
--
-- ⇒ รูปแบบ = ตัวอักษร 1-3 ตัว + ตัวเลข 3 หลัก (uppercase) · ตัวอักษรนำหน้าบอกชนิดพื้นที่
--   S = สโตร์ชิ้นส่วน · P = พื้นที่ผลิต · W = warehouse (FG) · R = สโตร์วัตถุดิบ (เหล็ก/coil)
--
-- ⚠️⚠️ คนละตารางกับ `storage_zones` (WMS เฟส 1) **ห้ามยุบรวม**
--   storage_zones = โซนกองของที่ตีกรอบบนผังโรงงาน (มี capacity · ผูก mat แบบ array · มีรูปผัง)
--   storage_locations = **รหัสบัญชีคลัง** ที่อ้างในทุกบรรทัดของ BOM และการเคลื่อนไหวสต็อก (แบบ SAP)
--   1 SLoc ครอบได้หลายโซน · 1 โซนอยู่ใต้ SLoc เดียว — ผูกกันเมื่อไหร่ค่อยเพิ่มคอลัมน์ทีหลัง
--
-- ⚠️ **ไม่ทำ FK จาก bom_items.storage_location มาที่นี่โดยตั้งใจ**
--   PE ที่กรอก BOM อาจไม่มีสิทธิ์ `storage:manage` → เจอพื้นที่ใหม่แล้วกรอกไม่ได้ = ทางตัน
--   ใช้ **check รูปแบบ (กันพิมพ์ผิด) + UI เตือน "⚠ ไม่ได้อยู่ในทะเบียน"** แทน
--   (pattern เดียวกับ picker อะไหล่ที่พิมพ์ชื่อนอกทะเบียนได้แต่ติดป้ายบอก)
--
-- rollback:
--   alter table public.bom_items drop constraint if exists bom_items_sloc_format;
--   alter table public.bom_items add constraint bom_items_sloc_len
--     check (storage_location is null or char_length(storage_location) between 1 and 20);
--   drop table if exists public.storage_locations;

create table if not exists public.storage_locations (
  code            text primary key,
  name            text not null,
  kind            text,                     -- store_part | production | warehouse | raw | other
  note            text,
  sort_order      integer     not null default 100,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by_name text,
  constraint storage_locations_code_format check (code ~ '^[A-Z]{1,3}[0-9]{3}$')
);

comment on table public.storage_locations is
  'ทะเบียนรหัสคลัง (SAP Storage Location) — ตัวอักษร 1-3 ตัว + เลข 3 หลัก · คนละเรื่องกับ storage_zones (โซนบนผัง)';

alter table public.storage_locations enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='storage_locations' and policyname='storage_locations_all') then
    create policy storage_locations_all on public.storage_locations for all using (true) with check (true);
  end if;
end $$;

-- updated_at + audit (ตาราง master ที่แก้ไขได้ ต้องสืบได้ว่าใครแก้ — กฎ Traceability)
drop trigger if exists trg_storage_locations_updated on public.storage_locations;
create trigger trg_storage_locations_updated before update on public.storage_locations
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_storage_locations_audit on public.storage_locations;
create trigger trg_storage_locations_audit after insert or update or delete on public.storage_locations
  for each row execute function public.fn_audit();

-- ═══ seed 5 รหัสที่ user ให้มา (on conflict do nothing — รันซ้ำได้ ไม่ทับที่คนแก้แล้ว) ═══
insert into public.storage_locations (code, name, kind, sort_order) values
  ('S401', 'พื้นที่สโตร์เก็บชิ้นส่วน',            'store_part', 10),
  ('P401', 'พื้นที่ผลิต 1',                      'production', 20),
  ('P402', 'พื้นที่ผลิต 2',                      'production', 30),
  ('W401', 'พื้นที่ Warehouse (สินค้าสำเร็จรูป)', 'warehouse',  40),
  ('R401', 'พื้นที่สโตร์เหล็ก (Raw Material)',   'raw',        50)
on conflict (code) do nothing;

-- ═══ บังคับรูปแบบเดียวกันที่ bom_items (แทน check ความยาวเดิม) ═══
-- ปลอดภัย: ตอนนี้ทุกแถวเป็น null (ยังไม่มีใครกรอก) — ตรวจแล้วก่อนรัน
alter table public.bom_items drop constraint if exists bom_items_sloc_len;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bom_items_sloc_format') then
    alter table public.bom_items
      add constraint bom_items_sloc_format
      check (storage_location is null or storage_location ~ '^[A-Z]{1,3}[0-9]{3}$');
  end if;
end $$;
