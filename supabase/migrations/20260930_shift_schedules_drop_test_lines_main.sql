-- ════════════════════════════════════════════════════════════════════════════
-- ล้างแถวตารางกะของ "ไลน์ทดสอบ" ที่ค้างใน production (2026-09-30 · คำสั่ง user)
-- project: MAIN (ชื่อในจอ "MAIN" · ewhdfqwfwofivojtsizn)
--
-- ที่มา: คิวรีสำรวจ shift_schedules 30/09 เจอ 3 ไลน์ที่ `is_active = false` ชื่อ
--   `test` · `test child` · `test child 2` มีแถวกะค้างรวม 70 แถว (29/06 – 09/08)
--   ไลน์ถูกปิดใช้งานแล้ว จอ ShiftOrganize จึงไม่โชว์ (กรอง `.eq('is_active', true)')
--   แต่แถวยังโผล่ในคิวรี/รายงานที่ join จาก shift_schedules ตรงๆ
--
-- 🔴 ขอบเขต — ลบ **แถวตารางกะ** เท่านั้น
--    **ไม่แตะ `production_lines`** ของไลน์ทดสอบ: ยังไม่ได้พิสูจน์ว่าไม่มีตารางอื่น
--    อ้าง line_id พวกนี้อยู่ (หลายตารางใช้ line_id แบบไม่ประกาศ FK) ลบไลน์ทิ้งแล้ว
--    ของที่อ้างถึงจะกลายเป็น orphan เงียบๆ — ต้องสำรวจก่อนถึงจะลบได้
--
-- ย้อนกลับ (คืนทั้ง 70 แถว):
--   insert into public.shift_schedules
--   select * from archive._bak_20260930_shift_test_lines;
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists archive;

-- สำรองก่อนลบ — ต้องอยู่ schema `archive` ห้ามไว้ใน `public`
-- (public = anon อ่านได้ ถ้าลืมใส่ RLS · เคยค้าง 37 ตารางมาแล้ว 22/09)
create table if not exists archive._bak_20260930_shift_test_lines as
select s.*
  from public.shift_schedules s
  join public.production_lines l on l.id = s.line_id
 where l.is_active is not true
   and l.name in ('test', 'test child', 'test child 2');

alter table archive._bak_20260930_shift_test_lines enable row level security;

delete from public.shift_schedules s
 using public.production_lines l
 where l.id = s.line_id
   and l.is_active is not true
   and l.name in ('test', 'test child', 'test child 2');

comment on table archive._bak_20260930_shift_test_lines is
  'สำรองแถว shift_schedules ของไลน์ทดสอบ (test / test child / test child 2) ก่อนลบ 2026-09-30 — คืนด้วย insert...select';

-- ── ตรวจผลหลังรัน ───────────────────────────────────────────────────────────
--   select count(*) as สำรองไว้ from archive._bak_20260930_shift_test_lines;   -- ต้องได้ 70
--   select count(*) as เหลือใน_public from public.shift_schedules s
--     join public.production_lines l on l.id = s.line_id
--    where l.is_active is not true and l.name in ('test','test child','test child 2');  -- ต้องได้ 0
