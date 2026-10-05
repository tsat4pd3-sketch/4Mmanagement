-- ════════════════════════════════════════════════════════════════════════════
-- รวมชื่อแผนกที่พิมพ์ผิด/ตัวพิมพ์ต่างกัน ให้ตรงผังองค์กร (2026-10-04 · คำสั่ง user)
-- project: MAIN (ชื่อในจอ "MAIN" · ewhdfqwfwofivojtsizn)
--
-- ที่มา: สำรวจ `shift_schedules` 30/09 เจอแถวหน่วยงานชื่อซ้ำกันเอง (`Smail Press` กับ
--   `SMALL PRESS`) — ไล่ต้นทางแล้วพบว่า `shift_schedules.dept_name` **ถูกสร้างจาก
--   `employees.department` ทุกครั้งที่บันทึกตารางกะ** ⇒ แก้ที่ `shift_schedules` ไม่มีผล
--   สัปดาห์ถัดไปแถวผิดจะกลับมาใหม่ · ต้องแก้ที่ `employees.department` เท่านั้น
--
-- 🔴 แก้เฉพาะ 3 คู่ที่ "ไม่กำกวม" — ชื่อถูกมีคนใช้เยอะกว่ามาก อยู่ส่วนงานเดียวกัน
--    และ (2 ตัวแรก) ตัวสะกดถูกอยู่ในผังองค์กร `org_nodes` อยู่แล้ว:
--      'Smail Press' (3 คน · PD1)  → 'SMALL PRESS' (16 คน · PD1 · อยู่ในผัง)
--      'Big Press'   (2 คน · PD1)  → 'BIG PRESS'   (16 คน · PD1 · อยู่ในผัง)
--      'ฝ่าผลิต'      (1 คน · PD2)  → 'ฝ่ายผลิต'     (38 คน · PD2 · ตกตัว "ย")
--
-- ⛔ จงใจ **ไม่แตะ** คู่ที่ยังตัดสินแทนคนไม่ได้ — ต้องให้คนในส่วนงานยืนยันก่อน:
--      'APRON ASSY' (8) vs 'LINE APRON ASSY' (54)  — อาจเป็นคนละหน่วยจริง
--      'HDF' (3)        vs 'HYDROFORM' (46)        — อาจเป็นตัวย่อ หรือคนละหน่วย
--      'ASSY2' (13) · 'ฝ่ายผลิต' (38) — ยังไม่มีในผังองค์กร (คนละปัญหา: ผังไม่ครบ)
--
-- 🔑 `employees.department` ถูกอ่านใน 12 หน้า (ขอบเขตแจ้งเตือน/รายงาน/ตารางกะ) ⇒
--    เปลี่ยนค่าผิดตัวเดียว = คนหลุด scope เงียบๆ · จึงสำรองก่อนทุกครั้ง
--
-- ย้อนกลับ (คืนค่าเดิมรายคน):
--   update public.employees e set department = b.department_old
--     from archive._bak_20261004_emp_dept b where b.id = e.id;
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists archive;

create table if not exists archive._bak_20261004_emp_dept as
select id, department as department_old, now() as backed_up_at
  from public.employees
 where department in ('Smail Press', 'Big Press', 'ฝ่าผลิต');

alter table archive._bak_20261004_emp_dept enable row level security;

update public.employees set department = 'SMALL PRESS' where department = 'Smail Press';
update public.employees set department = 'BIG PRESS'   where department = 'Big Press';
update public.employees set department = 'ฝ่ายผลิต'     where department = 'ฝ่าผลิต';

comment on table archive._bak_20261004_emp_dept is
  'ค่า employees.department เดิมก่อนรวมชื่อที่พิมพ์ผิด 2026-10-04 — คืนด้วย update...from';

-- ── ตรวจหลังรัน ─────────────────────────────────────────────────────────────
--   select count(*) from archive._bak_20261004_emp_dept;                       -- ต้องได้ 6
--   select department, count(*) from public.employees
--    where department in ('Smail Press','Big Press','ฝ่าผลิต') group by 1;      -- ต้องได้ 0 แถว
