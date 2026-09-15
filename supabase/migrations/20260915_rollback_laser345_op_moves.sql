-- ⏪ ROLLBACK — ย้อนความพยายามย้าย LASER-345/HDF เข้าชั้น OP ของวันนี้ทั้งหมด  (DR · apply แล้ว 2026-09-15)
--
-- วันนี้ apply ไป 2 ชุดแล้ว **ย้อนกลับทั้งคู่ภายในวันเดียว** ตามคำสั่ง user
--   ("เหมือนจะผิดพลาดละ โรลแบคเอาคืนมาก่อน ที่ตัดงานของ hdf1 กับ laser345 หายไป")
--   ชุดที่ย้อน: `laser345_orders_back_to_op` (ย้ายใบผลิต 58 ใบ + ปิด is_active เลขคอยล์)
--              `op_parent_by_side_clear_fake_mat` (ชี้ parent ตรงข้าง RH/LH + ลบแถว 50031602)
--   ไฟล์ migration 2 ตัวนั้นถูกลบออกจากรีโปแล้ว — รีโปต้องสะท้อนสภาพจริงของฐาน ไม่ใช่สิ่งที่ตั้งใจจะทำ
--
-- 🔴 สาเหตุที่พัง (ยืนยันจากโค้ด `collapseOps` ใน src/utils/pairTotals.js ไม่ใช่การเดา):
--     `if (present.has(parent)) return;`  // พาร์ทจริงถือยอดแล้ว — ขั้นไม่บวกซ้ำ
--   ⇒ **OP ที่ parent มีใบผลิตอยู่ในชุดข้อมูลเดียวกัน จะถูก "ตัดทิ้งทั้งแถว" จากยอดภาพใหญ่**
--   พอย้ายใบ LASER-345 ไปอยู่บนเลข OP (90031603/04 → parent 10100385/10100401)
--   และย้าย parent ฝั่ง LH ของ HDF (90031602) จาก 20065715 → 10100401
--   ซึ่ง Line 60/61 **เปิดใบทุกวัน** ⇒ ยอดของ HDF1 และ LASER-345 หายจากจอสรุปทันที
--   (จอที่ยุบ: DailyReport สรุปทั้งกะ · FactoryMap · Dashboard · DeptDashboard · MorningMeeting ·
--    OEEAnalytics · GroupOverview · monthlyReviewPptx)
--
-- 📌 บทเรียน (เขียนไว้ใน docs/modules/oee.md ด้วย):
--   **ก่อนเปลี่ยน `is_operation` / `op_parent_mat` ของ mat ที่มีใบผลิตเดินอยู่จริง
--     ต้องถามก่อนว่า "parent ตัวนี้มีใบผลิตในกะเดียวกันไหม" — ถ้ามี = สถานีนั้นจะหายจากจอสรุป**
--   การย้ายใบผลิตให้ถูกเลขกับการทำให้ยอดยังมองเห็น เป็นคนละเรื่องกัน ต้องแก้พร้อมกัน

insert into public.dr_products
select b.* from public.dr_products_bak_laser345_20260915 b
where b.mat_no = '50031602'
  and not exists (select 1 from public.dr_products d where d.mat_no = b.mat_no);

update public.dr_products d set
  name = b.name, p_no = b.p_no, customer = b.customer, line_name = b.line_name,
  process_type = b.process_type, is_active = b.is_active, is_operation = b.is_operation,
  op_parent_mat = b.op_parent_mat, op_seq = b.op_seq, cycle_time_sec = b.cycle_time_sec,
  pair_mat_no = b.pair_mat_no, target_per_shift = b.target_per_shift, image_url = b.image_url
from public.dr_products_bak_laser345_20260915 b
where b.mat_no = d.mat_no;

-- 90031601/90031602 ไม่อยู่ใน snapshot (migration ชุดที่ 2 แตะมันโดยไม่ได้ snapshot ก่อน — ข้อผิดพลาดของรอบนี้)
-- คืนค่าตามที่เอกสาร docs/modules/oee.md บันทึกไว้ก่อนแก้
update public.dr_products set op_parent_mat = '10100385' where mat_no = '90031601';
update public.dr_products set op_parent_mat = '20065715' where mat_no = '90031602';

update public.prod_orders o set mat_no = b.mat_no
  from public.prod_orders_bak_laser345_20260915 b where b.id = o.id;
update public.downtime_logs d set mat_no = b.mat_no
  from public.downtime_bak_laser345_20260915 b where b.id = d.id;
update public.scrap_report_items s set mat_no = b.mat_no
  from public.scrap_items_bak_laser345_20260915 b where b.id = s.id;

-- ⚠️ ตาราง snapshot 4 ตัว (prod_orders_bak_laser345_20260915 · dr_products_bak_… ·
--    downtime_bak_… · scrap_items_bak_…) **ยังไม่ลบ** — เก็บไว้เผื่อทำรอบใหม่/ตรวจย้อน
--    ลบได้เมื่อ user เคาะทิศทางสุดท้ายของสายนี้แล้ว
