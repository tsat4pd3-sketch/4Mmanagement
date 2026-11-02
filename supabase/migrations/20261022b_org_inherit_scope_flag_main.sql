-- 🔒 "อยู่ใต้ในผัง แต่สิทธิ์ไม่ตกทอดลงมา" — org_nodes.inherit_scope (2026-10-22 · คำสั่ง user)
--   user: "สิ่งที่ผิดคือเรื่องหัวหน้า PD4 มาแก้ข้อมูลจิ๊กนั่นแหละ
--          คือองค์กรเรามันแปลกตรงเอาจิ๊กมาฝากกับผลิต"
--
-- JIG MTN อยู่ใต้ PD4 ในผังจริง (ผจก. คนเดียวกัน) แต่ **ขอบเขตการแก้ข้อมูล** ต้องไม่ตกทอดจาก PD4
-- ⇒ แยก "สายบังคับบัญชาบนผัง" ออกจาก "การตกทอดขอบเขตสิทธิ์" ด้วยธงที่โหนด
-- default = true ⇒ ทุกหน่วยเดิมพฤติกรรมไม่เปลี่ยน (backward-compatible)
-- ตัดสินจริงที่ `ancestorsOf()` ใน src/utils/orgScope.js (ที่เดียว · มีด่าน org-scope-needs-inherit-scope)
-- apply แล้ว 2026-10-22
alter table public.org_nodes
  add column if not exists inherit_scope boolean not null default true;

comment on column public.org_nodes.inherit_scope is
  'false = ขอบเขตสิทธิ์ของหน่วยแม่ไม่ครอบหน่วยนี้ (ยังโชว์ใต้แม่ในผัง) — ตัดที่ ancestorsOf ใน src/utils/orgScope.js';

update public.org_nodes set inherit_scope = false
 where kind = 'department' and name = 'JIG MTN';

-- ROLLBACK: update public.org_nodes set inherit_scope = true where name = 'JIG MTN';
--           (ถอดคอลัมน์ทั้งหมด: alter table public.org_nodes drop column inherit_scope;)
