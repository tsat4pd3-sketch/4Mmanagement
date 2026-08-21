-- 🚨 v_store_abnormal — เคสผิดปกติฝั่ง Store แหล่งเดียวของทั้งระบบ  (DR) · apply แล้ว 2026-08-21
--
-- ที่มา (audit 2026-08-21): เงื่อนไขตรวจ 5 เคสเดิมอยู่ใน StoreMonitor.jsx อย่างเดียว
--   → ตัวแจ้งเตือน (edge store-daily-scan) ต้อง copy เงื่อนไขไปเขียนใหม่ = drift แน่นอน
--   ย้ายมาเป็นวิวใน DB แล้วให้ทั้งหน้าและตัวสแกนอ่านตัวเดียวกัน
--
-- ⚠️ แก้เกณฑ์ตรวจให้แก้ที่วิวนี้ที่เดียว ห้ามเขียนเงื่อนไขซ้ำในหน้า/ใน edge
-- ผลจริงตอน apply: A=33 · B=14 · E=42 (C/D ยังไม่ขึ้นเพราะข้อมูลรอบส่งภายในยังบาง)

create or replace view public.v_store_abnormal as
with wd as (
  select case when extract(hour from (now() at time zone 'Asia/Bangkok')) < 8
              then ((now() at time zone 'Asia/Bangkok')::date - 1)
              else (now() at time zone 'Asia/Bangkok')::date end as work_date,
         (extract(hour from (now() at time zone 'Asia/Bangkok'))*60
          + extract(minute from (now() at time zone 'Asia/Bangkok')))::int as now_min
),
-- #A ต่ำกว่า Min · #B เกิน Max
ab as (
  select case when s.qty_on_hand < k.min_qty then 'shortage' else 'over' end as kind,
         case when s.qty_on_hand < k.min_qty then 'A' else 'B' end as code,
         case when s.qty_on_hand < k.min_qty then 'ต่ำกว่า Min' else 'เกิน Max (ล้น)' end as title,
         s.line_name, s.mat_no, coalesce(s.part_name, k.part_name) as part_name,
         case when s.qty_on_hand < k.min_qty
              then 'คงเหลือ '||round(s.qty_on_hand)||' < Min '||round(k.min_qty)||' — ต้องเติมก่อนขาด'
              else 'คงเหลือ '||round(s.qty_on_hand)||' > Max '||round(k.max_qty)||' — จ่ายเกิน/สั่งเกิน' end as detail,
         case when s.qty_on_hand <= 0 then 3 when s.qty_on_hand < k.min_qty then 2 else 1 end as sev
  from line_stock_summary s
  join kanban_standards k on k.mat_no = s.mat_no and k.is_active
  where (k.min_qty > 0 and s.qty_on_hand < k.min_qty)
     or (k.max_qty > 0 and s.qty_on_hand > k.max_qty)
),
-- #C รอบส่งภายในเลยเวลายังไม่ยืนยัน (เฉพาะรอบกลางวัน — กะดึกข้ามวันเป็นเฟสถัดไป)
c as (
  select 'shortage' kind, 'C' code, 'รอบส่งเลยเวลา' title, r.line_name, null::text mat_no,
         'รอบ '||r.round_no||' · '||r.shift as part_name,
         'กำหนดส่ง '||r.delivery_time||' ผ่านมาแล้วยังไม่ยืนยันส่ง' as detail, 3 sev
  from kanban_delivery_rounds r, wd
  where r.is_active and r.delivery_time is not null
    and extract(hour from r.delivery_time) < 20
    and wd.now_min > (extract(hour from r.delivery_time)*60 + extract(minute from r.delivery_time)
                      + coalesce(r.points_count,0) * coalesce(r.time_per_point_min,0))
    and not exists (
      select 1 from kanban_deliveries d
       where d.work_date = wd.work_date and d.line_name = r.line_name
         and d.shift = r.shift and d.round_no = r.round_no and d.confirmed_at is not null)
),
-- #D รับไม่ครบ
d as (
  select 'shortage' kind, 'D' code, 'รับไม่ครบ' title, k.line_name, null::text mat_no,
         'รอบ '||k.round_no||' · '||k.shift as part_name,
         'ไลน์ยืนยัน "รับไม่ครบ" — ของขาดที่ไลน์' as detail, 2 sev
  from kanban_deliveries k, wd
  where k.work_date = wd.work_date and k.received_status = 'partial'
),
-- #E ใบสั่งซื้อค้างเกินวันกำหนด (ยังไม่รับเข้า) · ยกเลิกแล้วไม่นับ
e as (
  select 'shortage' kind, 'E' code, 'สั่งซื้อค้าง (ยังไม่รับ)' title,
         p.dest_line as line_name, p.mat_no, p.part_name,
         (case when p.status='ordered' then 'สั่งแล้ว' else 'รอสั่ง' end)
           ||'ตั้งแต่ '||coalesce(p.work_date::text, p.created_at::date::text)
           ||' ยังไม่รับเข้า'||coalesce(' · '||p.supplier,'') as detail, 2 sev
  from purchase_requests p, wd
  where p.status in ('pending','ordered')
    and coalesce(p.work_date, p.created_at::date) < wd.work_date
)
select * from ab union all select * from c union all select * from d union all select * from e;

grant select on public.v_store_abnormal to anon, authenticated;

-- Rollback: drop view public.v_store_abnormal;
--   (ต้อง revert StoreMonitor.jsx กลับไปคิดเงื่อนไขเองก่อน ไม่งั้นหน้าเฝ้าระวังว่างเปล่า)
