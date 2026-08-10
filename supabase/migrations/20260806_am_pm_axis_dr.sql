-- แกน AM/PM เป็น "ข้อมูล" ไม่ใช่เงื่อนไขใน if — DR project (2026-08-06)
--
-- เดิม: teamKind() ตัดสินด้วย `key === 'production'` hardcode ในโค้ด
--   → วันหน้าถ้าแยก AM รายส่วนงาน (AM-PD1 / AM-PD2) หรือเพิ่มโรงงานใหม่ที่เรียกทีมคนละชื่อ
--     ทีมใหม่จะกลายเป็น PM ทันทีโดยไม่มีใครรู้ตัว (fail-silent)
--
-- ใหม่: mtn_teams.kind = 'am' | 'pm' ตั้งเองได้ต่อทีม
--   am = Autonomous Maintenance — พนักงานหน้างานตรวจเองทุกต้นกะ
--   pm = Preventive/Predictive  — ช่าง (technician/engineer) ตรวจตามรอบเวลา/ยอดผลิต/เงื่อนไข
--
-- backward-compatible: โค้ด fallback ไป key='production' เมื่อคอลัมน์ยังไม่มี/ยังไม่ตั้งค่า

alter table mtn_teams add column if not exists kind text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'mtn_teams_kind_chk') then
    alter table mtn_teams add constraint mtn_teams_kind_chk check (kind is null or kind in ('am','pm'));
  end if;
end $$;

comment on column mtn_teams.kind is
  'am = พนักงานหน้างานตรวจเอง (Autonomous) · pm = ช่างตรวจตามรอบ/เงื่อนไข (Preventive/Predictive) · null = เดาจาก key (backward-compat)';

-- backfill ตามความหมายปัจจุบัน (idempotent — แตะเฉพาะที่ยังว่าง)
update mtn_teams set kind = case when key = 'production' then 'am' else 'pm' end where kind is null;
