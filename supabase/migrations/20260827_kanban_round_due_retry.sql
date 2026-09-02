-- 🔁 v_kanban_round_due — ตรวจพลาดครั้งเดียวต้องไม่ทำให้รอบนั้นเงียบทั้งวัน  (DR)
--
-- ที่มา (2026-08-27): รอบตัดยอด 08:30 ยิงจริงเป็นครั้งแรก แล้วได้ `orders=0, parts=0, notified=false`
--   ทั้งที่มี 11 กะเปิดก่อน 08:30 และ 32 ใบผลิตอยู่ในหน้าต่าง — สาเหตุคือ edge อ่านผังไลน์จาก Main
--   ไม่ได้ (ดู 20260827_line_parent_map_rpc.sql) แต่ **`markAll()` mark ทุกรอบไปแล้ว**
--   และวิวเดิมตัดรอบที่ "มีแถวใน kanban_round_alerts" ทิ้งทุกแถว ไม่ว่าจะแจ้งสำเร็จหรือไม่
--   ⇒ แก้บั๊กเสร็จใน 5 นาทีก็ช่วยอะไรไม่ได้ รอบนั้นตายไปทั้งวันแล้ว
--
-- ⚠️ กติกาที่ถูก: **ตัวกันแจ้งซ้ำต้องกันเฉพาะ "ที่แจ้งไปแล้วจริง"**
--    แถว notified=false = บันทึกว่า "ตรวจแล้ว ณ เวลานั้น ไม่มีของต้องเตรียม" (ไว้ diagnose)
--    ไม่ใช่การปิดรอบ · หน้าต่างแจ้งมีแค่ 90 นาที = ตรวจซ้ำอย่างมาก 9 รอบ/วัน (คิวรีไม่กี่ตัว)
--    ถูกกว่าการแจ้งเตือนที่หายไปเงียบๆ เยอะ
--
-- ผลข้างเคียงที่ตั้งใจ: แถว notified=false ถูก upsert ทับทุก 10 นาที (alerted_at = เวลาตรวจล่าสุด)
--   ⇒ ดูแถวนี้แล้วรู้ว่า "scanner ยังเดินอยู่ไหม และเห็นอะไร" ซึ่งเดิมดูไม่ได้เลย

create or replace view public.v_kanban_round_due as
with wd as (
  select work_date_bangkok() as d,
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
  ((wd.d + time '08:00') at time zone 'Asia/Bangkok') + ((s.win_start_w - 480) * interval '1 minute') as win_start_ts,
  ((wd.d + time '08:00') at time zone 'Asia/Bangkok') + ((s.cutoff_w   - 480) * interval '1 minute') as win_end_ts,
  (wd.now_w - s.cutoff_w)::int        as mins_since_cutoff
from seq s
cross join wd
where wd.now_w >= s.cutoff_w
  and wd.now_w <  s.cutoff_w + 90
  and not exists (
    select 1 from public.kanban_round_alerts a
     where a.work_date = wd.d and a.round_id = s.id
       and a.notified                                  -- ⬅️ เดิมไม่มีบรรทัดนี้ = ตรวจพลาดแล้วเงียบถาวร
  );

grant select on public.v_kanban_round_due to anon, authenticated;

-- ตรวจผล (ระหว่างหน้าต่าง 90 นาทีหลังตัดยอด):
--   select line_name, round_no, cutoff_time::text, mins_since_cutoff from v_kanban_round_due order by 1, 2;
--   select work_date, round_id, alerted_at, orders, parts, notified from kanban_round_alerts
--     where work_date = work_date_bangkok() order by alerted_at desc;
