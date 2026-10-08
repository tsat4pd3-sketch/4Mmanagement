-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ══ 🧹 ย้าย "ตารางสำรอง/ตารางชั่วคราวของ migration" ออกจาก schema public → `archive` ══
-- 2026-09-22 · คำสั่ง user: *"พวกตาราง ซ้ำๆ คือยังไง ... ตารางไหนไม่ได้ใช้ หรือโครงสร้างไม่ดี แก้ไขให้ที
--                            ตอนนี้จำนวน schema เยอะมาก"*
--
-- ที่มา: ทุกครั้งที่ session ก่อนๆ ทำ migration ที่แตะข้อมูลจริง จะ `create table xxx_bak_<วันที่> as
--   select ...` ไว้กันพลาด — ถูกต้องแล้ว **แต่สร้างไว้ใน `public` แล้วไม่มีใครเก็บกวาด**
--   ⇒ สะสมเป็น 33 ตารางใน 1 เดือน · ปนกับตารางจริงในทุกที่ที่มองเห็น schema
--     (Supabase SQL Editor · จอ /schema · PostgREST)
--
-- 🔴 ที่แย่กว่าความรก — **ข้อมูลจริงรั่วผ่าน anon key**:
--   ตารางสำรองเหล่านี้ 31 ตัว **ไม่ได้เปิด RLS** (คัดลอกข้อมูลมา แต่ policy ไม่ได้ตามมาด้วย)
--   ฝั่ง DR ที่ client วิ่งด้วย role `anon` เสมอ = ใครก็ตามที่มี anon key (ฝังอยู่ในบันเดิลเว็บ)
--   อ่าน/เขียน/ลบสำเนาข้อมูลผลิตจริงได้ทั้งตาราง โดยไม่ต้อง login
--
-- วิธีที่เลือก: **ย้าย schema ไม่ลบ** (`alter table ... set schema archive`)
--   · ข้อมูลอยู่ครบทุกแถว — ย้อนกลับได้ด้วยคำสั่งบรรทัดเดียวต่อตาราง (ดู rollback ท้ายไฟล์)
--   · schema `archive` ไม่ถูก expose ผ่าน PostgREST และไม่ grant ให้ anon/authenticated
--     ⇒ หายจาก API + หายจากจอ /schema ทันที แต่ยังเปิดดูใน SQL Editor ได้
--   · **ไม่ drop** เพราะลบแล้วย้อนไม่ได้ — ให้ user เป็นคนตัดสินใจลบทีหลังเมื่อมั่นใจ
--     (คิวรีเช็คของที่ค้างใน archive อยู่ท้ายไฟล์)
--
-- ตรวจก่อนย้ายแล้ว (ทั้ง 2 เงื่อนไขต้องผ่าน ห้ามย้ายแบบเหมา):
--   1. ไม่มีโค้ดฝั่ง client/edge function เรียกใช้เลยสักจุด (สแกน `.from('<ชื่อ>')` ทั้งรีโป)
--   2. ไม่มี function/trigger/view ฝั่ง DB อ้างถึงเลย (สแกน pg_get_functiondef + pg_get_viewdef)
--
-- ⚠️ เอกสาร rollback เก่าที่อ้างตารางสำรองพวกนี้ ให้เติม `archive.` นำหน้าชื่อตาราง

create schema if not exists archive;
comment on schema archive is 'ตารางสำรอง/ชั่วคราวของ migration — ไม่ expose ผ่าน API · ห้ามให้โค้ดแอปอ่าน';
-- กันไม่ให้ API แตะ (ต่อให้ภายหลังมีใครเผลอเพิ่ม archive เข้า db-schemas ของ PostgREST)
revoke all on schema archive from anon, authenticated;
revoke all on all tables in schema archive from anon, authenticated;

alter table if exists public._bak_20260918_dup862_orders set schema archive;
alter table if exists public._bak_20260918_dup862_txns set schema archive;
alter table if exists public._bak_20260919_trial_open_orders set schema archive;
alter table if exists public._bak_20260921_862_longrange set schema archive;
alter table if exists public._reclass_def_20260826 set schema archive;
alter table if exists public._reclass_dt_20260826 set schema archive;
alter table if exists public._reclass_jig_20260902 set schema archive;
alter table if exists public._reclass_sort_20260826 set schema archive;
alter table if exists public.checklists_bak_test1_20260909 set schema archive;
alter table if exists public.child_lot_req_bak_junk_20260908 set schema archive;
alter table if exists public.child_lot_req_bak_tiny_20260824 set schema archive;
alter table if exists public.downtime_bak_laser345_20260915 set schema archive;
alter table if exists public.dr_products_bak_laser345_20260915 set schema archive;
alter table if exists public.inspection_results_bak_test1_20260909 set schema archive;
alter table if exists public.inspections_bak_test1_20260909 set schema archive;
alter table if exists public.jig_checkpoints_bak_test1_20260909 set schema archive;
alter table if exists public.jig_images_bak_test1_20260909 set schema archive;
alter table if exists public.jigs_bak_test1_20260909 set schema archive;
alter table if exists public.kanban_lot_bak_units_20260821 set schema archive;
alter table if exists public.kanban_rounds_bak_20260827 set schema archive;
alter table if exists public.kanban_standards_bak_lot1_20260908 set schema archive;
alter table if exists public.line_stock_txn_bak_op_20260820 set schema archive;
alter table if exists public.oee_break_overlap_backfill_20260915 set schema archive;
alter table if exists public.oee_imported_qty_backfill_20260917 set schema archive;
alter table if exists public.oee_q_zero_output_backfill_20260917 set schema archive;
alter table if exists public.pm_daily_line_targets_bak_test1_20260909 set schema archive;
alter table if exists public.pm_plan_reminders_bak_test1_20260909 set schema archive;
alter table if exists public.pm_plans_bak_test1_20260909 set schema archive;
alter table if exists public.prod_orders_bak_laser345_20260915 set schema archive;
alter table if exists public.production_sessions_bak_empty_20260908 set schema archive;
alter table if exists public.production_sessions_empty_backup_20260916 set schema archive;
alter table if exists public.purchase_req_bak_lotbug_20260821 set schema archive;
alter table if exists public.scrap_items_bak_laser345_20260915 set schema archive;

-- ── ตรวจผลหลังรัน ────────────────────────────────────────────────────────────
--   select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='archive';        -- ต้องได้ 33
--   select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relkind='r'
--      and c.relname ~ '(^_?(bak|bk|reclass)_)|(_bak_)|(_backup_[0-9]{8}$)|(_backfill_[0-9]{8}$)';  -- ต้องได้ 0

-- ── rollback (ย้ายกลับ public ทีละตาราง — ข้อมูลไม่เคยถูกลบ) ──────────────────
--   alter table if exists archive._bak_20260918_dup862_orders set schema public;
--   alter table if exists archive._bak_20260918_dup862_txns set schema public;
--   alter table if exists archive._bak_20260919_trial_open_orders set schema public;
--   alter table if exists archive._bak_20260921_862_longrange set schema public;
--   alter table if exists archive._reclass_def_20260826 set schema public;
--   alter table if exists archive._reclass_dt_20260826 set schema public;
--   alter table if exists archive._reclass_jig_20260902 set schema public;
--   alter table if exists archive._reclass_sort_20260826 set schema public;
--   alter table if exists archive.checklists_bak_test1_20260909 set schema public;
--   alter table if exists archive.child_lot_req_bak_junk_20260908 set schema public;
--   alter table if exists archive.child_lot_req_bak_tiny_20260824 set schema public;
--   alter table if exists archive.downtime_bak_laser345_20260915 set schema public;
--   alter table if exists archive.dr_products_bak_laser345_20260915 set schema public;
--   alter table if exists archive.inspection_results_bak_test1_20260909 set schema public;
--   alter table if exists archive.inspections_bak_test1_20260909 set schema public;
--   alter table if exists archive.jig_checkpoints_bak_test1_20260909 set schema public;
--   alter table if exists archive.jig_images_bak_test1_20260909 set schema public;
--   alter table if exists archive.jigs_bak_test1_20260909 set schema public;
--   alter table if exists archive.kanban_lot_bak_units_20260821 set schema public;
--   alter table if exists archive.kanban_rounds_bak_20260827 set schema public;
--   alter table if exists archive.kanban_standards_bak_lot1_20260908 set schema public;
--   alter table if exists archive.line_stock_txn_bak_op_20260820 set schema public;
--   alter table if exists archive.oee_break_overlap_backfill_20260915 set schema public;
--   alter table if exists archive.oee_imported_qty_backfill_20260917 set schema public;
--   alter table if exists archive.oee_q_zero_output_backfill_20260917 set schema public;
--   alter table if exists archive.pm_daily_line_targets_bak_test1_20260909 set schema public;
--   alter table if exists archive.pm_plan_reminders_bak_test1_20260909 set schema public;
--   alter table if exists archive.pm_plans_bak_test1_20260909 set schema public;
--   alter table if exists archive.prod_orders_bak_laser345_20260915 set schema public;
--   alter table if exists archive.production_sessions_bak_empty_20260908 set schema public;
--   alter table if exists archive.production_sessions_empty_backup_20260916 set schema public;
--   alter table if exists archive.purchase_req_bak_lotbug_20260821 set schema public;
--   alter table if exists archive.scrap_items_bak_laser345_20260915 set schema public;
