-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ทะเบียนหน่วยนับ (UOM) — 2026-11-05 · คำสั่ง user หลัง audit dropdown ("ทำทะเบียน UOM แบบ (ข)")
--
-- ที่มา: ฟอร์ม Parts Master hardcode 7 หน่วย · import/ลงทะเบียนอัตโนมัติเขียน default 'EA' บ้าง 'pcs' บ้าง
--        ⇒ ฐานมี PC / EA / pcs ปนกัน (หน่วยเดียวกัน) · จอเทียบหน่วยตัวพิมพ์ใหญ่ ⇒ PC ≠ PCS = uomConflict เทียม
-- ตัดสินโดย user 2026-11-05: **EA = pcs = PC (หน่วยเดียวกัน) · หน่วยหลัก = PC · แก้ข้อมูลในฐาน**
-- โมเดล: คอลัมน์ปลายทาง (parts_master.uom · bom_items.uom · material_request_items.unit) เก็บ code เป็น text
--        **ไม่ผูก FK** (เหมือน customers/suppliers) · aliases = สะกดอื่นที่แม็ปเข้ารหัสนี้ (ใช้ตอน import)
--
-- ย้อนกลับ (ลำดับ: revert โค้ดก่อน แล้วค่อยคืนข้อมูล):
--   update public.parts_master p set uom = b.old_uom from archive.uom_fix_20261105 b where b.tbl='parts_master' and b.id = p.id::text;
--   update public.bom_items    i set uom = b.old_uom from archive.uom_fix_20261105 b where b.tbl='bom_items'    and b.id = i.id::text;
--   drop table public.uom_units;   -- (ไม่มีตารางไหนผูก FK)

-- ═══ 1) ทะเบียน ═══
create table if not exists public.uom_units (
  code            text primary key,
  name            text not null,
  aliases         text[] not null default '{}',
  note            text,
  sort_order      integer not null default 100,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by_name text
);
-- รหัส = ตัวพิมพ์ใหญ่ ไม่มีช่องว่างหัวท้าย (normUom เทียบแบบตัวพิมพ์ใหญ่ · รหัสตัวเล็ก = ปลายทางจับคู่ไม่เจอเงียบๆ)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'uom_units_code_upper') then
    alter table public.uom_units add constraint uom_units_code_upper check (code = upper(btrim(code)) and code <> '');
  end if;
end $$;
comment on table public.uom_units is
  'ทะเบียนหน่วยนับ (UOM) — parts_master.uom / bom_items.uom / material_request_items.unit เก็บ code (text ไม่ผูก FK) · aliases = สะกดอื่นที่แม็ปเข้ารหัสนี้ตอน import · จัดการที่ /products แท็บ 📏 หน่วยนับ';

alter table public.uom_units enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='uom_units' and policyname='uom_units_all') then
    create policy uom_units_all on public.uom_units for all using (true) with check (true); -- DR convention: anon-open (supabaseDR = anon เสมอ)
  end if;
end $$;
grant select, insert, update, delete on public.uom_units to anon, authenticated;

drop trigger if exists trg_uom_units_updated on public.uom_units;
create trigger trg_uom_units_updated before update on public.uom_units for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_uom_units_audit on public.uom_units;
create trigger trg_uom_units_audit after insert or update or delete on public.uom_units for each row execute function public.fn_audit();

-- seed = 7 หน่วยที่ฟอร์มเดิม hardcode (EA ยุบเข้า PC ตามที่ user ตัดสิน)
insert into public.uom_units (code, name, aliases, sort_order) values
  ('PC',   'ชิ้น',    array['EA','PCS','EACH','PIECE'], 10),
  ('KG',   'กิโลกรัม', array['KGS'],                    20),
  ('M',    'เมตร',    array[]::text[],                  30),
  ('SET',  'ชุด',     array[]::text[],                  40),
  ('BOX',  'กล่อง',   array[]::text[],                  50),
  ('ROLL', 'ม้วน',    array[]::text[],                  60)
on conflict (code) do nothing;

-- ═══ 2) สำรองค่าเดิมก่อนแก้ (schema archive ไม่ถูก expose ผ่าน API) ═══
create table if not exists archive.uom_fix_20261105 as
  select 'parts_master'::text as tbl, id::text as id, uom as old_uom from public.parts_master
   where upper(btrim(uom)) in ('EA','PCS','EACH','PIECE') or (uom is not null and uom <> upper(btrim(uom)) and upper(btrim(uom)) = 'PC')
  union all
  select 'bom_items', id::text, uom from public.bom_items
   where upper(btrim(uom)) in ('EA','PCS','EACH','PIECE') or (uom is not null and uom <> upper(btrim(uom)) and upper(btrim(uom)) = 'PC');
alter table archive.uom_fix_20261105 enable row level security;

-- ═══ 3) แก้ข้อมูล: EA / pcs / each / piece → PC (ไม่มี UPDATE trigger บน 2 ตารางนี้ — ตรวจแล้ว 05/11) ═══
update public.parts_master p set uom = 'PC'
  from archive.uom_fix_20261105 b where b.tbl = 'parts_master' and b.id = p.id::text;
update public.bom_items i set uom = 'PC'
  from archive.uom_fix_20261105 b where b.tbl = 'bom_items' and b.id = i.id::text;
