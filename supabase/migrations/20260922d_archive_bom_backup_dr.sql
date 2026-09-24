-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ══ 🧹 ย้ายตารางสำรองตัวใหม่ `bom_items_backup_20260922` → schema `archive` ══════════
-- 2026-09-22 · ต่อจากรอบเก็บกวาดใหญ่วันเดียวกัน (`20260922_archive_backup_tables_dr.sql`)
--
-- ⚠️ **นี่คือหลักฐานว่าวงจรนี้เกิดซ้ำจริง ไม่ใช่ปัญหาครั้งเดียว**
--   รอบใหญ่ย้าย 33 ตารางออกไปตอนเช้า · **บ่ายวันเดียวกัน** session ขนาน (commit bae51de ·
--   migration `20260922_bom_flat_dupe_rows_off_dr.sql`) ก็ `create table bom_items_backup_20260922
--   as select ...` ใน public อีกตัว — RLS ปิด · ไม่มี PK · 598 แถวของ BOM จริง
--   ⇒ ฝั่ง DR ที่ client วิ่งด้วย role `anon` เสมอ = ใครถือ anon key อ่าน/เขียน/ลบได้ทั้งตาราง
--
--   ด่านใน build (`regressionGuards` กฎ `backup-tables-go-to-archive`) บังคับเฉพาะไฟล์ลงวันที่
--   ตั้งแต่ 20260923 ขึ้นไป ⇒ ไฟล์ลงวันที่เดียวกัน (20260922) หลุดด่านไป — เป็นช่องโหว่ 1 วัน
--   ที่ยอมรับไว้ตั้งแต่ตอนตั้งด่าน (ไม่ย้อนบังคับไฟล์ที่ merge ไปแล้ว) · ตั้งแต่พรุ่งนี้ไปด่านจับครบ
--
-- ตรวจก่อนย้ายแล้ว (เงื่อนไขเดียวกับรอบใหญ่ — ห้ามย้ายแบบเหมา):
--   1. ไม่มีโค้ด client/edge function เรียก `.from('bom_items_backup_20260922')` เลยสักจุด
--   2. ไม่มี function/trigger/view ฝั่ง DB อ้างถึง (สแกน pg_proc.prosrc + pg_get_viewdef = 0)
--
-- ⚠️ rollback ของ `20260922_bom_flat_dupe_rows_off_dr.sql` ที่อ้างตารางนี้
--    ให้เติม `archive.` นำหน้าชื่อตาราง

create schema if not exists archive;
alter table if exists public.bom_items_backup_20260922 set schema archive;

-- ── เช็คผลหลังรัน ────────────────────────────────────────────────────────────────────
--   select table_schema, table_name from information_schema.tables
--    where table_name = 'bom_items_backup_20260922';       -- ต้องได้ archive (ไม่ใช่ public)
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────────────
--   alter table if exists archive.bom_items_backup_20260922 set schema public;
