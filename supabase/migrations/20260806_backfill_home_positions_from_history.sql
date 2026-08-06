-- Backfill ตำแหน่งประจำ (employee_home_positions) จากประวัติการจัดคนจริง  (Main project)
-- คำสั่ง user 2026-08-06: "ไล่เช็คประวัติย้อนหลังว่าใครอยู่ตำแหน่งไหนมากสุด ให้บันทึกเป็นประจำ — ทุกไลน์ ทุกกะ"
--
-- ที่มาของปัญหา: ตำแหน่งประจำไม่ได้เป็นแค่ไอคอน 🏠 — มันเป็น "เส้นฐาน" ที่ Management.jsx:552
-- ใช้ตัดสินว่าการวางคนครั้งนี้เป็นการ "ย้ายจุด" (4M Man) หรือไม่:
--     const isHome = homePositions[empId] === String(finalAssign)
--     if (!isHome) → getManCase() → 🟡/🔴 ต้องแนบรูป OJT + SV/QA อนุมัติ
-- พนักงานที่ไม่มีตำแหน่งประจำจึงถูกมองว่า "ย้ายจุด" ทุกวัน → 4M ค้างอนุมัติ + marker กระพริบเหลืองรัวๆ
-- (เกิดหลังแตกไลน์ลูกแล้วจุดงานถูกย้าย/สร้างใหม่บนไลน์ลูก โดยไม่ได้ตั้งตำแหน่งประจำใหม่)
--
-- ── กติกาที่ใช้ตัดสิน "ตำแหน่งประจำ" ──────────────────────────────────────────
--  1. นับจาก daily_production_logs.assigned_line (= id จุดงาน · แหล่งเดียวกับที่หน้า Management เขียน)
--  2. **1 กะ = 1 เสียง** (count distinct work_date+shift) — ไม่ใช่นับจำนวนแถว
--     กันคนที่ถูกสลับจุดหลายรอบในกะเดียวถ่วงน้ำหนักเกินจริง
--  3. เท่ากัน → **จุดที่ทำล่าสุดชนะ** แล้วค่อยเรียงชื่อจุด (ให้ผลคงที่ รันซ้ำได้ผลเดิม)
--  4. เฉพาะจุดงานที่ยังมีอยู่จริง (join workstations) — จุดที่ถูกลบไปแล้วห้ามกลายเป็นตำแหน่งประจำ
--  5. เฉพาะพนักงานที่ยัง active
--  6. ⚠️ **เติมเฉพาะคนที่ยังไม่มีตำแหน่งประจำ — ไม่ทับของเดิมที่หัวหน้าตั้งเอง**
--     (การตั้งตำแหน่งประจำเป็นการตัดสินใจของคน ระบบเดาทับไม่ได้ · เคสที่ของเดิมไม่ตรงกับประวัติ
--      ให้ดูจากคำสั่งรายงานท้ายไฟล์แล้วให้หัวหน้าตัดสินเอง)
--
-- idempotent: รันซ้ำได้ (on conflict do nothing + กรองคนที่มีอยู่แล้วออก)
-- ย้อนกลับ: แถวที่ backfill รอบนี้ดูได้จาก updated_by is null and updated_at = เวลาที่รัน

with votes as (
  select l.employee_id,
         w.id           as station_id,
         w.station_name,
         w.line_name,
         w.line_id,
         count(distinct (l.work_date, l.shift)) as shifts,
         max(l.work_date)                       as last_seen
    from daily_production_logs l
    -- เทียบเป็น text: assigned_line เป็น text ที่เก็บ uuid ของจุดงาน
    -- ถ้าเป็นค่าขยะ/ชื่อไลน์เก่าจะไม่ match เอง (ไม่ต้อง cast ให้ error)
    join workstations w on w.id::text = l.assigned_line
   where l.assigned_line is not null
   group by l.employee_id, w.id, w.station_name, w.line_name, w.line_id
),
ranked as (
  select v.*,
         row_number() over (
           partition by v.employee_id
           order by v.shifts desc, v.last_seen desc, v.station_name
         ) as rn
    from votes v
)
insert into employee_home_positions (employee_id, station_id, line_name, line_id, updated_at)
select r.employee_id, r.station_id, r.line_name, r.line_id, now()
  from ranked r
  join employees e on e.id = r.employee_id
 where r.rn = 1
   and e.is_active
   and not exists (
     select 1 from employee_home_positions h where h.employee_id = r.employee_id
   )
on conflict (employee_id) do nothing;


-- ─────────────────────────────────────────────────────────────────────────────
-- รายงานหลังรัน (ไม่ใช่ส่วนของ migration — copy ไปรันดูเองได้)
--
-- (1) ผลลัพธ์: ใครถูกตั้งตำแหน่งประจำเป็นจุดไหน + มั่นใจแค่ไหน (shifts = จำนวนกะที่เคยยืนจุดนั้น)
--     shifts น้อย (1-2) = หลักฐานอ่อน ควรให้หัวหน้าตรวจ
--
-- select e.employee_id_code, e.name, ws.line_name, ws.station_name, h.updated_at
--   from employee_home_positions h
--   join employees e   on e.id  = h.employee_id
--   join workstations ws on ws.id = h.station_id
--  order by ws.line_name, ws.station_name, e.name;
--
-- (2) ⚠️ ของเดิมไม่ตรงกับประวัติ — migration ไม่แตะกลุ่มนี้ ให้หัวหน้าตัดสินเอง
--
-- with votes as (
--   select l.employee_id, w.id as station_id, w.station_name, w.line_name,
--          count(distinct (l.work_date, l.shift)) shifts, max(l.work_date) last_seen
--     from daily_production_logs l join workstations w on w.id::text = l.assigned_line
--    where l.assigned_line is not null
--    group by l.employee_id, w.id, w.station_name, w.line_name
-- ), ranked as (
--   select v.*, row_number() over (partition by v.employee_id
--            order by v.shifts desc, v.last_seen desc, v.station_name) rn from votes v
-- )
-- select e.employee_id_code, e.name,
--        cur.station_name as home_ปัจจุบัน, cur.line_name as ไลน์_ปัจจุบัน,
--        r.station_name   as จุดที่อยู่บ่อยสุด, r.line_name as ไลน์_ประวัติ, r.shifts
--   from employee_home_positions h
--   join employees e     on e.id  = h.employee_id and e.is_active
--   join ranked r        on r.employee_id = h.employee_id and r.rn = 1
--   left join workstations cur on cur.id = h.station_id
--  where h.station_id is distinct from r.station_id
--  order by r.shifts desc;
--
-- (3) ยังไม่มีตำแหน่งประจำเลย (ไม่มีประวัติให้เดา — ต้องตั้งมือที่หน้าจัดการไลน์ผลิต)
--
-- select e.employee_id_code, e.name, l.name as line_name
--   from employees e
--   left join production_lines l on l.id = e.line_id
--  where e.is_active
--    and not exists (select 1 from employee_home_positions h where h.employee_id = e.id)
--  order by l.name, e.name;
