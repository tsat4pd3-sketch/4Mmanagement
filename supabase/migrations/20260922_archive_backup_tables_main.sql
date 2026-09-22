-- ── Main project (ewhdfqwfwofivojtsizn) ──
-- ══ 🧹 ย้าย "ตารางสำรอง/ตารางชั่วคราวของ migration" ออกจาก schema public → `archive` ══
-- 2026-09-22 · คำสั่ง user: *"พวกตาราง ซ้ำๆ คือยังไง ... ตารางไหนไม่ได้ใช้ หรือโครงสร้างไม่ดี แก้ไขให้ที
--                            ตอนนี้จำนวน schema เยอะมาก"*
--
-- ที่มา: ทุกครั้งที่ session ก่อนๆ ทำ migration ที่แตะข้อมูลจริง จะ `create table xxx_bak_<วันที่> as
--   select ...` ไว้กันพลาด — ถูกต้องแล้ว **แต่สร้างไว้ใน `public` แล้วไม่มีใครเก็บกวาด**
--   ⇒ สะสมเป็น 4 ตารางใน 1 เดือน · ปนกับตารางจริงในทุกที่ที่มองเห็น schema
--     (Supabase SQL Editor · จอ /schema · PostgREST)
--
-- 🔴 ที่แย่กว่าความรก — **ข้อมูลจริงรั่วผ่าน anon key**:
--   ตารางสำรองเหล่านี้ 4 ตัว **ไม่ได้เปิด RLS** (คัดลอกข้อมูลมา แต่ policy ไม่ได้ตามมาด้วย)
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

alter table if exists public.bk_notification_rules_inapp_20260917 set schema archive;
alter table if exists public.bk_notification_rules_team_20260921 set schema archive;
alter table if exists public.bk_notifications_link_20260916 set schema archive;
alter table if exists public.bk_profile_emp_link_20260921 set schema archive;

-- ── ตรวจผลหลังรัน ────────────────────────────────────────────────────────────
--   select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='archive';        -- ต้องได้ 4
--   select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
--    where n.nspname='public' and c.relkind='r'
--      and c.relname ~ '(^_?(bak|bk|reclass)_)|(_bak_)|(_backup_[0-9]{8}$)|(_backfill_[0-9]{8}$)';  -- ต้องได้ 0

-- ── rollback (ย้ายกลับ public ทีละตาราง — ข้อมูลไม่เคยถูกลบ) ──────────────────
--   alter table if exists archive.bk_notification_rules_inapp_20260917 set schema public;
--   alter table if exists archive.bk_notification_rules_team_20260921 set schema public;
--   alter table if exists archive.bk_notifications_link_20260916 set schema public;
--   alter table if exists archive.bk_profile_emp_link_20260921 set schema public;
