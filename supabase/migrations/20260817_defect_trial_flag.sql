-- ── งานทดลอง (Try-out) แยกออกจาก %Q แต่ยังเก็บไว้คิดมูลค่าของเสีย (2026-08-17 · คำสั่ง user) ──
-- โจทย์: พนักงานลง "งานทดลอง" → ไม่นับเป็น %Q ที่ไปคิด OEE (ไลน์ไม่ควรถูกลงโทษจากงานลองแม่พิมพ์/ลองงานใหม่)
--        แต่ยังต้องเก็บไว้ให้เห็น "มูลค่าของเสียทั้งหมด" เทียบกับ "มูลค่าของเสียจากไลน์ผลิต" (= ตัวเดียวกับที่คิด %Q)
--
-- ทำเครื่องหมายได้ 2 ทาง (user เลือกทั้งคู่):
--   1) ที่ "ประเภทของเสีย" — dr_defect_types.excl_from_q  → ตั้งครั้งเดียว เช่นประเภท "งานทดลอง/Try-out"
--   2) ที่ "รายการที่บันทึก" — defect_logs.is_trial        → ประเภทไหนก็ติ๊กเป็นงานทดลองรายครั้งได้
--      (ระหว่างลองงาน ของเสียเป็นได้ทุกประเภท ถ้าผูกกับประเภทอย่างเดียวจะเสียข้อมูลว่าเสียเพราะอะไร)
--   กติกาในโค้ด: เป็นงานทดลองเมื่อ  is_trial = true  หรือ  ประเภทนั้น excl_from_q = true
--
-- additive ล้วน + default false → ก่อนมีใครติ๊ก พฤติกรรม %Q เดิมเป๊ะทุกจอ
-- revert: drop 2 คอลัมน์นี้ (โค้ดอ่านแบบ optional อยู่แล้ว)

alter table public.dr_defect_types add column if not exists excl_from_q boolean not null default false;
alter table public.defect_logs     add column if not exists is_trial    boolean not null default false;

comment on column public.dr_defect_types.excl_from_q is
  'true = ของเสียประเภทนี้เป็น "งานทดลอง" ไม่นับเข้า %Q ของ OEE (ยังนับในมูลค่าของเสียรวม)';
comment on column public.defect_logs.is_trial is
  'true = รายการนี้เป็นงานทดลอง ไม่นับเข้า %Q (ติ๊กรายครั้งจากฟอร์มบันทึกงานเสีย)';

-- ค่าที่คิดตอนปิดกะไปแล้ว (production_sessions.oee_q) ไม่ถูกแตะย้อนหลัง
-- ตามกฎเดิมของโปรเจค: ห้าม recompute กะเก่าด้วย master ปัจจุบัน
