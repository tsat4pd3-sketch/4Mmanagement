-- 🗓️ ความถี่การตรวจ "รายไตรมาส" เซฟไม่ได้ — เปิดค่าที่ UI มีให้เลือกครบทุกค่า
-- Target project: DR (eyhclzkifitbhbljgoav).
--
-- ที่มา (feedback หน้างาน 2026-08-21): ใน PM Setup เลือกความถี่ "รายไตรมาส" แล้วกดบันทึกไม่ผ่าน
-- ต้นเหตุ: `checklists` ถูกสร้างนอก migration folder (มาก่อนโฟลเดอร์นี้) นิยามจริงจึงไม่มีในรีโป
--          และ check constraint ของคอลัมน์ frequency ไม่ครอบค่า 'quarterly' ที่ UI เสนอให้เลือก
--          → UI ให้เลือกได้ แต่ DB ปฏิเสธ = ค่าที่กดไม่ได้จริงแต่ไม่มีอะไรบอก
--
-- ค่าที่ต้องรองรับ = คีย์ทั้งหมดของ FREQ_LABEL ใน src/lib/pmSchedule.js
--   daily · weekly · monthly · quarterly · periodic
-- ⚠️ เพิ่มความถี่ใหม่ใน FREQ_LABEL เมื่อไหร่ ต้องมาเติมที่ constraint นี้ด้วย
--    (UI กับ DB ต้องรู้จักค่าชุดเดียวกันเสมอ ไม่งั้นเจอบั๊กแบบนี้ซ้ำ)
--
-- ปลอดภัย/รันซ้ำได้: ไล่ลบ check constraint เดิมทุกตัวที่อ้างถึงคอลัมน์ frequency
-- (ไม่ต้องรู้ชื่อเดิม) แล้วสร้างตัวใหม่ชื่อคงที่ · ไม่แตะข้อมูลในตาราง

do $$
declare c record;
begin
  -- 1) ถอด check constraint เดิมที่คุมคอลัมน์ frequency (ชื่ออาจต่างกันในแต่ละฐาน)
  for c in
    select con.conname
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attnum = any (con.conkey)
    where con.conrelid = 'public.checklists'::regclass
      and con.contype = 'c'
      and att.attname = 'frequency'
  loop
    execute format('alter table public.checklists drop constraint %I', c.conname);
    raise notice 'dropped old frequency constraint: %', c.conname;
  end loop;

  -- 2) แถวเก่าที่มีค่านอกลิสต์ (ถ้ามี) → ปล่อยเป็น 'periodic' ("ตามรอบ") ไม่ทิ้งข้อมูล
  --    ทำก่อนใส่ constraint ใหม่ ไม่งั้น add constraint จะไม่ผ่าน
  update public.checklists
     set frequency = 'periodic'
   where frequency is not null
     and frequency not in ('daily','weekly','monthly','quarterly','periodic');

  -- 3) constraint ใหม่ ชื่อคงที่ (รันซ้ำจะถูก drop ในลูปข้างบนแล้วสร้างใหม่)
  alter table public.checklists
    add constraint checklists_frequency_check
    check (frequency is null or frequency in ('daily','weekly','monthly','quarterly','periodic'));
end $$;

-- ตรวจผลหลังรัน:
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.checklists'::regclass and contype = 'c';
--   select frequency, count(*) from public.checklists group by 1 order by 2 desc;
