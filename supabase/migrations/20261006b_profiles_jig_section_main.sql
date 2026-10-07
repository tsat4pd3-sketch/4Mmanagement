-- ════════════════════════════════════════════════════════════════════════════
-- Main project ("MAIN" · ewhdfqwfwofivojtsizn)
-- ตั้งแผนก "JIG MTN" ให้บัญชีทีม JIG ที่ยังไม่มีแผนก (2026-10-06)
--
-- ที่มา (user 06/10): **"ทีม jig แผนกก็ต้องเป็น JIG MTN ทุกคนสิ"**
--   ไล่ดูแล้วทีม JIG 10 บัญชี — 6 คนมี `employees.section = 'JIG MTN'` ครบถูกต้อง
--   อีก **4 บัญชีว่างทั้ง `profiles.section` และ `employees.section`**
--   (ทั้ง 4 ไม่มีแถวใน `employees` ผูกไว้เลย ⇒ ตั้งที่ `profiles.section` ซึ่งเป็นช่องที่
--    `notify_recipients()` อ่านก่อนเสมอ)
--
-- ⚠️ **ลำดับสำคัญ — ต้องรันหลัง `20261006_notify_team_beats_section_main.sql` เท่านั้น**
--   ก่อนหน้านั้น 4 บัญชีนี้ได้รับสายเรียกเพราะ "ไม่มี section ที่ไหนเลย" (ทางออกสุดท้าย
--   ของด่านส่วนงาน) ⇒ ตั้งแผนกก่อนแก้ RPC = **ตัดเขาออกจากการแจ้งเตือนทันที**
--   (migration ตัวนั้นทำให้ "อยู่ในทีมที่ถูกเรียก" ชนะด่านส่วนงานแล้ว จึงปลอดภัย)
--
-- 'JIG MTN' = ชื่อแผนกที่ **มีอยู่จริงในทะเบียน** `employees.section` (7 แถว) —
--   ไม่ได้ตั้งชื่อใหม่ (กฎ: AI ห้ามเดา/ตั้งชื่อหน่วยงานของโรงงานเอง)
--
-- 📌 ที่ยังไม่ทำ: ทีม `maintenance` (3 บัญชี) และ `die_maintenance` (2 บัญชี) ก็ยังไม่มีแผนก
--   แต่ **ทะเบียน `employees.section` ยังไม่มีชื่อแผนกของ 2 ทีมนี้เลย** (มีแต่ PD1-4 ·
--   Planning&Store · JIG MTN) ⇒ ต้องให้ user บอกชื่อที่ใช้จริงก่อน ห้ามเดา
--   · ไม่กระทบการแจ้งเตือนแล้ว เพราะ RPC ใช้ "ทีม" เป็นตัวตัดสินแทนส่วนงานไปแล้ว
--
-- ⚠️ ย้อนกลับได้: ใช้สำรองเดิม `archive.profiles_mtn_teams_20261006` (เก็บ section ไว้ด้วย)
-- ════════════════════════════════════════════════════════════════════════════

begin;

create schema if not exists archive;

-- สำรองอีกชุด (เผื่อ migration ก่อนหน้าถูก rollback ไปแล้ว — `if not exists` กันเขียนทับ)
create table if not exists archive.profiles_section_20261006b as
  select id, full_name, section, mtn_teams, now() as backed_up_at
    from public.profiles;
alter table archive.profiles_section_20261006b enable row level security;

update public.profiles p
   set section = 'JIG MTN'
 where p.mtn_teams && array['jig_maintenance']
   and coalesce(nullif(trim(p.section), ''), '') = ''
   and coalesce(nullif(trim((select e.section from public.employees e where e.id = p.employee_id)), ''), '') = '';

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- ✅ คิวรีเช็คผล (project "MAIN" · ewhdfqwfwofivojtsizn)
-- ════════════════════════════════════════════════════════════════════════════
-- 1) ทีม JIG ต้องมีแผนกครบทุกคน (คาดหวัง "ไม่มีแผนก" = 0)
--    select count(*) from public.profiles p
--     where p.mtn_teams && array['jig_maintenance']
--       and coalesce(nullif(trim(p.section),''),'') = ''
--       and coalesce(nullif(trim((select e.section from public.employees e where e.id=p.employee_id)),''),'') = '';
--
-- 2) 🔴 สำคัญสุด — ช่าง JIG ต้องยังได้รับสายเรียกครบ 10 คนเหมือนก่อนตั้งแผนก
--    select count(*) from public.profiles
--     where id in (select public.notify_recipients('downtime_call_mtn','PD3','jig_maintenance',null));
--    -- คาดหวัง 10 · ถ้าได้ 0 หรือน้อยกว่า = RPC ยังไม่ได้แก้ ให้ rollback ไฟล์นี้ทันที
--
-- ⏪ ROLLBACK
--  begin;
--  update public.profiles p set section = b.section
--    from archive.profiles_section_20261006b b where b.id = p.id;
--  commit;
-- ════════════════════════════════════════════════════════════════════════════
