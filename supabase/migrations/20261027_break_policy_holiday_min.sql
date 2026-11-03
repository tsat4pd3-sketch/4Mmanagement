-- นาทีพัก "วันที่ไม่ใช่วันทำงาน" ต่อนโยบาย (2026-10-27 · คำสั่ง user)
-- กฎหน้างาน: วันที่ปฏิทินบริษัทบอกว่าไม่ใช่วันทำงาน (มาทำ OT) พักเที่ยง 50 นาที → 60 นาที
--
-- 🔴 ทำไมต้องเป็นคอลัมน์ ไม่ใช่เงื่อนไขในโค้ด:
--    "50 → 60" เป็นค่าของโรงงาน ไม่ใช่ตรรกะ — ฝังในโค้ดแล้ววันหลังเปลี่ยนเป็น 45/70
--    ต้องรอโปรแกรมเมอร์ · ที่นี่หัวหน้าแก้เองได้ที่ ⚙️ ตั้งค่า → นโยบายหยุดพัก
-- 🔴 ว่าง (null) = ใช้ `duration_min` เหมือนเดิมทุกวัน ⇒ ไม่ใส่ = พฤติกรรมเดิมเป๊ะ
--    (ปลอดภัยสำหรับแถวที่มีอยู่แล้วทั้งหมด — ไม่มีแถวไหนเปลี่ยนค่าจาก migration นี้)
alter table public.break_policies
  add column if not exists duration_min_holiday int;

comment on column public.break_policies.duration_min_holiday is
  'นาทีพักเมื่อวันนั้น "ไม่ใช่วันทำงาน" ตามปฏิทินบริษัท (null = ใช้ duration_min เหมือนเดิม)';

-- กันค่าที่เป็นไปไม่ได้ (0 = ไม่พัก ให้ใช้ duration_min=0 แทน · ที่นี่ null แปลว่า "ไม่ตั้ง")
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'break_policies_holiday_min_ck') then
    alter table public.break_policies
      add constraint break_policies_holiday_min_ck
      check (duration_min_holiday is null or (duration_min_holiday >= 0 and duration_min_holiday <= 480));
  end if;
end $$;
