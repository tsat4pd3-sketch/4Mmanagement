-- v_store_abnormal v2 — แก้ 3 ข้อจาก QC flow-audit 2026-08-25 (#26 แดง · #27 · #32)
-- Project: DR (eyhclzkifitbhbljgoav) · รันซ้ำได้ (create or replace view)
--
-- #26 (แดง) เคส C ไม่ frame-aware: รอบหลังเที่ยงคืน (delivery 00:00-07:59 = กะดึกข้ามวันของกรอบ 08:00→08:00)
--   ผ่านตัวกรอง hour<20 แล้วถูกเทียบนาฬิกาแบบ wall-clock → ตอนบ่ายขึ้น "เลยเวลา" ปลอมทั้งที่รอบนั้น
--   ยังมาไม่ถึงในกรอบวันงานนี้ → เทียบเป็น "นาทีบนกรอบ 08:00→08:00" เหมือน getRoundStatus (client)
--   ผลพลอยได้: รอบกะดึก (20:00+) ที่เดิมถูกตัดทิ้ง ("เฟสถัดไป") ตอนนี้ตรวจได้ถูกต้องด้วย
-- #27 เคส A/B: min/max เป็นค่า "ต่อ mat" แต่เดิมเทียบกับ on-hand "ต่อ (line,mat)" → mat เดียว
--   กระจาย 2 คลังแจ้งซ้ำ/แจ้งผิด + แถว net 0 ค้างยิง sev 3 รายวัน → รวม on-hand ต่อ mat ก่อนเทียบ
--   (กติกาเดียวกับ DeptDashboard StoreView "รวม on-hand ต่อ mat แล้วเทียบ Min/Max")
--   · line_name ของแถว A/B = null (รวมทุกคลัง) — breakdown รายคลังอยู่ใน detail
-- #32 นิยาม dwell เคส C ต้องตรง getRoundStatus: (points_count || 1) × (time_per_point_min || 10)
--   (เดิม coalesce(...,0) → รอบที่ไม่ตั้งค่า = เตือนทันทีตอนถึงเวลาส่งเป๊ะ เร็วกว่าจอ)

create or replace view public.v_store_abnormal as
with wd as (
  select case when extract(hour from (now() at time zone 'Asia/Bangkok')) < 8
              then ((now() at time zone 'Asia/Bangkok')::date - 1)
              else (now() at time zone 'Asia/Bangkok')::date end as work_date,
         -- นาทีบนกรอบวันงาน 08:00→08:00 (0 = 08:00 · 1439 = 07:59 วันถัดไป)
         (((extract(hour from (now() at time zone 'Asia/Bangkok'))*60
            + extract(minute from (now() at time zone 'Asia/Bangkok')))::int - 480 + 1440) % 1440) as now_frame_min
),
-- #A ต่ำกว่า Min · #B เกิน Max — เทียบระดับ mat (รวมทุกคลัง)
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
-- #C รอบส่งเลยเวลายังไม่ยืนยัน — เทียบบนกรอบ 08:00→08:00 (สูตรเดียวกับ getRoundStatus ฝั่งจอ)
c as (
  select 'shortage' kind, 'C' code, 'รอบส่งเลยเวลา' title, r.line_name, null::text mat_no,
         'รอบ '||r.round_no||' · '||r.shift as part_name,
         'กำหนดส่ง '||r.delivery_time||' ผ่านมาแล้วยังไม่ยืนยันส่ง' as detail, 3 sev
  from kanban_delivery_rounds r, wd
  where r.is_active and r.delivery_time is not null
    and wd.now_frame_min > (
          -- นาทีบนกรอบของเวลาส่ง: ชม. < 8 = ข้ามเที่ยงคืน (+1440) · แล้วลบจุดเริ่มกรอบ 480
          ((extract(hour from r.delivery_time)*60 + extract(minute from r.delivery_time))::int
             + case when extract(hour from r.delivery_time) < 8 then 1440 else 0 end - 480)
          -- dwell = (จุด || 1) × (นาที/จุด || 10) — mirror roundDeliveryMin (JS || = null และ 0 ตกทั้งคู่)
          + coalesce(nullif(r.points_count, 0), 1) * coalesce(nullif(r.time_per_point_min, 0), 10))
    and not exists (
      select 1 from kanban_deliveries d
       where d.work_date = wd.work_date and d.line_name = r.line_name
         and d.shift = r.shift and d.round_no = r.round_no and d.confirmed_at is not null)
),
-- #D รับไม่ครบ (เหมือนเดิม)
d as (
  select 'shortage' kind, 'D' code, 'รับไม่ครบ' title, k.line_name, null::text mat_no,
         'รอบ '||k.round_no||' · '||k.shift as part_name,
         'ไลน์ยืนยัน "รับไม่ครบ" — ของขาดที่ไลน์' as detail, 2 sev
  from kanban_deliveries k, wd
  where k.work_date = wd.work_date and k.received_status = 'partial'
),
-- #E ใบสั่งซื้อค้างเกินวันกำหนด (เหมือนเดิม)
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

-- ตรวจหลังรัน:
--   select code, count(*) from v_store_abnormal group by 1 order by 1;
--   (เทียบกับก่อนแก้ — เคส A/B ควร "ลดลง" จากการยุบแถวซ้ำต่อคลัง · เคส C ตอนบ่ายไม่ควรมีรอบ 00:00-07:59)
-- Rollback: รันไฟล์ 20260821_store_abnormal_view.sql เดิม
