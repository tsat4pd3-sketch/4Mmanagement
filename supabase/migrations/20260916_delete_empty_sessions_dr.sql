-- ════════════════════════════════════════════════════════════════════════════
-- ล้าง "กะเปล่า" ใน production_sessions  (DR project — eyhclzkifitbhbljgoav "Product DB")
-- 2026-09-16 · คำสั่ง user: "ไล่ลบกะเปล่าให้ที"
--
-- ต้นเหตุ: หน้าเช็คชื่อ (Checkin.jsx) เคยเด้ง modal เสนอเปิดกะ Daily Report หลังกดบันทึก
--   โดย **ติ๊กไลน์ไว้ให้ครบทุกไลน์** กด "เปิดกะ" ครั้งเดียว = เปิดกะทุกไลน์ที่เช็คชื่อ
--   ⇒ ไลน์ที่ใช้ระบบเช็คชื่อแต่ยังไม่ลงข้อมูลผลิต (PD1: LINE GWM · LINE MAIN TSRA-1/2 ·
--   LINE SUB-STATIONARY) ได้กะเปล่าวันละ 1-2 ใบ ค้าง status='open' ไม่มีใครปิด
--   ลายเซ็นที่ยืนยันว่าเป็น modal ไม่ใช่คนกด: 4 ไลน์ถูกสร้างห่างกัน 0.35 วินาที ทุกวัน
--   → ตัวสร้างถูกถอดออกจาก Checkin.jsx แล้วในคอมมิทเดียวกัน (ไลน์ไปกดเปิดเองที่ Daily Report)
--
-- นิยาม "กะเปล่า" = ไม่มี prod_orders + ไม่มี downtime_logs + ไม่มี defect_logs
--   ตรวจแล้วว่าไม่มี kanban_targets / line_stock_transactions / ยอดใดๆ ผูกอยู่เลยสักใบ (0 ทั้งหมด)
--   ⇒ ลบแล้วไม่มี CASCADE ไปโดนข้อมูลจริง
--
-- 🔴 กันลบกะที่ "ยังทำงานอยู่": `work_date < work_date_bangkok()` เท่านั้น
--   กะที่เพิ่งเปิดต้นกะยังไม่สแกนใบแรก **หน้าตาเหมือนกะเปล่าเป๊ะ** — เช็คตอนเขียน migration นี้
--   (16/09 เวลา 08:19) มี 7 ไลน์ที่ทำงานจริง (Line 60/61 · HDF1 · LASER-345/E50 · SUB APRON ·
--   BENDING E50 — แต่ละไลน์มีกะจริงในประวัติ 24-96 กะ) เพิ่งเปิดกะ 08:11 และยังว่างอยู่
--   ลบไปคือทำงานหน้างานพังทั้ง 7 ไลน์ · `work_date_bangkok()` ตัดที่ 08:00 = จังหวะที่กะดึกของ
--   วันก่อนหน้าเพิ่งจบพอดี ⇒ ทุกกะที่ `work_date` น้อยกว่าค่านี้ จบไปแล้วแน่นอน
--   **ถ้าเอา migration นี้ไปรันซ้ำในอนาคต ห้ามถอดเงื่อนไขบรรทัดนี้ออก**
--
-- ผลข้างเคียงที่ตั้งใจ: กะเปล่าที่ลบมี oee_a/oee_q stamp ค้างอยู่ (A=100/Q=100 ของกะที่ไม่มีงาน)
--   ซึ่งรั่วเข้าค่าเฉลี่ย %A ในกราฟเทรนด์ — ลบแล้ว avg %A 91.12 → 90.16 (ตรงกับความจริงมากขึ้น)
--   สอดคล้องกฎเดิม `20260715_oee_null_noproduction_cleanup.sql`
--
-- 🔙 ROLLBACK: แถวที่ลบถูกสำเนาไว้ใน `production_sessions_empty_backup_20260916` ครบทุกคอลัมน์
--   คืนค่า:  insert into production_sessions
--              select (ไล่คอลัมน์ตามตารางจริง) from production_sessions_empty_backup_20260916;
--   (ลูกของมันไม่ต้องคืน เพราะไม่มีลูกอยู่แล้ว — นั่นคือเหตุผลที่มันถูกลบ)
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- 1) สำรองก่อนลบ (ตารางสำรองเก็บไว้ ไม่ drop — เป็นทางถอยและเป็นหลักฐานว่าลบอะไรไป)
create table if not exists production_sessions_empty_backup_20260916 as
select s.*, now() as _backed_up_at
from production_sessions s
where s.work_date < work_date_bangkok()
  and not exists (select 1 from prod_orders    o where o.session_id = s.id)
  and not exists (select 1 from downtime_logs  d where d.session_id = s.id)
  and not exists (select 1 from defect_logs    f where f.session_id = s.id);

-- 2) ลบกะเปล่า — เงื่อนไขเดียวกับตอนสำรองเป๊ะ
delete from production_sessions s
where s.work_date < work_date_bangkok()
  and not exists (select 1 from prod_orders    o where o.session_id = s.id)
  and not exists (select 1 from downtime_logs  d where d.session_id = s.id)
  and not exists (select 1 from defect_logs    f where f.session_id = s.id);

commit;
