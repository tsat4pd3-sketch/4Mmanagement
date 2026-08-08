-- ── DR project (eyhclzkifitbhbljgoav) ──
-- ตัวตนของอุปกรณ์ (asset identity) ต้อง unique — เตรียมรับระบบ QR/บาร์โค้ด
--
-- ทำไม: ป้าย QR ที่พิมพ์ติดเครื่อง/จิ๊กจะอยู่หน้างานเป็นปี ถ้าเลขเครื่องซ้ำกันได้
-- การสแกนจะ resolve ไม่ชัดเจน (เจอ 2 แถว เลือกไม่ถูก) และคนหน้างานอ่านป้ายแล้วสับสน
--
-- สถานะข้อมูลจริงตอนเขียน migration (ตรวจ 2026-08-03):
--   • machines: active 209 แถว — machine_no ไม่ซ้ำเลย (ทั้งระบบและในไลน์เดียวกัน) และไม่มีค่าว่าง
--     ที่เคยเห็น "ซ้ำ 13 เลข" มาจากแถวที่ปิดใช้งานแล้ว (soft-delete) ทั้งหมด → ไม่ต้องแก้ข้อมูล
--   • jigs: jig_no ที่กรอกแล้ว 7 แถว ไม่ซ้ำ · ยังว่าง 28 แถว (จิ๊ก/DIE จริงอีก 300-400 ตัวยังไม่ลงข้อมูล)
--
-- index เป็นแบบ partial → บังคับเฉพาะแถวที่ "ใช้งานอยู่ + มีเลข" เท่านั้น:
--   - แถวที่ปิดใช้งานแล้ว (ประวัติ) ยังเก็บเลขเดิมซ้ำได้ ไม่ต้องไปยุ่งกับข้อมูลเก่า
--   - แถวที่ยังไม่กรอกเลข (jig_no ว่าง) ยังบันทึกได้ตามปกติ ไม่บล็อกการทยอยลงข้อมูล
-- PURELY ADDITIVE — ไม่ลบ/ไม่แก้ข้อมูลเดิมแม้แต่แถวเดียว

-- 1) เลขเครื่องจักรที่ใช้งานอยู่ ห้ามซ้ำ
create unique index if not exists machines_machine_no_active_uniq
  on machines (machine_no)
  where is_active and machine_no is not null and btrim(machine_no) <> '';

-- 2) เลขจิ๊ก/แม่พิมพ์ที่กรอกแล้ว ห้ามซ้ำ (jigs ไม่มีคอลัมน์ is_active — บังคับเฉพาะแถวที่มีเลข)
create unique index if not exists jigs_jig_no_uniq
  on jigs (jig_no)
  where jig_no is not null and btrim(jig_no) <> '';

-- หมายเหตุ: dr_products.mat_no / parts_master.mat_no / kanban_standards.mat_no
-- มี unique constraint อยู่แล้ว (…_mat_no_key) → ใช้ mat_no เป็นตัวตนของสินค้าใน QR ได้เลย
