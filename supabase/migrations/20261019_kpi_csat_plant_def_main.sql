-- 2026-10-19 · MAIN (ewhdfqwfwofivojtsizn) · Customer Satisfaction "ค่าโรงงาน" ไม่มีนิยามระดับโรงงาน ⇒ ทุกส่วนงานขึ้นว่าง (user: "เคยกรอกไปแล้วทำไมไม่ขึ้น")
-- ลำดับเหตุการณ์ (audit_log): 23/09 PD4 กรอก ม.ค.-ส.ค. ลงนิยามของตัวเอง (ตอนนั้น value_scope=own) → 30/09 ทะเบียน kpi_catalog 9a7e3d90 ถูกตั้ง own→plant
-- โดยไม่มีนิยาม scope_kind='plant' รองรับ → sharedValueDef() คืน null → จอทุกหน่วยขึ้น "ยังไม่มีนิยามระดับโรงงาน" และค่าของ PD4 ถูกซ่อน
-- (14/10 ทีมพยายามสร้าง "Customer Satisfaction (Q&D)" ระดับโรงงานเอง แต่ catalog_id ว่าง จึงไม่ผูก แล้วถูกปิด 15/10)
-- การแก้ (apply แล้ว 19/10 ผ่าน MCP · data-only ย้อนได้):
--   1) สร้างนิยามระดับโรงงาน id 5c5a7e3d-9a7e-4c5a-8e3d-20261019c5a7 (โคลนเป้า/commit จากนิยาม PD4 · catalog 9a7e3d90)
--   2) ย้าย kpi_manual_entries 8 แถวของ PD4 (a9651005) → นิยามโรงงาน (CSat เป็นตัวเลขระดับโรงงานอยู่แล้ว)
-- ฝั่งโค้ด (commit เดียวกัน): เปลี่ยน value_scope เป็น plant จะสร้างนิยามโรงงานให้เอง + จอ ทั้งโรงงาน เตือนทะเบียนที่ยังขาด
begin;
insert into public.kpi_definitions (id, year, section, category, seq, name, scope_text, commitment, target, target_value, direction, source, is_active, catalog_id, scope_kind, scope_value, commit_compare, commit_value, target_compare, unit, provider)
select '5c5a7e3d-9a7e-4c5a-8e3d-20261019c5a7', 2026, null, 'customer', 21, 'Customer Satisfaction',
       'ค่าโรงงาน (value_scope=plant) — สร้าง 19/10 จากนิยาม PD4 เพราะทะเบียนถูกตั้งเป็นค่าโรงงานตั้งแต่ 30/09 โดยไม่มีนิยามระดับโรงงาน · ค่า ม.ค.-ส.ค. ย้ายมาจาก PD4',
       '≥95%', '100%', 100, 'up', 'manual', true, '9a7e3d90-fce1-4884-a56a-0b8c44be01e4', 'plant', null, '>=', 95, '>=', '%', 'manual'
where not exists (select 1 from public.kpi_definitions where catalog_id='9a7e3d90-fce1-4884-a56a-0b8c44be01e4' and scope_kind='plant' and is_active and year=2026);
update public.kpi_manual_entries set kpi_id='5c5a7e3d-9a7e-4c5a-8e3d-20261019c5a7'
 where kpi_id='a9651005-a5c5-481d-a8cd-ccbdf95ea779'
   and not exists (select 1 from public.kpi_manual_entries x where x.kpi_id='5c5a7e3d-9a7e-4c5a-8e3d-20261019c5a7' and x.month=kpi_manual_entries.month);
commit;
-- ตรวจ: select scope_kind, scope_value, (select count(*) from kpi_manual_entries e where e.kpi_id=d.id) from kpi_definitions d where catalog_id='9a7e3d90-fce1-4884-a56a-0b8c44be01e4' and year=2026;
--   คาด plant = 8 · PD4 = 0
-- rollback: update kpi_manual_entries set kpi_id='a9651005-a5c5-481d-a8cd-ccbdf95ea779' where kpi_id='5c5a7e3d-9a7e-4c5a-8e3d-20261019c5a7';
--           update kpi_definitions set is_active=false where id='5c5a7e3d-9a7e-4c5a-8e3d-20261019c5a7';
