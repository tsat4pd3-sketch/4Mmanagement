-- ══ ใบขอเติม WIP: แปะรหัสคลัง SAP (SLoc) ของไลน์ปลายทาง ═══════════════════════════════════
-- Target project: MAIN (ewhdfqwfwofivojtsizn) — "MAIN" ในจอ Supabase
-- คู่กับ 20260908_storage_locations_line_map.sql (DR — ทะเบียน line_names + ledger + จุดส่ง + v_sloc_stock)
--
-- user 2026-09-08: SAP คุมวัตถุดิบระดับพื้นที่ (P411 = ทั้ง Apron Assy · P409 = ทั้ง Hydroform)
-- ใบขอเติมยังลง **ไลน์ย่อยที่สุด** เหมือนเดิม (ของอยู่ที่ leaf) — คอลัมน์นี้คือ "มุม SAP" ของใบเดียวกัน
-- derive ตอนสร้างใบจาก storage_locations.line_names (DR) ผ่าน slocOfLine — null = ไลน์ยังไม่ผูก **ไม่เดา**
--
-- ด่านขั้น 7 (checkDeliveryPoint) ใช้คอลัมน์นี้เทียบกับ line_delivery_points.storage_location:
--   คนละพื้นที่ = บล็อก · พื้นที่เดียวกันแต่จุดผูกไลน์อื่น = ผ่าน (slocOnly) · ไม่มีข้อมูล = กฎไลน์เดิม
--
-- ⚠️ additive/nullable — โค้ดทน 42703 (ยังไม่ apply = บันทึกใบโดยไม่ tag + เตือนบนจอ)

alter table public.wip_replenish_requests add column if not exists storage_location text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wip_replenish_sloc_format') then
    alter table public.wip_replenish_requests add constraint wip_replenish_sloc_format
      check (storage_location is null or storage_location ~ '^[A-Z]{1,3}[0-9]{3}$');
  end if;
end $$;
comment on column public.wip_replenish_requests.storage_location is
  'รหัสคลัง SAP ของ line_name ณ ตอนสร้างใบ (snapshot จาก storage_locations.line_names ฝั่ง DR) — null = ไลน์ยังไม่ผูก SLoc';

-- ── ตรวจหลังรัน (MAIN) ──
-- select column_name from information_schema.columns where table_name='wip_replenish_requests' and column_name='storage_location';

-- Rollback: alter table public.wip_replenish_requests drop column if exists storage_location;
