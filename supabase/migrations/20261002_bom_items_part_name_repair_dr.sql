-- ════════════════════════════════════════════════════════════════════════════
-- DR project (ชื่อในจอ Supabase = "Product DB" · eyhclzkifitbhbljgoav)
-- ซ่อมชื่อพาร์ทในใบ BOM ที่ถูกเขียนเป็น "เลข MAT" (บั๊กจริง 2026-10-02)
--
-- ต้นเหตุ: ตัวแกะไฟล์ SAP จับหัวคอลัมน์ "Object description" ไม่ได้ (หัว `Obj` ชนะไปก่อน)
--          ⇒ ทุกแถวได้ part_name = '' แล้วโค้ดนำเข้าเขียน `part_name || mat_no` ลงฐาน
--          ⇒ ใบ 10102017 ขึ้นชื่อเป็นเลขทั้ง 7 แถว **โดยไม่มี error สักบรรทัด**
--          (แก้ที่ต้นเหตุแล้ว: src/utils/sapBomImport.js + ด่าน regressionGuards)
--
-- วิธีซ่อม: เอาชื่อจาก "ทะเบียนพาร์ท" (parts_master) ซึ่งคนดูแลเอง = แหล่งความจริงของชื่อ
--          แตะเฉพาะแถวที่ part_name ยังเท่ากับ mat_no เป๊ะๆ (idempotent · รันซ้ำได้)
-- ย้อนกลับ: ค่าเดิมคือ "เลข mat_no ของแถวนั้นเอง" ⇒ ย้อนได้ด้วย
--          update public.bom_items set part_name = mat_no where id in (<id ที่ถูกแก้>);
--          (ไม่ทำตารางสำรอง เพราะค่าเดิมคำนวณกลับได้ 100% ไม่มีข้อมูลสูญหาย)
-- ════════════════════════════════════════════════════════════════════════════

update public.bom_items b
   set part_name = p.part_name,
       updated_at = now()
  from public.parts_master p
 where btrim(p.mat_no) = btrim(b.mat_no)
   and btrim(coalesce(b.part_name, '')) = btrim(b.mat_no)       -- แตะเฉพาะแถวที่ชื่อเป็นเลข
   and btrim(coalesce(p.part_name, '')) <> btrim(p.mat_no)      -- ทะเบียนต้องมีชื่อจริง ไม่ใช่เลขซ้ำ
   and btrim(coalesce(p.part_name, '')) <> '';

-- ตรวจผล: ต้องเหลือ 0 แถว (ฝั่ง parts_master ที่ชื่อยังเป็นเลข = คนต้องไปตั้งชื่อเอง ไม่ใช่งานของ migration)
-- select mat_no, part_name from public.bom_items where btrim(coalesce(part_name,'')) = btrim(mat_no);
