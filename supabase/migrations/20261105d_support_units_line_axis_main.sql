-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ ยุบ "แกนหน่วยงาน" ให้เหลือแกนเดียว — หน่วยสนับสนุนเข้าทะเบียนไลน์           ║
-- ║ Main project (MAIN · ewhdfqwfwofivojtsizn) · 2026-11-05 · คำสั่ง user      ║
-- ╚════════════════════════════════════════════════════════════════════════════╝
--
-- ที่มา: ระบบมี 2 แกนคู่ขนานสำหรับ "หน่วยงาน"
--   (ก) `production_lines` — มีของครบ: ปุ่มเติมตารางกะล่วงหน้า · ไลน์แม่-ลูก (ตกทอดกะ)
--       · เช็คชื่อ · ยืมคน · manpower board · ผังองค์กร
--   (ข) `shift_schedules.dept_name` — **ข้อความลอย ไม่มีทะเบียน ไม่มี FK**
--       พนักงาน 101 คนไม่มี `line_id` จึงพึ่งแกน (ข) อยู่ ⇒ จับคู่ `employees.department`
--       ติดแค่ 7/14 ชื่อ · กำพร้า 6 ชื่อ · มี 'Smail Press' ปนกับ 'SMALL PRESS'
--       · ปุ่มเติมล่วงหน้าใช้ไม่ได้ (ประวัติ 1-5 สัปดาห์ · detectRotation ปฏิเสธทั้ง 14)
--
-- สิ่งที่ migration นี้ทำ (ข้อมูลล้วน — **ไม่แตะ schema ไม่แตะโค้ด ไม่ต้อง deploy**):
--   1. สร้างหน่วยสนับสนุน 14 แถวใน `production_lines` (`unit_kind='support'`)
--      ผังตรงกับ `org_nodes` เป๊ะ (ชื่อ · ลำดับชั้น · cost_center)
--   2. ย้ายพนักงาน 85 คน (`line_id` NULL → หน่วยของตัวเอง) — snapshot ไว้ใน schema `archive`
--   3. ลอกแถวตารางกะฝั่ง `dept_name` → ฝั่ง `line_id` ของหน่วยที่มีอยู่แล้ว 6 หน่วย
--      (ค่าเท่าเดิมทุกวัน ⇒ กะที่ระบบตอบไม่เปลี่ยน แต่แกนไลน์ **เลี้ยงตัวเองได้** และ
--       ปุ่มเติมล่วงหน้ามีประวัติให้จับจังหวะ)
--
-- 🔴 กฎที่ยึดไว้:
--   · `unit_kind='support'` ต้องตั้งชัดเจน — **ปล่อยว่าง = ระบบถือว่าเป็นไลน์ผลิต**
--     (default ของคอลัมน์ · `src/utils/unitKind.js`) แล้วจะไปโผล่ในจอผลิต/ตัวหาร OEE
--   · `line_type` ปล่อย NULL — หน่วยสนับสนุนไม่มีชนิดกระบวนการ (ตะกร้ารับท้ายลิสต์รองรับแล้ว)
--   · **ไม่แตะ** `employees.org_node_id` / `employees.cost_center` (กฎ manpower-board)
--   · ไม่แก้แถวตารางกะเดิมแม้แถวเดียว — รวมถึงแถว `Inspection` สัปดาห์ 26/10 ที่หลุดจังหวะ
--     (ผิดมาก่อนหน้านี้ · สัปดาห์นั้นผ่านไปแล้ว ⇒ แก้ = เขียนประวัติเช็คชื่อใหม่ ห้ามแตะ)
--
-- ย้อนกลับ (ลำดับนี้):
--   a) update employees e set line_id = a.line_id_before
--        from archive.employees_line_id_20261105 a where a.employee_uuid = e.id;
--   b) delete from shift_schedules where note = 'from-dept-row 20261105';
--   c) delete from production_lines where name = any (…14 ชื่อ…) and unit_kind = 'support';
--      (ข้อ c ลบ cascade แถวกะของหน่วยนั้นอยู่แล้ว — ทำ b ก่อนเพื่อความชัดเจน)

begin;

-- ── 1) ทะเบียนหน่วยสนับสนุน ────────────────────────────────────────────────────
-- cost_center ลอกจาก `org_nodes` ของหน่วยเดียวกัน (ccScope จะตัดสินขอบเขตได้ตรงกัน)
insert into production_lines (name, unit_kind, section, cost_center, parent_line_name, description)
values
  -- QA · ส่วนงาน QA (org_nodes section cost_center 2140441000)
  ('QA',                       'support', 'QA',             '2140441000', null,          'หน่วยสนับสนุน — ส่วนงาน QA (หน่วยแม่)'),
  ('PQA-Press',                'support', 'QA',             '2140541800', 'QA',          'หน่วยสนับสนุน — QA หน้าไลน์ปั๊ม'),
  ('PQA-Incoming',             'support', 'QA',             '2140541900', 'QA',          'หน่วยสนับสนุน — QA ตรวจรับเข้า'),
  ('Inspection',               'support', 'QA',             '2140541300', 'QA',          'หน่วยสนับสนุน — งานตรวจ'),
  ('QA Measuring & Testing',   'support', 'QA',             '2140541200', 'QA',          'หน่วยสนับสนุน — ห้องวัด/ทดสอบ'),
  ('QA Improvement & Service', 'support', 'QA',             '2140541100', 'QA',          'หน่วยสนับสนุน — ปรับปรุงคุณภาพ/บริการลูกค้า'),
  -- คลัง · ส่วนงาน Planning&Store
  ('STORE',                    'support', 'Planning&Store', '2140524000', null,          'หน่วยสนับสนุน — คลัง'),
  -- เครื่องมือ · ส่วนงาน Tooling MTN
  ('Tooling MTN',              'support', 'Tooling MTN',    '2140459100', null,          'หน่วยสนับสนุน — ส่วนงานเครื่องมือ (หน่วยแม่)'),
  ('Die MTN',                  'support', 'Tooling MTN',    '2140559101', 'Tooling MTN', 'หน่วยสนับสนุน — ซ่อมบำรุงแม่พิมพ์'),
  -- JIG · ส่วนงาน JIG MTN
  ('JIG MTN',                  'support', 'JIG MTN',        '2140563100', null,          'หน่วยสนับสนุน — ซ่อมบำรุงจิ๊ก'),
  -- ซ่อมบำรุง · ส่วนงาน Maintenance
  ('Maintenance',              'support', 'Maintenance',    '2140456000', null,          'หน่วยสนับสนุน — ส่วนงานซ่อมบำรุง (หน่วยแม่)'),
  ('Mechanic',                 'support', 'Maintenance',    '2140556200', 'Maintenance', 'หน่วยสนับสนุน — ช่างกล'),
  ('Preventive',               'support', 'Maintenance',    '2140556300', 'Maintenance', 'หน่วยสนับสนุน — งาน PM'),
  ('Electric',                 'support', 'Maintenance',    '2140556100', 'Maintenance', 'หน่วยสนับสนุน — ช่างไฟฟ้า')
on conflict (name) do nothing;

-- ── 2) snapshot ก่อนย้ายคน (schema archive — ห้ามไว้ public) ───────────────────
create table if not exists archive.employees_line_id_20261105 (
  employee_uuid  uuid primary key,
  employee_code  text,
  full_name      text,
  section        text,
  department     text,
  line_id_before integer,
  moved_to       integer,
  moved_at       timestamptz not null default now()
);

with target as (
  select e.id,
         case
           when trim(coalesce(e.department,'')) <> '' and trim(e.department) in
                ('PQA-Press','PQA-Incoming','Inspection','QA Measuring & Testing','QA Improvement & Service',
                 'STORE','Die MTN','JIG MTN','Mechanic','Preventive','Electric')
             then trim(e.department)
           when trim(coalesce(e.section,'')) in ('QA','Tooling MTN','JIG MTN','Maintenance')
             then trim(e.section)
           when trim(coalesce(e.section,'')) = 'Planning&Store' then 'STORE'
           else null
         end as unit_name
  from employees e
  where e.line_id is null
    and coalesce(e.is_active, true)
    -- เฉพาะคนในส่วนงานสนับสนุน · คนในส่วนงานผลิต (PD1-PD4) ที่ยังไม่ผูกไลน์ **ไม่แตะ**
    and (trim(coalesce(e.section,'')) in ('QA','Planning&Store','Tooling MTN','JIG MTN','Maintenance')
         or trim(coalesce(e.department,'')) = 'JIG MTN')
)
insert into archive.employees_line_id_20261105
      (employee_uuid, employee_code, full_name, section, department, line_id_before, moved_to)
select e.id, e.employee_id_code, e.name, e.section, e.department, e.line_id, l.id
from target t
join employees e on e.id = t.id
join production_lines l on l.name = t.unit_name and l.unit_kind = 'support'
on conflict (employee_uuid) do nothing;

update employees e
   set line_id = a.moved_to
  from archive.employees_line_id_20261105 a
 where a.employee_uuid = e.id
   and e.line_id is null;          -- กันทับของคนที่ถูกผูกไลน์ไปแล้วระหว่างนี้

-- ── 3) ลอกตารางกะฝั่ง dept_name → ฝั่ง line_id (ค่าเท่าเดิมเป๊ะ) ──────────────
-- ลอกเฉพาะ 6 หน่วยที่ "ชื่อแผนก = ชื่อหน่วยใหม่" ตรงตัว · หน่วยที่ยังไม่มีแถวกะเลย
-- (STORE · Die MTN · JIG MTN · Mechanic · Preventive · Tooling MTN · Maintenance · QA)
-- ตั้งใจเว้นไว้ — ทีมที่ขึ้นกะเช้า (A/B) เป็นนโยบายของหน่วย ระบบเดาแทนไม่ได้ (user ตั้งเองที่ /shift-organize)
insert into shift_schedules (work_date, line_id, day_team, is_manual, note)
select s.work_date, l.id, s.day_team, s.is_manual, 'from-dept-row 20261105'
from shift_schedules s
join production_lines l on l.name = s.dept_name and l.unit_kind = 'support'
where s.dept_name in ('Inspection','PQA-Incoming','PQA-Press',
                      'QA Measuring & Testing','QA Improvement & Service','Electric')
on conflict (work_date, line_id) do nothing;

commit;

-- ── 4) เก็บชื่อแผนกกำพร้าในตารางกะออก (ส่วนที่ 2 ของงานเดียวกัน) ───────────────
-- เฉพาะชื่อที่ **ไม่มีพนักงานคนไหนใช้ชื่อนี้เลย** — 'QA' (14) · 'Smail Press' (7 · พิมพ์ผิดของ
-- SMALL PRESS) · 'ฝ่าผลิต' (7 · พิมพ์ผิดของ ฝ่ายผลิต) = 28 แถว
-- 🔴 ไล่เช็คปลายทางก่อนลบตามกฎ "ทะเบียนที่จับคู่ด้วยข้อความ" · ชื่อที่ยังมีคนใช้ (GOR · LWRBAR
--    · ทั่วไป · BIG/SMALL PRESS · Electric · Inspection · PQA-* · QA *) **ไม่แตะ** — เป็นตัวสำรองของ fallback
begin;

create table if not exists archive.shift_dept_rows_dropped_20261105 as
  select *, now() as dropped_at from shift_schedules where false;

insert into archive.shift_dept_rows_dropped_20261105
select s.*, now() from shift_schedules s where s.dept_name in ('QA', 'Smail Press', 'ฝ่าผลิต');

delete from shift_schedules
where dept_name in ('QA', 'Smail Press', 'ฝ่าผลิต')
  and not exists (
    select 1 from employees e
    where coalesce(e.is_active, true)
      and lower(trim(coalesce(e.department, ''))) = lower(trim(shift_schedules.dept_name))
  );

commit;

-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║ ผลที่วัดได้หลัง apply (05/11/2026)                                          ║
-- ╠════════════════════════════════════════════════════════════════════════════╣
-- ║ · หน่วยสนับสนุนใหม่ 14 แถว (id 75-88) · ไลน์ผลิตยังเป็น 36 แถว (active 33) ║
-- ║ · ย้ายคน 85 คน (QA 46 · STORE 11 · Tooling MTN 11 · JIG MTN 8 · MTN 9)     ║
-- ║ · ลอกแถวกะ 1,162 แถว (QA 5 หน่วย × 189 + Electric 217)                     ║
-- ║ · ลบชื่อกำพร้า 28 แถว · เหลือชื่อฝั่ง dept_name 11 ชื่อ                      ║
-- ║ 🟢 **พิสูจน์ว่าไม่กระทบ: "กะที่ระบบตอบ" ต่อคน-ต่อวัน เหมือนเดิม 289/289 คน** ║
-- ║    (digest md5 ต่อคน · 69,433 ช่อง(คน×วัน) เท่ากันเป๊ะ · คนที่ยังไม่มีกะ 55) ║
-- ║ · ยังไม่ผูกไลน์ 16 คน = พนักงานในส่วนงานผลิต PD1-PD4 ที่ HR ยังไม่ระบุไลน์   ║
-- ║   (คนละเรื่องกับงานนี้ — ต้องให้คนเลือกไลน์ ระบบเดาแทนไม่ได้)                ║
-- ╚════════════════════════════════════════════════════════════════════════════╝
