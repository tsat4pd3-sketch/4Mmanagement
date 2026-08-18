-- ตั้งกะให้ "หน่วยงานสนับสนุน" ได้ (ช่าง MTN/JIG/DIE · QA · คลัง)
-- Project: Main (ewhdfqwfwofivojtsizn) · 2026-08-11
--
-- ที่มา (user แจ้ง): "เรื่อง set กะ ให้กับพนักงานซัพพอร์ทยังทำไม่ได้"
--   ยืนยันรูปแบบแล้ว: **หมุน A/B พร้อมกันทั้งแผนก เหมือนไลน์ผลิต แค่เป็นของหน่วยงานตัวเอง**
--   (คนที่ไม่หมุนกะ = Team C ซึ่งกลไกเดิมรองรับอยู่แล้ว ไม่ต้องทำอะไรเพิ่ม)
--
-- ปัญหาเดิม: shift_schedules ผูก (work_date, line_id) เท่านั้น
--   → พนักงานที่ไม่มี line_id (ช่าง/QA/คลัง สังกัดแผนกขึ้นตรงฝ่าย) ไม่มีแถวให้ตั้งกะ
--   → หน้าเช็คชื่อ resolve กะจาก lineSchedule[emp.line_id] เท่านั้น = assignedShift null ตลอด
--   → เหลือทางเดียวคือ shift_overrides ทีละคน-ทีละวัน (14 คน × 30 วัน = ใช้จริงไม่ไหว)
--
-- วิธี: เพิ่ม `dept_name` — แถวของหน่วยงานจะมี line_id = null + dept_name = ชื่อแผนก
--   จับคู่กับ `employees.department` (ฟอร์มพนักงานเป็น select จาก org_nodes แล้ว drift ใหม่เกิดไม่ได้)
--
-- ⚠️ ต้องมี unique index ของตัวเอง — unique(work_date, line_id) เดิมกันซ้ำของแผนกไม่ได้
--    (แถวของแผนกมี line_id = null และ Postgres ถือว่า NULL ไม่เท่ากับ NULL → ซ้ำได้ไม่จำกัด)
-- ⚠️ และต้องเป็น index **ธรรมดา ห้าม partial** (`where dept_name is not null`)
--    เพราะ PostgREST upsert ส่งแค่ `on_conflict=work_date,dept_name` เติม WHERE ให้ไม่ได้
--    → Postgres infer partial index ไม่เจอ แล้วพังทั้งการบันทึก
--    ไม่ต้องกลัวชนกับแถวไลน์: แถวไลน์ dept_name = null ซึ่ง unique index ปล่อยผ่านเสมอ (NULLS DISTINCT)

alter table public.shift_schedules add column if not exists dept_name text;
alter table public.shift_schedules alter column line_id drop not null;

create unique index if not exists shift_schedules_dept_uniq
  on public.shift_schedules (work_date, dept_name);

create index if not exists shift_schedules_dept_idx
  on public.shift_schedules (dept_name) where dept_name is not null;

comment on column public.shift_schedules.dept_name is
  'ชื่อแผนก (employees.department) สำหรับหน่วยงานสนับสนุนที่ไม่ได้สังกัดไลน์ผลิต —
   แถวนี้ line_id จะเป็น null · จับคู่พนักงานด้วย employees.department
   ⚠️ ห้ามตั้งทั้ง line_id และ dept_name พร้อมกันในแถวเดียว (แถวหนึ่ง = ขอบเขตเดียว)';

-- กันตั้งพร้อมกัน 2 แกน (แถวหนึ่งต้องเป็นของไลน์ หรือของแผนก อย่างใดอย่างหนึ่ง)
alter table public.shift_schedules drop constraint if exists shift_schedules_scope_ck;
alter table public.shift_schedules add constraint shift_schedules_scope_ck
  check (line_id is not null or dept_name is not null);

-- Rollback:
--   alter table public.shift_schedules drop constraint if exists shift_schedules_scope_ck;
--   drop index if exists public.shift_schedules_dept_uniq;
--   drop index if exists public.shift_schedules_dept_idx;
--   alter table public.shift_schedules drop column if exists dept_name;
--   ⚠️ line_id กลับเป็น not null ไม่ได้ถ้ามีแถวของแผนกค้างอยู่ — ลบแถว dept ก่อน:
--      delete from public.shift_schedules where line_id is null;
