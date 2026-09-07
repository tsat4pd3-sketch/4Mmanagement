-- ใบขอเติมที่ "สโตร์เป็นคนเปิดเอง" จาก Store Time Chart (ส่งตามคำสั่งผลิต) — ลูปสโตร์ (2026-09-07 · คำสั่ง user)
-- Target project: MAIN (ewhdfqwfwofivojtsizn)
--
-- ที่มา: user "หน้า Store Time Chart คือสิ่งที่ต้องไปส่ง แต่กดเลือกชิ้นงานที่จะไปส่งไม่ได้"
--   เดิมใบขอเติมเกิดได้ทางเดียว = หัวหน้าไลน์กด 📦 เบิก ใน Daily Report (ลูปดึง ขั้น 3-4)
--   ตอนนี้สโตร์เห็น forecast ว่าไลน์จะขาดพาร์ทไหนเมื่อไหร่ (คำนวณจากใบผลิต × BOM) → ต้องเลือกแล้วสร้างใบ
--   ไปส่งได้เลย **โดยเข้าคิวเดียวกัน** (🔄 คิวเติม WIP) ไม่แตกคิวใหม่ — สแกนจุดส่ง/ผลิตยืนยันรับ เหมือนกันหมด
--
-- `source` บอกว่าใบเกิดจากใคร (ไว้แยกบนจอ + สรุปสถิติ "ไลน์เรียก vs สโตร์ส่งตามแผน"):
--   line           = หัวหน้าไลน์กดเบิก (ค่าเดิม/ค่า default — แถวเก่าทั้งหมด)
--   store_forecast = สโตร์เลือกจาก Store Time Chart (ส่งตามคำสั่งผลิต)
-- additive · nullable-with-default · โค้ดทนคอลัมน์ยังไม่มี (insert ตัด source ออกเมื่อ 42703)

alter table wip_replenish_requests add column if not exists source text not null default 'line';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wip_replenish_source_chk') then
    alter table wip_replenish_requests add constraint wip_replenish_source_chk
      check (source in ('line','store_forecast'));
  end if;
end $$;
comment on column wip_replenish_requests.source is
  'ใบเกิดจากใคร: line = หัวหน้าไลน์กดเบิก (default) · store_forecast = สโตร์เลือกจาก Store Time Chart ส่งตามคำสั่งผลิต';

-- Rollback:
--   alter table wip_replenish_requests drop constraint if exists wip_replenish_source_chk;
--   alter table wip_replenish_requests drop column if exists source;
