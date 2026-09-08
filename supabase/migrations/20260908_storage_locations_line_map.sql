-- ══ 🏬 ชั้นบัญชี SAP (Storage Location) ↔ ชั้นกายภาพ (ไลน์ย่อยที่สุด) — ผูกรหัสคลังกับไลน์ ═══════════
-- Target project: DR (eyhclzkifitbhbljgoav) — "Product DB" ในจอ Supabase
-- คู่กับ 20260908_wip_replenish_storage_location.sql (Main — คอลัมน์บนใบขอเติม)
--
-- ที่มา (user 2026-09-08): "การควบคุมวัตถุดิบในโรงงานอ้างอิงจาก SAP ซึ่งแบ่งเป็นรหัสพื้นที่ —
--   แผนก Apron Assy ที่มีไลน์ FG 2 รายการ 60 และ 61 รวมถึง Sub Apron = พื้นที่ P411 · โซน Hydroform ทั้งหมด = P409"
--   + "sub component เฉพาะของ FG ตัวเดียวก็เป็นของใครของมัน แต่สุดท้ายจะอยู่ใน P411 เหมือนกันในระบบ"
--
-- ⇒ ไม่เลือกข้าง: **SLoc = ชั้นบัญชีที่ derive จากไลน์อัตโนมัติ** · ผูกที่ไลน์แม่ครั้งเดียว (`line_names`)
--    ไลน์ลูกตกทอด (ลำดับชั้นอยู่ Main → client หาให้ผ่าน `slocOfLine` ใน src/utils/storageLoc.js)
--    แล้ว **แปะ `storage_location` ติดทุกรายการตอนเขียน** (ledger · ใบขอเติม · จุดส่ง) — ของยังนับที่ leaf เหมือนเดิม
--    · รายการเดียว 2 มุมมอง: มุม SAP = S401 → P411 · มุม WIP = STORE → Line 60
--    · ไลน์ที่ยังไม่ผูก = null **ไม่เดา** (จอขึ้น worklist) — วิว v_sloc_stock จึงรวมเฉพาะแถวที่ tag แล้ว
--
-- ⚠️ additive ทั้งหมด (คอลัมน์ nullable / default '{}') — โค้ดเก่าไม่กระทบ · rollback ท้ายไฟล์

/* ── 1) ทะเบียนรหัสคลัง: ไลน์ที่ตกอยู่ในพื้นที่นี้ ─────────────────────────────── */
alter table public.storage_locations add column if not exists line_names text[] not null default '{}';
create index if not exists storage_locations_lines_idx on public.storage_locations using gin (line_names);
comment on column public.storage_locations.line_names is
  'ไลน์/พื้นที่ที่ตกอยู่ใน SLoc นี้ — ใส่ **ไลน์แม่** ครั้งเดียว ไลน์ลูกตกทอด (client ไล่สายบนผ่าน slocOfLine) · ค่าพิเศษ STORE / FG WAREHOUSE = "ไลน์" เสมือนใน line_stock_summary · text snapshot → เข้า rename cascade ใน LineSetup';

/* ── 2) แปะ SLoc บน ledger + จุดส่ง (nullable · ตรวจรูปแบบเดียวกับทะเบียน) ─────── */
alter table public.line_stock_transactions add column if not exists storage_location text;
alter table public.line_delivery_points   add column if not exists storage_location text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'line_stock_transactions_sloc_format') then
    alter table public.line_stock_transactions add constraint line_stock_transactions_sloc_format
      check (storage_location is null or storage_location ~ '^[A-Z]{1,3}[0-9]{3}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'line_delivery_points_sloc_format') then
    alter table public.line_delivery_points add constraint line_delivery_points_sloc_format
      check (storage_location is null or storage_location ~ '^[A-Z]{1,3}[0-9]{3}$');
  end if;
end $$;
create index if not exists line_stock_transactions_sloc_idx
  on public.line_stock_transactions (storage_location, mat_no) where storage_location is not null;
comment on column public.line_stock_transactions.storage_location is
  'รหัสคลัง SAP ของ line_name ณ ตอนเขียน (snapshot · derive จาก storage_locations.line_names) — null = ไลน์ยังไม่ผูก SLoc ตอนนั้น';
comment on column public.line_delivery_points.storage_location is
  'รหัสคลัง SAP ของไลน์ที่จุดนี้รับของให้ (derive ตอนบันทึก) — ด่านขั้น 7 เทียบพื้นที่ก่อนเทียบไลน์';

/* ── 3) backstop ฝั่ง DB: แถว ledger ที่ client ไม่ได้ tag → เติมจากทะเบียนเมื่อ "ตรงชื่อ" ──
   ทำได้เฉพาะชื่อที่อยู่ใน line_names ตรงๆ (STORE → S401 · ไลน์ที่ลิสต์ไว้เอง) — ไลน์ลูกที่ตกทอดจากแม่
   ต้องให้ client tag (ลำดับชั้นอยู่ Main) · ไม่เจอ = ปล่อย null ไม่เดา */
create or replace function public.fn_stock_txn_fill_sloc() returns trigger
language plpgsql as $$
begin
  if new.storage_location is null and new.line_name is not null then
    select s.code into new.storage_location
      from public.storage_locations s
     where s.is_active and s.line_names @> array[new.line_name]
     order by s.sort_order, s.code limit 1;
  end if;
  return new;
end $$;
drop trigger if exists trg_stock_txn_fill_sloc on public.line_stock_transactions;
create trigger trg_stock_txn_fill_sloc before insert on public.line_stock_transactions
  for each row execute function public.fn_stock_txn_fill_sloc();

/* ── 4) seed พื้นที่ที่ user ระบุ (on conflict = ไม่ทับชื่อ/ชนิดที่คนแก้แล้ว · เติม line_names เฉพาะที่ยังว่าง) ── */
insert into public.storage_locations (code, name, kind, sort_order, line_names) values
  ('P411', 'พื้นที่ผลิต Apron Assy (Line 60 · 61 · Sub Apron)', 'production', 21, array['LINE APRON ASSY']),
  ('P409', 'พื้นที่ผลิต Hydroform',                              'production', 22, array['HYDROFORM'])
on conflict (code) do update
  set line_names = excluded.line_names
  where public.storage_locations.line_names = '{}';
update public.storage_locations set line_names = array['STORE']        where code = 'S401' and line_names = '{}';
update public.storage_locations set line_names = array['FG WAREHOUSE'] where code = 'W401' and line_names = '{}';

/* ── 5) วิวยอดคงเหลือมุม SAP (รวมทุกไลน์ในพื้นที่) — สูตรเดียวกับ line_stock_summary ──
   ⚠️ รวมเฉพาะแถวที่ tag แล้ว — ก่อน backfill ยอดจะต่ำกว่าจริง (จอต้องบอก "ยังไม่ได้ tag N แถว") */
create or replace view public.v_sloc_stock as
  select storage_location,
         mat_no,
         max(part_name) as part_name,
         sum(case when type = any (array['issue'::text, 'adjust'::text])   then qty
                  when type = any (array['consume'::text, 'return'::text]) then -qty
                  else 0::numeric end) as qty_on_hand,
         count(*) as txn_count,
         max(created_at) as last_txn_at
  from public.line_stock_transactions
  where status = 'approved' and storage_location is not null
  group by storage_location, mat_no;
comment on view public.v_sloc_stock is
  'ยอดคงเหลือมุม SAP (ต่อ SLoc + mat) จาก ledger ที่ tag storage_location แล้ว — คู่กับ line_stock_summary (มุมไลน์ย่อย)';

-- ── ตรวจหลังรัน (Product DB) ──
-- select code, name, line_names from storage_locations order by sort_order;
-- select count(*) filter (where storage_location is null) as untagged, count(*) from line_stock_transactions;
-- select * from v_sloc_stock limit 5;

-- Rollback (ถอยโค้ดก่อน):
--   drop view if exists public.v_sloc_stock;
--   drop trigger if exists trg_stock_txn_fill_sloc on public.line_stock_transactions;
--   drop function if exists public.fn_stock_txn_fill_sloc();
--   alter table public.line_stock_transactions drop column if exists storage_location;
--   alter table public.line_delivery_points   drop column if exists storage_location;
--   alter table public.storage_locations      drop column if exists line_names;
--   delete from public.storage_locations where code in ('P411','P409');
