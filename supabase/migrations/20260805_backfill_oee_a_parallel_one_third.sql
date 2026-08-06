-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill %A ของไลน์เครื่องขนาน LASER-345 / LASER-789 ด้วยสูตร DT 1/N (N=3)
-- (DR project eyhclzkifitbhbljgoav · 2026-08-05)
--
-- ที่มา: ก่อน 2026-08-04 computeOEE บวกนาที DT ของทั้ง 3 เครื่องเลเซอร์รวมแล้วหัก
-- จากเวลาไลน์เดียว → %A ต่ำเกินจริง (หนักสุดโดนกดเป็น 0 ทั้งที่ของออกปกติ)
-- สูตรใหม่ (commit 0faf03c + แยก N จาก flow_mode 2026-08-05): DT ที่ระบุเครื่อง
-- หักน้ำหนัก 1/3 · DT ไม่ระบุเครื่อง = หยุดทั้งไลน์ หักเต็ม
--
-- วิธี: replicate สาย A ของ computeOEE (DailyReport.jsx) เป็น SQL แล้วคำนวณ 2 ค่า
-- ต่อกะ — a_old (weight 1 = สูตรเก่า) และ a_new (weight 1/3) — เงื่อนไขที่ทำให้
-- ย่อสูตรได้ตรงเป๊ะ (ตรวจกับข้อมูลจริงแล้ว ณ 2026-08-05):
--   · DT ทุกแถวของ 2 ไลน์นี้ระบุเครื่อง + มี started_at/ended_at ครบ (ไม่มี untimed)
--   · แต่ละกะมี prod_order ไม่เกิน 1 ใบ และเป็น confirmed ทั้งหมด
--     → สาย per-MAT เหลือ window เดียว [opened_at, confirmed_at]
--   · break_policies ทั้งหมดเป็น process common (ไม่ต้องรู้ process ของกะ)
--
-- เกณฑ์อัพเดท (กัน blanket-recompute ตามกฎ CLAUDE.md):
--   1. |a_old − oee_a ที่ stamp| ≤ 4 จุด → พิสูจน์ได้ว่ากะนั้น stamp ด้วยสูตรเก่าจริง
--      (กะที่ stamp ด้วยสูตรใหม่แล้ว เช่น ปิดหลัง deploy 2026-08-04 จะ fail เกณฑ์นี้
--       และ |a_new − stamp| ≈ 0 อยู่แล้ว = ไม่ถูกแตะ)
--   2. |a_new − oee_a| ≥ 0.05 → มีอะไรให้แก้จริง (idempotent — รันซ้ำเป็น no-op)
--   3. oee รวม recompute เฉพาะแถวที่ oee_p/oee_q ครบ (a×p×q/1e4)
--
-- ผล audit 2026-08-05: 71 กะเข้าข่ายตรวจ · ~50 กะเข้าเกณฑ์แก้ (ตัวหนักสุด:
--   LASER-789 03/08 กะเช้า 31.69→77.23 · 01/08 กะเช้า 46.45→85.53 ·
--   กะ A=0.00 สี่กะ (16/07, 20/07, 23/07, 30/07) ขึ้นเป็น 91-100)
-- ═══════════════════════════════════════════════════════════════════════════

with cand as (
  select s.id, s.shift, s.work_date, s.shift_min,
         s.oee_a::numeric a_stamp, s.oee_p::numeric p, s.oee_q::numeric q,
         (s.work_date::timestamp + s.start_time) opened,
         (s.work_date::timestamp + s.start_time + (s.shift_min || ' min')::interval) closed
  from production_sessions s
  where s.line_name in ('LASER-345','LASER-789') and s.status='closed' and s.oee_a is not null
    and exists (select 1 from downtime_logs d where d.session_id=s.id and d.machine_no is not null)
    -- เงื่อนไขย่อสูตร — กะที่ผิดเงื่อนไข (ถ้ามีเพิ่มในอนาคต) จะไม่ถูกแตะ
    and not exists (select 1 from downtime_logs d where d.session_id=s.id
                    and (d.machine_no is null or d.started_at is null or d.ended_at is null))
    and (select count(*) from prod_orders o where o.session_id=s.id) <= 1
    and not exists (select 1 from prod_orders o where o.session_id=s.id and o.status<>'confirmed')
),
ord as (
  select o.session_id, min(o.opened_at at time zone 'Asia/Bangkok') ws,
         max(o.confirmed_at at time zone 'Asia/Bangkok') we
  from prod_orders o where o.session_id in (select id from cand) and o.confirmed_at is not null
  group by o.session_id
),
win as (
  select c.*, (o.ws is not null and o.we is not null and o.we > o.ws) has_mat,
         coalesce(o.ws, c.opened) mws, coalesce(o.we, c.closed) mwe
  from cand c left join ord o on o.session_id = c.id
),
pb as (
  select w.id,
    sum(case when ov_s > interval '0' then extract(epoch from ov_s)/60 else 0 end) pb_shift,
    sum(case when ov_m > interval '0' then extract(epoch from ov_m)/60 else 0 end) pb_mat
  from win w cross join lateral (
    select least(pe2, w.closed) - greatest(ps2, w.opened) as ov_s,
           least(pe3, w.mwe) - greatest(ps3, w.mws) as ov_m
    from break_policies p,
    lateral (select (w.work_date::timestamp + p.start_time) ps,
                    (w.work_date::timestamp + p.start_time + (p.duration_min || ' min')::interval) pe) t1,
    lateral (select case when pe < w.opened then ps + interval '1 day' else ps end ps2,
                    case when pe < w.opened then pe + interval '1 day' else pe end pe2,
                    case when pe < w.mws then ps + interval '1 day' else ps end ps3,
                    case when pe < w.mws then pe + interval '1 day' else pe end pe3) t2
    where p.is_active and (p.shift = 'both' or p.shift = w.shift)
  ) x group by w.id
),
dt as (
  select d.session_id,
    sum(case when t.category='planned' then d.duration_min else 0 end) dur_p,
    sum(case when t.category is distinct from 'planned' then d.duration_min else 0 end) dur_u,
    sum(case when t.category='planned' then ov_min else 0 end) ov_p,
    sum(case when t.category is distinct from 'planned' then ov_min else 0 end) ov_u
  from downtime_logs d
  left join dr_downtime_types t on t.id = d.downtime_type_id
  join win w on w.id = d.session_id
  cross join lateral (
    select greatest(0, extract(epoch from (least(d.ended_at at time zone 'Asia/Bangkok', w.mwe)
                                         - greatest(d.started_at at time zone 'Asia/Bangkok', w.mws)))/60) ov_min
  ) o group by d.session_id
),
calc as (
  select w.id, w.a_stamp, w.p, w.q, w.has_mat,
    extract(epoch from (w.mwe - w.mws))/60 win_min, w.shift_min,
    coalesce(pb.pb_shift,0) pb_shift, coalesce(pb.pb_mat,0) pb_mat,
    coalesce(dt.dur_p,0) dur_p, coalesce(dt.dur_u,0) dur_u,
    coalesce(dt.ov_p,0) ov_p, coalesce(dt.ov_u,0) ov_u
  from win w left join pb on pb.id = w.id left join dt on dt.session_id = w.id
),
a2 as (
  select c.id, c.a_stamp, c.p, c.q,
    round((case when has_mat and greatest(0, win_min - pb_mat - ov_p) > 0
      then least(1, greatest(0, greatest(0, win_min - pb_mat - ov_p) - ov_u)
                    / greatest(0, win_min - pb_mat - ov_p))
      else case when greatest(0, shift_min - pb_shift - dur_p) > 0
        then least(1, greatest(0, greatest(0, shift_min - pb_shift - dur_p) - dur_u)
                      / greatest(0, shift_min - pb_shift - dur_p))
        else 0 end end * 100)::numeric, 2) a_old,
    round((case when has_mat and greatest(0, win_min - pb_mat - ov_p/3.0) > 0
      then least(1, greatest(0, greatest(0, win_min - pb_mat - ov_p/3.0) - ov_u/3.0)
                    / greatest(0, win_min - pb_mat - ov_p/3.0))
      else case when greatest(0, shift_min - pb_shift - dur_p/3.0) > 0
        then least(1, greatest(0, greatest(0, shift_min - pb_shift - dur_p/3.0) - dur_u/3.0)
                      / greatest(0, shift_min - pb_shift - dur_p/3.0))
        else 0 end end * 100)::numeric, 2) a_new
  from calc c
)
update production_sessions s
set oee_a = a2.a_new,
    oee   = case when a2.p is not null and a2.q is not null
                 then round(a2.a_new * a2.p * a2.q / 10000.0, 2) else s.oee end
from a2
where s.id = a2.id
  and abs(a2.a_old - a2.a_stamp) <= 4     -- ยืนยันว่ากะนี้ stamp ด้วยสูตรเก่าจริง
  and abs(a2.a_new - a2.a_stamp) >= 0.05; -- มีอะไรให้แก้จริง (idempotent)
