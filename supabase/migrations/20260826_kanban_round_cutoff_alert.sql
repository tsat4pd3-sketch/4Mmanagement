-- ⏰ แจ้งสโตร์ตอน "รอบจัดส่งตัดยอดแล้ว — ไปเตรียมของ"  (DR)
--
-- ที่มา (user 2026-08-26): หลัง seed รอบ 3 รอบ/วัน แล้วถามว่า "พอผลิตสแกนเปิดออเดอร์
--   จะแตก BOM ไปสะสมเข้าตามรอบ แจ้งสโตร์ใช่มั้ย" → **ตอนนั้นยังไม่มีการแจ้งเลย**
--   ตรวจ `notification_rules` หมวด logistic: 8 เรื่อง แต่**ไม่มีเรื่องรอบจัดส่งเข้าไลน์สักเรื่อง**
--   ที่ใกล้สุดคือ `store_abnormal` ซึ่งยิงวันละครั้ง 08:30 และเป็นการเตือน "ย้อนหลัง" ว่ารอบเลยเวลาแล้ว
--   ⇒ สโตร์ต้องเปิดหน้า /heijunka ดูเอง · ไม่เปิด = ไม่มีใครรู้ว่าถึงเวลาจัดของ
--
-- ⚠️ เงื่อนไข "รอบไหนถึงเวลาแจ้ง" อยู่ในวิวนี้ที่เดียว — edge `kanban-round-scan` แค่อ่านแล้วส่ง
--    (precedent: `v_store_abnormal` ↔ `store-daily-scan` · ห้าม copy เงื่อนไขไปเขียนซ้ำในไฟล์ edge)
--
-- ⚠️ วิวนี้ตอบแค่ "รอบไหนตัดยอดแล้วและยังไม่เคยแจ้ง" — **ไม่ได้คิดว่าต้องเตรียมของอะไรบ้าง**
--    เพราะการจับ "ไลน์ลูก → กลุ่มไลน์" ต้องใช้ `production_lines.parent_line_name` ซึ่งอยู่ **Main**
--    join ข้าม project ในวิวไม่ได้ → ให้ edge (ที่ต่อได้ทั้ง 2 project) เป็นคนรวมยอด

-- ── ตัวกันแจ้งซ้ำ (1 รอบ / 1 วันงาน แจ้งครั้งเดียว) ──
create table if not exists public.kanban_round_alerts (
  work_date   date not null,
  round_id    uuid not null references public.kanban_delivery_rounds(id) on delete cascade,
  alerted_at  timestamptz not null default now(),
  orders      int,          -- ใบผลิตที่ตกในหน้าต่างตัดยอดของรอบนี้
  parts       int,          -- จำนวนพาร์ทลูกตาม BOM
  gross_qty   numeric,      -- ยอดรวมความต้องการ (ยังไม่หักสต็อกในไลน์)
  notified    boolean not null default false,   -- false = ถึงเวลาแล้วแต่ไม่มีของต้องเตรียม (ไม่ส่ง)
  primary key (work_date, round_id)
);
alter table public.kanban_round_alerts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'kanban_round_alerts' and policyname = 'kanban_round_alerts_all') then
    create policy kanban_round_alerts_all on public.kanban_round_alerts for all using (true) with check (true);
  end if;
end $$;

-- ── รอบที่ "ตัดยอดแล้ว และยังไม่เคยแจ้ง" ของวันงานปัจจุบัน ──
--
-- นาทีบนกรอบวันงาน 08:00 → 08:00 (ก่อน 08:00 = ช่วงดึกของวันงานเดิม → +1440)
--   สูตรเดียวกับ `frameMin` ฝั่งเว็บ (src/utils/timeFrame.js) — รอบกะดึกข้ามเที่ยงคืนจึงไม่เพี้ยน
-- หน้าต่างตัดยอดของรอบ = [cutoff รอบก่อนหน้า, cutoff รอบนี้)  ← ตรงกับ `roundWindows` ใน HeijunkaKanban
--   รอบแรกของกะเริ่มที่ต้นวันงาน (08:00)
create or replace view public.v_kanban_round_due as
with wd as (
  select work_date_bangkok() as d,
         -- เวลาปัจจุบันเป็น "นาทีบนกรอบวันงาน"
         case when extract(hour from (now() at time zone 'Asia/Bangkok')) < 8
              then extract(epoch from (now() at time zone 'Asia/Bangkok')::time) / 60 + 1440
              else extract(epoch from (now() at time zone 'Asia/Bangkok')::time) / 60
         end as now_w
),
r as (
  select
    id, line_name, shift, round_no, cutoff_time, delivery_time,
    prep_minutes, points_count, time_per_point_min,
    case when extract(hour from cutoff_time)   < 8 then extract(epoch from cutoff_time)   / 60 + 1440
         else extract(epoch from cutoff_time)   / 60 end as cutoff_w,
    case when extract(hour from delivery_time) < 8 then extract(epoch from delivery_time) / 60 + 1440
         else extract(epoch from delivery_time) / 60 end as delivery_w
  from public.kanban_delivery_rounds
  where is_active
),
seq as (
  select r.*,
    coalesce(lag(cutoff_w) over (partition by line_name, shift order by cutoff_w), 480) as win_start_w
  from r
)
select
  wd.d                                as work_date,
  s.id                                as round_id,
  s.line_name, s.shift, s.round_no,
  s.cutoff_time, s.delivery_time,
  s.prep_minutes, s.points_count, s.time_per_point_min,
  -- ขอบหน้าต่างเป็น timestamptz ให้ edge เอาไปกรอง prod_orders.opened_at ได้ตรงๆ
  ((wd.d + time '08:00') at time zone 'Asia/Bangkok') + ((s.win_start_w - 480) * interval '1 minute') as win_start_ts,
  ((wd.d + time '08:00') at time zone 'Asia/Bangkok') + ((s.cutoff_w   - 480) * interval '1 minute') as win_end_ts,
  (wd.now_w - s.cutoff_w)::int        as mins_since_cutoff
from seq s
cross join wd
-- ⚠️ หน้าต่างแจ้ง 90 นาทีหลังตัดยอด — cron วิ่งทุก 10 นาที เผื่อ edge ล่มไปหลายรอบยังตามเก็บได้
--    แต่ไม่ไล่แจ้งรอบเช้าตอนบ่าย (แจ้งช้าเกินไป = เสียงรบกวน ไม่ใช่ข้อมูล)
where wd.now_w >= s.cutoff_w
  and wd.now_w <  s.cutoff_w + 90
  and not exists (
    select 1 from public.kanban_round_alerts a
     where a.work_date = wd.d and a.round_id = s.id
  );

grant select on public.v_kanban_round_due to anon, authenticated;

-- ตรวจผล:
--   select line_name, shift, round_no, cutoff_time::text, delivery_time::text, mins_since_cutoff
--     from v_kanban_round_due order by line_name, round_no;
