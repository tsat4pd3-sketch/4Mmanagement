-- DR project ("Product DB" · eyhclzkifitbhbljgoav) · 2026-10-12 · audit SSOT ยอดสต็อก · user เคาะ "หักจากคลังที่ของอยู่จริง"
-- ปัญหา: ปิดล็อต/จ่ายวัตถุดิบ (HeijunkaKanban) ตัด consume ที่ไลน์ที่ใช้ (source_line ของล็อต) ทั้งที่ไม่มีใครจ่ายของเข้าไลน์นั้น
--   ⇒ ไลน์ที่ใช้ติดลบ (LINE C −21,600 ต่อชิ้นปั๊ม 3 ตัว · coil −21,513 …) ขณะที่คลังที่ของอยู่จริงไม่เคยลด
--   โค้ดแก้แล้ว: rawSourceLocOf + splitRawConsume (src/utils/partRefStock.js)
-- แก้ข้อมูล (เฉพาะหลังวันตั้งต้นยอด 01/10 · เฉพาะส่วนที่ทำให้ไลน์ติดลบ = ส่วนที่ไม่มีของจ่ายเข้าไลน์รองรับ):
--   ย้ายที่ตัดด้วยคู่ consume — ไลน์ที่ใช้ −X (คืนยอด) · คลังต้นทาง +X (ตัดที่นั่นแทน) · ไม่ลบแถวเดิม
--   คลังต้นทาง = กติกาเดียวกับ rawSourceLocOf: ล็อตสโตร์ → ไลน์ที่ผลิต · มีกฎรับเข้า → คลังตามกฎ · 3xx/5xx → STORE
with lots as (select distinct trim(child_mat_no) m from public.child_lot_requests where status <> 'cancelled'),
rules as (select match_value v, dest_line_name d from public.stock_inflow_rules where is_active and match_type = 'prefix'),
t as (
  select t.line_name, t.mat_no, max(t.part_name) part_name, sum(t.qty) q,
    (select p.line_name from public.dr_products p where p.mat_no = t.mat_no and p.is_active and not coalesce(p.is_operation, false) limit 1) prod_line,
    (select d from rules where t.mat_no like v || '%' order by length(v) desc limit 1) dest
  from public.line_stock_transactions t
  where t.type = 'consume' and t.status = 'approved' and t.note like 'auto: ใช้ผลิต %(ล็อต%'
    and t.created_at > '2026-10-01 04:30:43+00'
  group by t.line_name, t.mat_no),
r as (
  select t.*, case when prod_line is not null and t.mat_no in (select m from lots) then prod_line
                   when dest is not null then dest
                   when t.mat_no ~ '^[35]' then 'STORE' else t.line_name end loc,
         (select s.qty_on_hand from public.line_stock_summary s where s.line_name = t.line_name and s.mat_no = t.mat_no) now_qty
  from t),
mv as (
  select line_name, loc, mat_no, part_name, least(q, -now_qty) x from r
  where loc <> line_name and now_qty < 0
    and not exists (select 1 from public.line_stock_transactions z where z.note like 'auto: ย้ายที่ตัดวัตถุดิบล็อต (audit 12/10)%' and z.mat_no = r.mat_no)
)
insert into public.line_stock_transactions (line_name, mat_no, part_name, qty, type, status, work_date, note, created_by)
select line_name, mat_no, part_name, -x, 'consume', 'approved', date '2026-10-12',
       'auto: ย้ายที่ตัดวัตถุดิบล็อต (audit 12/10) → ' || loc, 'system (audit 12/10)' from mv
union all
select loc, mat_no, part_name, x, 'consume', 'approved', date '2026-10-12',
       'auto: ย้ายที่ตัดวัตถุดิบล็อต (audit 12/10) · ใช้ที่ ' || line_name, 'system (audit 12/10)' from mv;

-- เช็คผล: select line_name, mat_no, qty, note from line_stock_transactions where note like 'auto: ย้ายที่ตัดวัตถุดิบล็อต (audit 12/10)%' order by mat_no;
-- ย้อน:   delete from line_stock_transactions where note like 'auto: ย้ายที่ตัดวัตถุดิบล็อต (audit 12/10)%';
