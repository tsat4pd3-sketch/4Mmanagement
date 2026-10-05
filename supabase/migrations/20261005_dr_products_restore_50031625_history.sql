-- ═══ คืนทะเบียน "ประวัติ" ของพาร์ท 50031625 — ไม่ให้ใบเก่า/ประวัติกำพร้า (2026-10-05 · คำสั่ง user) ═══
-- DR project · ชื่อในจอ Supabase "Product DB" · id eyhclzkifitbhbljgoav   (**apply แล้ว 2026-10-05**)
--
-- เกิดอะไรขึ้น (ไล่จาก audit_log ทั้งหมด ไม่ได้เดา):
--   16/07  สร้างแถวพาร์ท id b5015291-fff6-40c3-8c17-8619e112a5f7
--   14/08  ชลทิตย์ เปลี่ยน mat_no  50029377 -> 50031625
--   30/09  หน้างานเริ่มสแกนชื่อใหม่ "BENDING LWR BAR 306" (วันนั้นมีทั้ง 2 ชื่อ)
--   01/10  ADMIN เปลี่ยน mat_no ของ "แถวเดิม" 50031625 -> BENDING LWR BAR 306 + ตั้งเป็นชั้น OP
--          => ตั้งใจและตรงกับของจริง แต่ทำให้ "ชื่อเดิม" ไม่มีทะเบียนอีกเลย
--
-- 🔴 คลาสบั๊ก: **เปลี่ยน `mat_no` ของพาร์ท = ทุกอย่างที่อ้างชื่อเดิมกำพร้าทันทีแบบเงียบๆ**
--    (ใบผลิต · ของเสีย · kanban_standards · line_stock · PE doc set · BOM — ทั้งหมด join ด้วย mat_no เป็น text)
--    ที่เห็นผลชัดสุดคือ `ctForMat()` คืน 0 => คำนวณ %P ของกะเก่าไม่ได้ (13 กะ Laser LWR)
--
-- แก้: เพิ่มแถว "รุ่นที่ถูกแทนที่แล้ว" ของชื่อเดิม ด้วยค่าจาก audit snapshot ก่อนเปลี่ยนชื่อ (ไม่ได้แต่งเอง)
--   · is_active = false  => <ProductSelect> ตัดออกจาก dropdown ให้อยู่แล้ว (ค่าที่เลือกไว้แล้วยังโชว์ ⏸)
--   · family_id เดิม + superseded_at/superseded_by = ใช้กลไก "รุ่นของพาร์ท" ที่ schema มีอยู่แล้ว
--     (ในฐานมีแถวที่ใช้กลไกนี้อยู่ก่อน 3 แถว — ไม่ได้คิดรูปแบบใหม่)
--   · code = null ตั้งใจ — ไม่ให้ซ้ำกับแถวปัจจุบัน ('LWR306') ในจอที่ค้นด้วย code
--
-- ROLLBACK:  delete from public.dr_products where mat_no = '50031625' and is_active = false;
-- ═══════════════════════════════════════════════════════════════════════════════════════

insert into public.dr_products (
  id, mat_no, name, p_no, customer, line_name, process_type,
  cycle_time_sec, pair_mat_no, is_operation, op_parent_mat, op_seq,
  posting_mode, lot_accumulate_threshold, target_per_shift, image_url,
  family_id, is_active, superseded_at, superseded_by, code, updated_by_name
)
select
  gen_random_uuid(), '50031625',
  'WSS-M1A367-A36 1.5X(43X65)X1186', 'MB3B 8B222 BF', 'ASSY LWRBAR', 'Laser LWR', 'metal_forming',
  59, null, false, null, null,
  'lot_accumulate', 560, 560,
  'https://eyhclzkifitbhbljgoav.supabase.co/storage/v1/object/public/product-images/1784186108065.jpg',
  '10ea5b49-8a4f-4ad6-8230-47b51c451a1a'::uuid, false, date '2026-10-01',
  'b5015291-fff6-40c3-8c17-8619e112a5f7'::uuid, null,
  'ระบบ: คืนทะเบียนประวัติ (ชื่อเดิมก่อนเปลี่ยนเป็น BENDING LWR BAR 306)'
where not exists (select 1 from public.dr_products where mat_no = '50031625');
