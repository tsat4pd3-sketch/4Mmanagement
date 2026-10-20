-- 🎖️ รักษาการ (acting) — ขยาย `employee_flex_units` ให้เก็บได้ 2 ความหมาย (2026-10-20 · คำสั่ง user)
-- project: Main "MAIN" (ewhdfqwfwofivojtsizn)
--
-- ที่มา: ผจก.ฝ่าย PD3 (สังกัดจริง + cost center อยู่ PD3) **รักษาการ** ผจก. ของ PD4 และ JIG MTN ด้วย
--        ⇒ หัวผังของ 2 หน่วยนั้นว่าง ทั้งที่หน้างานมีคนดูแลอยู่จริง
--
-- ทำไมใช้ตารางเดิม ไม่สร้างตารางใหม่:
--   ตารางนี้คือทะเบียน "คนคนนี้เกี่ยวข้องกับหน่วยไหนอีกบ้าง" อยู่แล้ว · ทั้ง 2 ความหมาย
--   **อ้างอิงอย่างเดียว ไม่นับเป็นกำลังคน ไม่ย้ายสังกัด ไม่แตะ cost center** ⇒ กฎชุดเดียวกันเป๊ะ
--   สร้างตารางที่ 2 = มี 2 ที่ต้องไล่เช็คตอนลบโหนดผัง (orgNodeRefs) และลืมที่ใดที่หนึ่งแน่นอน
--
--   kind='flex'   🏃 คนวิ่งข้ามแผนก — ไปช่วยทำงานประจำ (พฤติกรรมเดิมทั้งหมด)
--   kind='acting' 🎖️ รักษาการ      — ดูแล/บังคับบัญชาหน่วยนั้น ขึ้น "หัวผัง" ของหน่วย
--
-- ย้อนกลับ: alter table public.employee_flex_units drop column kind;
--           (แถวเดิมไม่ถูกแตะ · จอเก่าที่ไม่รู้จักคอลัมน์นี้ทำงานเหมือนเดิมทุกประการ)

alter table public.employee_flex_units
  add column if not exists kind text not null default 'flex';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.employee_flex_units'::regclass and conname = 'employee_flex_units_kind_chk'
  ) then
    alter table public.employee_flex_units
      add constraint employee_flex_units_kind_chk check (kind in ('flex', 'acting'));
  end if;
end $$;

comment on column public.employee_flex_units.kind is
  'flex = คนวิ่งข้ามแผนก (ไปช่วยงาน) · acting = รักษาการ (ขึ้นหัวผังของหน่วยนั้น) — ทั้งคู่อ้างอิงเท่านั้น ไม่นับกำลังคน ไม่ย้ายสังกัด ไม่แตะ cost center';

-- คนหนึ่งคนผูกหน่วยเดียวกันได้ทั้ง 2 ความหมาย (ไปช่วยงาน + รักษาการ) ⇒ unique ต้องรวม kind ด้วย
-- ของเดิมเป็น UNIQUE **constraint** (ไม่ใช่ index ลอย) ⇒ ต้อง drop constraint ไม่ใช่ drop index
alter table public.employee_flex_units
  drop constraint if exists employee_flex_units_employee_id_org_node_id_key;
create unique index if not exists employee_flex_units_emp_node_kind_key
  on public.employee_flex_units (employee_id, org_node_id, kind);
-- ย้อนกลับขั้นนี้: drop index employee_flex_units_emp_node_kind_key;
--   alter table public.employee_flex_units add constraint employee_flex_units_employee_id_org_node_id_key
--     unique (employee_id, org_node_id);   -- ต้องไม่มีแถว acting ค้างอยู่ก่อน
