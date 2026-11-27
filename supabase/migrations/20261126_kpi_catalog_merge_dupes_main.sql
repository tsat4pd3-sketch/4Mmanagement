-- ═══ ยุบทะเบียน KPI ซ้ำที่หน่วยงานสร้างเอง → ตัวมาตรฐาน (2026-11-26 · user: "ย้ายเข้ามาตรฐานให้ได้มั้ย แต่ยังไม่ต้อง deploy")
-- project: MAIN (ewhdfqwfwofivojtsizn) · ⚠️ ข้อมูลล้วน ไม่แก้ schema · **มีผลบนบอร์ดทันทีที่รัน** (ไม่เกี่ยวกับ deploy โค้ด)
-- สถานะ: 📝 เขียนไว้ ยังไม่ apply — รอ user สั่ง (วันพรีเซนต์ 26/11)
--
-- อาการ: บอร์ด "ทั้งโรงงาน" ขึ้น MTTR 2 แผ่น · MTBF 2 แผ่น · Cost Reduction 3 แผ่น · DL+OH 2 แผ่น
-- เหตุ: บอร์ดจับกลุ่มหน่วยลูกตาม catalog_id (`rollupGroupKey` · utils/kpiRollup.js) — JIG MTN/ทีมช่างบางทีมสร้างชื่อทะเบียนของตัวเอง
-- แก้: ชี้ `kpi_definitions.catalog_id` ของแถวเหล่านั้นไปทะเบียนมาตรฐาน (ค่ารายเดือน/แผน/หมายเหตุ/เป้า/น้ำหนัก ผูกกับ def id ⇒ ไม่หาย)
--      แล้วปิดทะเบียนตัวซ้ำ (is_active=false · ไม่ลบ) · ปรับ "ป้ายหน่วย" ที่เขียนต่างกัน (Hr/Hrs/Hr./ชม. → Hrs.) **ไม่แปลงค่า**
-- ไม่แตะ (ต้องให้เจ้าของข้อมูลเคาะก่อน):
--   · Tooling MTN MTBF ป้ายหน่วย "Min" แต่ค่า 402–710 ≤ 730 ดูเป็นชั่วโมง — ไม่หาร 60 ไม่เปลี่ยนป้าย จนกว่า Tooling MTN ยืนยัน
--   · Cost Reduction ของ PD3/PD4 กรอก "พันบาท" ส่วน QA กรอก "บาท" (อยู่ทะเบียนเดียวกันอยู่แล้ว · เฉลี่ยข้ามหน่วยผิดอยู่ก่อนแล้ว)
--   · Inventory Balance (BIG/SMALL PRESS) ทะเบียนบอก "บาท" แถวบอก "Day" → ไปจัดการใน KPI-RAW-INPUT-DESIGN เฟส 0 (สลับเป็นสูตร)
-- unique index ที่ต้องไม่ชน: kpi_definitions_year_scope_catalog_uniq (year, scope, catalog_id) — เช็คแล้ว 26/11: ขอบเขตปลายทางไม่มีแถวบนทะเบียนเป้าหมาย

begin;

-- ── 1) MTTR / MTBF ของ JIG MTN → ทะเบียนมาตรฐาน (std_item_id ของแถวชี้ข้อ Maintenance 6/7 อยู่แล้ว) ──
update public.kpi_definitions set catalog_id = 'e02b2bb9-e59b-491e-9a7b-273c3b8c2f05'   -- Mean Time To repair (MTTR)
 where id = 'b4479725-98ad-49c2-80f6-bca725f9d7c9' and catalog_id = '28d2920c-a98e-4ec1-95c9-7c1a3a469ba6';
update public.kpi_definitions set catalog_id = '9c44da69-7256-4dfe-8cc1-b8879efb90cd'   -- Mean Time Between to Failure (MTBF)
 where id = '0fbe599d-8073-46ac-b7fd-16988ea0e8fc' and catalog_id = '6c34c319-d86d-48c9-9ffb-85525439cb35';

-- ── 2) "Direct Labour & Overhead Expenses" (Electric · Mechanic · Preventive) → DL+OH (Direct Labor + Overhead) ──
update public.kpi_definitions set catalog_id = '229debea-1877-47f0-ab7e-39fba2516edd'
 where catalog_id = '92f1364d-b186-4bc2-b570-f0fa82f981db'
   and id in ('a52f0bdf-a4e6-41f4-aca0-dca9bf29bd24', '4c8efcd9-5ee8-4604-91b4-562c68ccb8ff', '9f961a9c-d2f6-4388-a6ae-29eecca00278');

-- ── 3) Cost Reduction ของทีมช่าง → "Cost Reduction (MTN)" (ทะเบียนมาตรฐาน Maintenance ข้อ 8 · หน่วย THB = บาท) ──
--      JIG MTN "Cost Reduction" (บาท) + Tooling MTN "Cost Reduction 100P & CR (Tooling MTN)" (THB) · PD3/PD4/QA ยังอยู่ "Cost Reduction" (Production/QA std)
update public.kpi_definitions set catalog_id = 'a804b43b-7bc7-4a81-8e29-dbce10abeb47'
 where id = '4612a3ca-f0a3-46f3-a3a5-b03632b77442' and catalog_id = '5d4e64a8-cb0c-4f3f-b1c5-f004878ac28b';
update public.kpi_definitions set catalog_id = 'a804b43b-7bc7-4a81-8e29-dbce10abeb47'
 where id = '150be22f-28dc-422b-b3bc-718c47665aeb' and catalog_id = 'c7145c9f-b29c-4e7e-94c1-83ad11b9fe19';

-- ── 4) ป้ายหน่วยให้เขียนแบบเดียว (ป้ายล้วน ไม่แปลงค่า) ──
update public.kpi_catalog set unit = 'Hrs.' where id in ('e02b2bb9-e59b-491e-9a7b-273c3b8c2f05', '9c44da69-7256-4dfe-8cc1-b8879efb90cd') and unit is null;
update public.kpi_definitions set unit = 'Hrs.'
 where year = 2026 and catalog_id in ('e02b2bb9-e59b-491e-9a7b-273c3b8c2f05', '9c44da69-7256-4dfe-8cc1-b8879efb90cd')
   and unit in ('Hr', 'Hrs', 'Hr.', 'ชม.');          -- 'Min' ของ Tooling MTN จงใจไม่แตะ
update public.kpi_definitions set unit = 'วัน'
 where id = '0f19ab13-b011-4c58-8288-a35ea834842d' and unit = 'Day';   -- DSI PD1

-- ── 5) ปิดทะเบียนตัวซ้ำ (ไม่ลบ — ย้อนได้) ──
update public.kpi_catalog set is_active = false
 where id in ('28d2920c-a98e-4ec1-95c9-7c1a3a469ba6',   -- MTTR
              '6c34c319-d86d-48c9-9ffb-85525439cb35',   -- MTBF
              '92f1364d-b186-4bc2-b570-f0fa82f981db',   -- Direct Labour & Overhead Expenses
              'c7145c9f-b29c-4e7e-94c1-83ad11b9fe19',   -- Cost Reduction 100P & CR (Tooling MTN)
              '92e56ae9-1895-43db-8758-52068d983633')   -- Cost Reduction (Tooling MTN) (ว่าง)
   and not exists (select 1 from public.kpi_definitions d where d.catalog_id = kpi_catalog.id and d.is_active);

commit;

-- ── ตรวจผล (คาดหวัง: ทะเบียนที่ปิด 5 แถวไม่มีนิยาม active · MTTR std 5 หน่วย · MTBF std 5 · DL+OH 13 · CR (MTN) 5) ──
-- select c.name, count(d.id) from kpi_catalog c left join kpi_definitions d on d.catalog_id=c.id and d.year=2026 and d.is_active
--  where c.name in ('Mean Time To repair (MTTR)','Mean Time Between to Failure (MTBF)','DL+OH (Direct Labor + Overhead)','Cost Reduction (MTN)','Cost Reduction','MTTR','MTBF','Direct Labour & Overhead Expenses','Cost Reduction 100P & CR (Tooling MTN)')
--  group by c.name order by c.name;

-- ── ROLLBACK (รันเมื่อต้องการย้อน — ชี้กลับที่เดิมแล้วเปิดทะเบียนคืน) ──
-- update public.kpi_definitions set catalog_id='28d2920c-a98e-4ec1-95c9-7c1a3a469ba6', unit='ชม.' where id='b4479725-98ad-49c2-80f6-bca725f9d7c9';
-- update public.kpi_definitions set catalog_id='6c34c319-d86d-48c9-9ffb-85525439cb35', unit='ชม.' where id='0fbe599d-8073-46ac-b7fd-16988ea0e8fc';
-- update public.kpi_definitions set catalog_id='92f1364d-b186-4bc2-b570-f0fa82f981db' where id in ('a52f0bdf-a4e6-41f4-aca0-dca9bf29bd24','4c8efcd9-5ee8-4604-91b4-562c68ccb8ff','9f961a9c-d2f6-4388-a6ae-29eecca00278');
-- update public.kpi_definitions set catalog_id='5d4e64a8-cb0c-4f3f-b1c5-f004878ac28b' where id='4612a3ca-f0a3-46f3-a3a5-b03632b77442';
-- update public.kpi_definitions set catalog_id='c7145c9f-b29c-4e7e-94c1-83ad11b9fe19' where id='150be22f-28dc-422b-b3bc-718c47665aeb';
-- update public.kpi_definitions set unit='Hr'   where id='63a1fd1a-cb94-4936-b746-46cac43f5e86';
-- update public.kpi_definitions set unit='Hrs'  where id='13c26482-e57b-41bb-8dfd-38deb5bf3181';
-- update public.kpi_definitions set unit='Hr.'  where id='9cc8b34b-f1d3-42b9-b5b7-0796a110afd8';
-- update public.kpi_definitions set unit='Day'  where id='0f19ab13-b011-4c58-8288-a35ea834842d';
-- update public.kpi_catalog set unit=null where id in ('e02b2bb9-e59b-491e-9a7b-273c3b8c2f05','9c44da69-7256-4dfe-8cc1-b8879efb90cd');
-- update public.kpi_catalog set is_active=true where id in ('28d2920c-a98e-4ec1-95c9-7c1a3a469ba6','6c34c319-d86d-48c9-9ffb-85525439cb35','92f1364d-b186-4bc2-b570-f0fa82f981db','c7145c9f-b29c-4e7e-94c1-83ad11b9fe19','92e56ae9-1895-43db-8758-52068d983633');
