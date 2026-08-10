-- จัดชนิดอุปกรณ์ + ตั้งชุดแม่พิมพ์จากข้อมูลที่มีอยู่ — DR project (2026-08-10)
--
-- ที่มา: ฐาน `machines` มี 505 แถว active แต่ **262 แถวเป็นแม่พิมพ์ ไม่ใช่เครื่องจักร**
--   (ถูกคีย์ปนเข้ามาเพราะไม่เคยมีแกน "ชนิด") → ทะเบียนเครื่องจักรอ่านไม่รู้เรื่อง
--
-- ⚠️ เลือก **"ติดป้าย" ไม่ใช่ "ย้ายตาราง"** โดยตั้งใจ
--   ตรวจแล้วว่าแม่พิมพ์ 262 แถวไม่มีการอ้างอิงจาก mtn_orders / downtime_logs / prod_orders เลย
--   แต่ถึงอย่างนั้นการย้ายตารางก็ทำให้ machine_id ที่ QR/ผัง/ส่วนขยายอ้างอยู่กำพร้าได้
--   การติดป้ายเปลี่ยนแค่ "มุมมอง" — reference ทุกเส้นยังอยู่ครบ · rollback = set null กลับ
--
-- ⚠️ ฟิลด์ที่แกะจากชื่อไม่ออก **ปล่อยว่าง ห้ามเดา** (ชื่อแม่พิมพ์ในข้อมูลจริงเขียนไม่เป็นแบบเดียวกัน)
--   ผลจริงหลังรัน: OP 213/213 (100%) · part_no ~86% · tonnage (progressive) 100%
--   ที่เหลือให้คนเติมเองในหน้าทะเบียนแม่พิมพ์

-- ── 1) ติดป้ายชนิด ────────────────────────────────────────────────────────
-- facility ก่อน (แกน equipment_category เป็นตัวชี้ที่แน่นอนกว่าชื่อ)
update machines set equipment_kind = 'facility'
where equipment_kind is null and equipment_category in ('facility','utility');

-- แม่พิมพ์: ชื่อ/ชนิดบอกว่าเป็น DIE/แม่พิมพ์/ทูลลิ่ง
update machines set equipment_kind = 'die'
where equipment_kind is null
  and (   machine_no ilike 'DIE%' or machine_no ilike '%-DIE-%'
       or machine_name ilike '%DIE%' or machine_name ilike '%แม่พิมพ์%'
       or machine_type ilike '%die%' );

-- จิ๊ก/ฟิกเจอร์
update machines set equipment_kind = 'jig'
where equipment_kind is null
  and (machine_no ilike 'JIG%' or machine_name ilike '%JIG%' or machine_name ilike '%FIXTURE%');

-- ที่เหลือ = เครื่องจักร (ค่าเดิมโดยปริยาย — เขียนให้ชัดเพื่อให้ตัวกรองนับได้)
update machines set equipment_kind = 'machine' where equipment_kind is null;

-- ── 2) สร้างชุดแม่พิมพ์จากพาร์ท + สร้างส่วนขยายให้แม่พิมพ์ทุกตัว ──────────
-- แถวส่วนขยายต้องมีก่อน ค่อยผูกชุด (แยกชุดผิดแก้ทีหลังได้ แต่แถวหายแก้ยากกว่า)
insert into equipment_die (machine_id)
select id from machines where equipment_kind = 'die'
on conflict (machine_id) do nothing;

-- ผลรันจริง 2026-08-10: machine 214 / die 262 / facility 29 / ไม่ระบุ 0
--   ชุดแม่พิมพ์ 92 ชุด (tandem 52 · progressive 26 · single 14) · ผูกแล้ว 259/262
--   เหลือ 3 ตัวที่ชื่อแกะไม่ออก → เติมมือในหน้าทะเบียน
--   mat_no ผูกได้ 1/92 ชุด — **เป็นช่องว่างของข้อมูล ไม่ใช่บั๊ก**
--   (Product Master มีสินค้าแค่ 36 รายการ ไลน์ปั๊มยังไม่เคยลงข้อมูล)
--   → ผูก mat_no ที่หน้าทะเบียนแม่พิมพ์เมื่อ Product Master ครบ

-- rollback:
--   update machines set equipment_kind = null;
--   delete from equipment_die;  delete from die_sets;
