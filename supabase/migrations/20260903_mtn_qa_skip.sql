-- ══════════════════════════════════════════════════════════════════════════
-- ใบแจ้งซ่อม MO — ข้ามการตรวจ QA (ขั้น 5) เมื่องานไม่เกี่ยวกับคุณภาพ   2026-09-03
-- Project: DR (eyhclzkifitbhbljgoav)
--
-- ที่มา (คำสั่ง user): "สเต็ป 5 ต้องให้ QA อนุมัติ ถ้าเรื่องไม่เกี่ยวกับ QA ต้องกดข้ามไปสเต็ป 6 ได้ ตอนนี้ไม่ได้"
--   ขั้น 4 เลือก "เกี่ยวกับคุณภาพ" → ใบค้างรอ QA และไม่มีใครเลื่อนต่อได้นอกจาก QA
--   (ตรวจฐาน 2026-09-03: ค้าง 26 ใบ ทีม PRODUCTION ทั้งหมด · นานสุด 9 วัน)
--
-- วิธี: การข้าม = แก้การตัดสินใจของขั้น 4 (status คง 'checked' · quality_related → 'ไม่เกี่ยวกับคุณภาพ')
--       ไม่เพิ่ม status ใหม่ · คอลัมน์ 3 ตัวนี้เก็บ "ใคร/ทำไม/เมื่อไหร่" ให้สืบกลับได้ (ห้ามข้ามเงียบๆ)
-- additive · nullable · ใบเก่าไม่กระทบ · โค้ดฝั่งเว็บถอยได้ถ้ายังไม่รัน (42703 → บันทึกโดยไม่เก็บเหตุผล + เตือนบนจอ)
-- ══════════════════════════════════════════════════════════════════════════
alter table public.mtn_orders
  add column if not exists qa_skip_reason text,
  add column if not exists qa_skipped_by  text,
  add column if not exists qa_skipped_at  timestamptz;

comment on column public.mtn_orders.qa_skip_reason is 'เหตุผลที่ข้ามการตรวจ QA (ขั้น 5) — งานไม่เกี่ยวกับคุณภาพ · null = ไม่เคยข้าม';
comment on column public.mtn_orders.qa_skipped_by  is 'ผู้ยืนยันข้าม QA (ผู้เปิดใบ / ผู้ถือ accept_work / QA)';
comment on column public.mtn_orders.qa_skipped_at  is 'เวลาที่ข้าม QA — ตัวชี้ว่าใบนี้เคยข้าม (isQaSkipped ฝั่งเว็บ)';

-- ตรวจผล:
--   select column_name from information_schema.columns
--    where table_name = 'mtn_orders' and column_name like 'qa_skip%';   -- ต้องได้ 3 แถว
-- Rollback (ถอดโค้ดฝั่งเว็บก่อน):
--   alter table public.mtn_orders drop column qa_skip_reason, drop column qa_skipped_by, drop column qa_skipped_at;
