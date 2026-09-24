-- ══════════════════════════════════════════════════════════════════════════════
-- แก้ `start_time` ของกะที่เปิดด้วยเวลา default ผิด + คำนวณ OEE ใหม่   (DR · 2026-09-24)
--
-- ที่มา: ตามหลัง `20260924_dt_outside_shift_backfill_dr.sql` — เหลือ downtime ที่อยู่
--        **ก่อนเวลาเปิดกะ** โดยเลื่อนวัน/±12 ชม. แล้วไม่เข้ากรอบสักทาง
--        ไล่ดูทีละกะแล้วพบว่า **เวลา downtime ถูก แต่ `start_time` ของกะผิด**
--        ลายเซ็น: กะดึกเปิดด้วยค่า default `22:30` ทั้งที่ `created_at` ของแถวกะเอง
--        อยู่ ~20:05-20:27 และใบผลิตใบแรกเปิด 20:00 ⇒ คนมา OT ตั้งแต่ 2 ทุ่ม
--
-- 🔴 OEE คำนวณใหม่ด้วย **สูตรจริงของระบบ** — `computeSessionOee()` ใน `src/utils/oee.js` (§8)
--    ผ่านสคริปต์ `scripts/backfill/` **ไม่ได้เขียนสูตรซ้ำใน SQL** (กฎ single source of truth)
--    ⚠️ ค่าที่ได้ต่างจาก stamp เดิมด้วย **2 สาเหตุซ้อนกัน** ไม่ใช่แค่เวลาเปิดกะ:
--      (1) กรอบกะใหม่ (สิ่งที่ตั้งใจแก้)
--      (2) สูตรถูกแก้ไป 4 รอบหลังกะพวกนี้ปิด — DT นอกช่วงพาร์ท (17/09) · งานคู่ยุบ shot (18/09)
--          · ใบ imported (16/09) · DT ทับเวลาพัก (15/09) ⇒ stamp เดิมคิดด้วยสูตรคนละเวอร์ชัน
--      (3) `ct_snapshot` ของกะพวกนี้เป็น null (ฟีเจอร์มาทีหลัง) ⇒ %P ใช้ CT ปัจจุบัน
--          — migration นี้จึง **เขียน ct_snapshot ลงไปด้วย** ให้คำนวณซ้ำได้ตรงในอนาคต
--
-- ย้อนกลับ: update จาก archive.session_start_time_fix_20260924 (เก็บค่าเดิมครบทุกคอลัมน์)
-- ══════════════════════════════════════════════════════════════════════════════
create schema if not exists archive;

create table if not exists archive.session_start_time_fix_20260924 (
  id               uuid primary key,
  line_name        text,
  work_date        date,
  shift            text,
  old_start_time   time,  new_start_time   time,
  old_shift_min    int,   new_shift_min    int,
  old_oee_a        numeric, old_oee_p numeric, old_oee_q numeric, old_oee numeric,
  new_oee_a        numeric, new_oee_p numeric, new_oee_q numeric, new_oee numeric,
  old_ct_snapshot  jsonb,  new_ct_snapshot jsonb,
  fixed_at         timestamptz default now()
);

with fix(id, new_start, new_shift_min, new_a, new_p, new_q, new_oee, new_ct) as (values
  ('27b34826-8143-4e8c-9d12-6aaf8bac3b01'::uuid, '20:00:00'::time, 720, 96.48, 71.13, 100, 68.62, '{"10100379": 54}'::jsonb),
  ('f04ca511-7ac3-4e78-a689-df264cab85d7'::uuid, '22:00:00'::time, 600, 100, 87.91, 100, 87.91, '{"20058498": 54}'::jsonb),
  ('c9cd65c8-6a57-4456-9c3d-2bb6b2a16ee7'::uuid, '22:00:00'::time, 390, 100, 82.86, 100, 82.86, '{"50029017": 45}'::jsonb),
  ('361d3658-0963-47c4-b134-bf4bc4e9888f'::uuid, '20:00:00'::time, 720, 87.78, 54, 100, 47.4, '{"10100333": 54, "10100379": 54}'::jsonb),
  ('b6284d9b-3243-4371-b735-bcc96dbe1ae1'::uuid, '20:30:00'::time, 690, 100, 57.27, 100, 57.27, '{"20058498": 54}'::jsonb),
  ('419d9959-a935-4dc6-ab54-eceeebbc5823'::uuid, '20:00:00'::time, 540, 100, 56.82, 100, 56.82, '{"50029017": 45}'::jsonb),
  ('00bd7d4c-b365-4e4c-bd4e-3af00d621ee7'::uuid, '20:00:00'::time, 700, 100, 77.68, 100, 77.68, '{"20067017": 58}'::jsonb),
  ('affa1c9d-9941-4610-b882-d9ec76b83715'::uuid, '20:00:00'::time, 720, 100, 98.12, 100, 98.12, '{"50031625": 59}'::jsonb),
  ('0a2af823-792c-4101-831c-3a8a720a7896'::uuid, '20:00:00'::time, 720, 81.48, 65.85, 100, 53.66, '{"50029017": 45}'::jsonb)
)
insert into archive.session_start_time_fix_20260924
  (id, line_name, work_date, shift, old_start_time, new_start_time, old_shift_min, new_shift_min,
   old_oee_a, old_oee_p, old_oee_q, old_oee, new_oee_a, new_oee_p, new_oee_q, new_oee,
   old_ct_snapshot, new_ct_snapshot)
select s.id, s.line_name, s.work_date, s.shift, s.start_time, f.new_start, s.shift_min, f.new_shift_min,
       s.oee_a, s.oee_p, s.oee_q, s.oee, f.new_a, f.new_p, f.new_q, f.new_oee,
       s.ct_snapshot, f.new_ct
from production_sessions s join fix f on f.id = s.id
on conflict (id) do nothing;

update production_sessions s
set start_time  = b.new_start_time,
    shift_min   = b.new_shift_min,
    oee_a       = b.new_oee_a,
    oee_p       = b.new_oee_p,
    oee_q       = b.new_oee_q,
    oee         = b.new_oee,
    ct_snapshot = b.new_ct_snapshot
from archive.session_start_time_fix_20260924 b
where b.id = s.id;

-- ตรวจผล: ต้องไม่เหลือ downtime ก่อนเปิดกะของ 9 กะนี้
-- select count(*) from downtime_logs d join production_sessions s on s.id=d.session_id
--  where d.session_id in (select id from archive.session_start_time_fix_20260924)
--    and d.started_at < (s.work_date + s.start_time) at time zone 'Asia/Bangkok';
