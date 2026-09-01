-- v_store_abnormal v3 — เคส E รวมยอด "รายพาร์ท" ห้ามโชว์รายใบ (2026-08-25 · ตามหลังผล apply v2)
-- Project: DR (eyhclzkifitbhbljgoav) · รันซ้ำได้
--
-- ที่มา: apply v2 แล้ววัดจริงได้ E = 2,336 แถว — ใบสั่งซื้อจากทริกเกอร์ (~25 พาร์ท × MAX_LOTS ต่อรอบ)
-- ถูกนับรายใบ → จอเฝ้าระวังกลายเป็นกำแพงใบ + สรุป Telegram รายวันท่วม
-- = ปัญหา class เดียวกับบอร์ดจัดซื้อที่แก้ด้วย v_purchase_open_summary (กฎเหล็ก 2 ของบอร์ดสโตร์:
--   "คิวที่ระบบออกใบอัตโนมัติ ต้องรวมยอดรายพาร์ท ห้ามโชว์รายใบ")
-- → เคส E จัดกลุ่มต่อ (mat, ปลายทาง, สถานะ): จำนวนใบ + ชิ้นรวม + ค้างตั้งแต่ใบเก่าสุด
--   (คอลัมน์/ลำดับของวิวเดิมไม่เปลี่ยน — จอ StoreMonitor/edge อ่านต่อได้ทันที)

create or replace view public.v_store_abnormal as
with wd as (
  select case when extract(hour from (now() at time zone 'Asia/Bangkok')) < 8
              then ((now() at time zone 'Asia/Bangkok')::date - 1)
              else (now() at time zone 'Asia/Bangkok')::date end as work_date,
         (((extract(hour from (now() at time zone 'Asia/Bangkok'))*60
            + extract(minute from (now() at time zone 'Asia/Bangkok')))::int - 480 + 1440) % 1440) as now_frame_min
),
stock_mat as (
  select s.mat_no,
         sum(coalesce(s.qty_on_hand, 0)) as qty,
         max(s.part_name) as part_name,
         string_agg(s.line_name || ' ' || round(coalesce(s.qty_on_hand,0)), ' · '
                    order by coalesce(s.qty_on_hand,0) desc) as breakdown
    from line_stock_summary s
   group by s.mat_no
),
ab as (
  select case when m.qty < k.min_qty then 'shortage' else 'over' end as kind,
         case when m.qty < k.min_qty then 'A' else 'B' end as code,
         case when m.qty < k.min_qty then 'ต่ำกว่า Min' else 'เกิน Max (ล้น)' end as title,
         null::text as line_name, m.mat_no, coalesce(m.part_name, k.part_name) as part_name,
         case when m.qty < k.min_qty
              then 'คงเหลือรวมทุกคลัง '||round(m.qty)||' < Min '||round(k.min_qty)||' — ต้องเติมก่อนขาด ('||m.breakdown||')'
              else 'คงเหลือรวมทุกคลัง '||round(m.qty)||' > Max '||round(k.max_qty)||' — จ่ายเกิน/สั่งเกิน ('||m.breakdown||')' end as detail,
         case when m.qty <= 0 then 3 when m.qty < k.min_qty then 2 else 1 end as sev
  from stock_mat m
  join kanban_standards k on k.mat_no = m.mat_no and k.is_active
  where (k.min_qty > 0 and m.qty < k.min_qty)
     or (k.max_qty > 0 and m.qty > k.max_qty)
),
c as (
  select 'shortage' kind, 'C' code, 'รอบส่งเลยเวลา' title, r.line_name, null::text mat_no,
         'รอบ '||r.round_no||' · '||r.shift as part_name,
         'กำหนดส่ง '||r.delivery_time||' ผ่านมาแล้วยังไม่ยืนยันส่ง' as detail, 3 sev
  from kanban_delivery_rounds r, wd
  where r.is_active and r.delivery_time is not null
    and wd.now_frame_min > (
          ((extract(hour from r.delivery_time)*60 + extract(minute from r.delivery_time))::int
             + case when extract(hour from r.delivery_time) < 8 then 1440 else 0 end - 480)
          + coalesce(nullif(r.points_count, 0), 1) * coalesce(nullif(r.time_per_point_min, 0), 10))
    and not exists (
      select 1 from kanban_deliveries d
       where d.work_date = wd.work_date and d.line_name = r.line_name
         and d.shift = r.shift and d.round_no = r.round_no and d.confirmed_at is not null)
),
d as (
  select 'shortage' kind, 'D' code, 'รับไม่ครบ' title, k.line_name, null::text mat_no,
         'รอบ '||k.round_no||' · '||k.shift as part_name,
         'ไลน์ยืนยัน "รับไม่ครบ" — ของขาดที่ไลน์' as detail, 2 sev
  from kanban_deliveries k, wd
  where k.work_date = wd.work_date and k.received_status = 'partial'
),
-- #E สั่งซื้อค้างเกินวันกำหนด — รวมรายพาร์ท×ปลายทาง×สถานะ (1 พาร์ทแตกเป็นพันใบจากทริกเกอร์ได้)
e as (
  select 'shortage' kind, 'E' code, 'สั่งซื้อค้าง (ยังไม่รับ)' title,
         p.dest_line as line_name, p.mat_no, max(p.part_name) as part_name,
         (case when p.status='ordered' then 'สั่งแล้ว' else 'รอสั่ง' end)
           ||' '||count(*)||' ใบ · รวม '||round(sum(p.qty))||' ชิ้น'
           ||' · ค้างตั้งแต่ '||min(coalesce(p.work_date, p.created_at::date))::text
           ||coalesce(' · '||max(p.supplier), '') as detail,
         2 sev
  from purchase_requests p, wd
  where p.status in ('pending','ordered')
    and coalesce(p.work_date, p.created_at::date) < wd.work_date
  group by p.dest_line, p.mat_no, p.status
)
select * from ab union all select * from c union all select * from d union all select * from e;

grant select on public.v_store_abnormal to anon, authenticated;

-- ตรวจหลังรัน: select code, count(*) from v_store_abnormal group by 1 order by 1;
--   (E ควรยุบจาก ~2,336 เหลือหลักสิบ = จำนวนพาร์ท×ปลายทาง ไม่ใช่จำนวนใบ)
-- Rollback: รันไฟล์ 20260825_store_abnormal_frame_aware.sql (v2)
