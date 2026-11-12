-- ════════════════════════════════════════════════════════════════════════════
-- 📊 kpi_mtn_rollup — แตกชั่วโมง "ไลน์หยุด" เป็น 4 ช่วง + M/C Breakdown ถึงซ่อมเสร็จ
--    project: "Product DB" (DR) = eyhclzkifitbhbljgoav                    2026-11-11
--    (ต่อจาก 20261111_kpi_mtn_rollup_machine_key_dr.sql — ไฟล์นี้ทับทั้งฟังก์ชัน)
--
-- คำสั่ง user (วาดไดอะแกรมมาให้ + เคาะชื่อช่วง):
--   Run │ ① ก่อนเรียกช่าง │ ② MTTA │ ③ TTR │ ④ คืนไลน์ (Restart) │ Run again
--       ↑Line stop       ↑Call MTN      ↑Repair Done        ↑ไลน์เดินอีกครั้ง
--   · *"M/C Breakdown เอาแบบที่เราวาด"* = Line stop → Repair Done (①+②+③)
--   · *"ให้โชว์กราฟแท่งแบบนี้ เพื่อให้เห็นว่าเลขตัวเดียวกัน ไม่ได้มีตรงไหนหายไป
--      แต่บอกได้ว่าไปอยู่ช่วงไหน"*
--
-- ── 🔴 กฎของการแตกช่วง ─────────────────────────────────────────────────────
-- 1. **บวกกลับต้องเท่ากับไลน์หยุดเสมอ** — `seg_precall+seg_mtta+seg_ttr+seg_restart
--    +seg_unsplit = breakdown_min` เป๊ะ (วัดจริง ต.ค. machine: 810.1 = 810.1 ชม.)
--    ⇒ ทำได้ด้วยการ **clamp ทีละช่วงตามลำดับ** (c1→c2→c3→dtl) ไม่ใช่ปล่อยให้ล้น
-- 2. **ตัดทีละช่วงเท่าที่รู้ ไม่ใช่ "ครบ 4 ช่วงถึงจะนับ"** — รอบแรกเขียนเข้มแบบนั้น
--    แล้วใบที่กดปุ่มย้อนหลัง (รู้ ①②③ แต่ ④ ติดลบ) ถูกทิ้งทั้งก้อน ⇒ แบ่งได้แค่ 6.5%
--    แก้เป็น clamp ทีละช่วง ⇒ แบ่งได้ 20% ของชั่วโมง (344 จาก 1,818 ครั้ง)
-- 3. **ส่วนที่แบ่งไม่ได้ต้องออกมาเป็น `seg_unsplit_min` ให้จอวาด ห้ามหาย** —
--    ครั้งที่ไม่มีใบ MO (1,493 จาก 1,818 ครั้ง ใน ต.ค.) ไม่มี stamp ให้แบ่ง
--    นั่นคือ "ข้อมูลที่ขาด" ที่ต้องเห็นบนจอ ไม่ใช่สิ่งที่ซ่อนเพราะแท่งจะได้สวย
-- 4. `mc_breakdown_min` = `sum(mins - d)` = ไลน์หยุด − คืนไลน์ (นิยามที่ user เคาะ)
--    🔴 **ไม่ใช่ค่าทางการ** — KPI Guideline หน้า 10 ยังใช้ `breakdown_min` (ไลน์หยุดเต็ม)
--    ⚠️ ตัด ④ ได้เฉพาะครั้งที่มีใบ MO ⇒ **ยิ่งเปิดใบ MO เยอะ ชั่วโมงยิ่งลด**
--       เป็นผลข้างเคียงที่จอต้องเขียนบอก (`mo_events` / `mc_trimmed` ส่งมาให้แล้ว)
-- 5. ⚡ **ห้ามถอด `as materialized`** — เคยทำ RPC ค้างเกิน 60 วิมาแล้ว (CTE ถูก inline
--    แล้ว re-scan ต่อแถว) · ดูเหตุผลเต็มใน 20261111_kpi_mtn_rollup_machine_key_dr.sql
--
-- stamp ที่ใช้ (ฝั่งการ์ด downtime ชนะ ถ้าไม่มีถอยไปใช้ของใบ MO — วัดแล้วค่ากลางต่างกัน 0.0 นาที):
--   Line stop = started_at · Call = call_mtn_at ?? report_at
--   ช่างรับ    = call_mtn_ack_at ?? accept_at   · Repair Done = repair_done_at
--   Run again = ended_at   ⚠️ `occurred_at` ใช้ไม่ได้ (มีคนกรอกแค่ 5.8%)
--
-- ✅ คิวรีเช็คผล — บวกกลับต้องเท่ากับไลน์หยุด
--   select t.kind, round(t.breakdown_min/60.0,1) as linestop,
--          round((t.seg_precall_min+t.seg_mtta_min+t.seg_ttr_min+t.seg_restart_min
--                 +t.seg_unsplit_min)/60.0,1) as บวกกลับ
--     from kpi_mtn_rollup('2026-10-01','2026-10-31') r,
--          jsonb_to_recordset(r->'dt') as t(kind text, breakdown_min numeric,
--            seg_precall_min numeric, seg_mtta_min numeric, seg_ttr_min numeric,
--            seg_restart_min numeric, seg_unsplit_min numeric);
--
-- ⏪ ROLLBACK — รัน 20261111_kpi_mtn_rollup_machine_key_dr.sql ซ้ำทั้งไฟล์
--    (จอจะกลับไปไม่มีแท่งแตกช่วงเอง เพราะ `mtnSegSeries()` คืน known:false)
-- ════════════════════════════════════════════════════════════════════════════

-- (ตัวฟังก์ชันด้านล่าง = สิ่งที่ apply จริงบน Product DB แล้ว)

create or replace function public.kpi_mtn_rollup(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
with mo as (
  select to_char(o.repair_done_at at time zone 'Asia/Bangkok', 'YYYY-MM') as m,
         coalesce(o.mtn_dept, 'unknown') as team,
         count(*) as closed,
         count(*) filter (where o.target_done_at is not null and o.repair_done_at <= o.target_done_at) as on_target,
         count(*) filter (where o.target_done_at is null) as no_target
  from mtn_orders o
  where o.repair_done_at is not null
    and (o.repair_done_at at time zone 'Asia/Bangkok')::date between p_from and p_to
    and coalesce(o.status, '') <> 'rejected'
  group by 1, 2
),
-- ดัชนีทะเบียน 2 ชั้น (ชนกัน = ไม่ใส่ ห้ามเดา) — ดูเหตุผลเต็มในไฟล์ 20261111_…_machine_key_dr.sql
reg_exact as materialized (
  select public.machine_key(machine_no) as k, max(equipment_kind) as kind, 1 as pri
  from machines where coalesce(is_active, true) and nullif(btrim(coalesce(machine_no,'')),'') is not null
  group by 1 having count(distinct machine_no) = 1
),
reg_prefix as materialized (
  select public.machine_key(split_part(machine_no, '/', 1)) as k, max(equipment_kind) as kind, 2 as pri
  from machines where coalesce(is_active, true) and nullif(btrim(coalesce(machine_no,'')),'') is not null
  group by 1 having count(distinct machine_no) = 1
),
map as materialized (
  select k, (array_agg(kind order by pri))[1] as kind
  from (select * from reg_exact union all select * from reg_prefix) u
  group by k
),
raw as materialized (
  select d.id,
         to_char(d.started_at at time zone 'Asia/Bangkok', 'YYYY-MM') as m,
         d.machine_no, d.started_at, d.ended_at, d.call_mtn_at, d.call_mtn_ack_at,
         public.machine_key(d.machine_no) as k_full,
         public.machine_key(split_part(d.machine_no, '/', 1)) as k_pre,
         case when d.duration_min is not null then d.duration_min::numeric
              when d.ended_at is not null then greatest(0, extract(epoch from (d.ended_at - d.started_at)) / 60)
              else null end as mins
  from downtime_logs d
  left join dr_downtime_types t on t.id = d.downtime_type_id
  where d.started_at is not null
    and (d.started_at at time zone 'Asia/Bangkok')::date between p_from and p_to
    and coalesce(t.category, '') <> 'planned'
    and (d.ended_at is not null or d.duration_min is not null)
),
-- เวลาของใบ MO ที่ผูกกับการ์ด downtime นี้ (ใบเดียวต่อการ์ดตามกติกาเปิดใบ)
rd as materialized (
  select o.source_downtime_id as id,
         min(o.report_at) as report_at, min(o.accept_at) as accept_at, max(o.repair_done_at) as repair_done_at
  from mtn_orders o
  where o.source_downtime_id is not null and o.repair_done_at is not null
  group by 1
),
seg as materialized (
  select x.m, x.machine_no, coalesce(x.mins, 0) as mins,
         coalesce(m1.kind, m2.kind) as kind_hit,
         (r.repair_done_at is not null) as has_mo,
         extract(epoch from (coalesce(x.call_mtn_at, r.report_at) - x.started_at)) / 60 as s_precall,
         extract(epoch from (coalesce(x.call_mtn_ack_at, r.accept_at) - coalesce(x.call_mtn_at, r.report_at))) / 60 as s_mtta,
         extract(epoch from (r.repair_done_at - coalesce(x.call_mtn_ack_at, r.accept_at))) / 60 as s_ttr,
         extract(epoch from (x.ended_at - r.repair_done_at)) / 60 as s_restart
  from raw x
  left join map m1 on m1.k = x.k_full
  left join map m2 on m2.k = x.k_pre
  left join rd r on r.id = x.id
),
-- 🔴 clamp ทีละช่วงตามลำดับ — ตัวที่ทำให้ "บวกกลับได้เท่าไลน์หยุด" เสมอ (กฎข้อ 1-2 ด้านบน)
c1 as (select *, least(greatest(coalesce(s_precall, 0), 0), mins) as a from seg),
c2 as (select *, least(greatest(coalesce(s_mtta, 0), 0), greatest(mins - a, 0)) as b from c1),
c3 as (select *, least(greatest(coalesce(s_ttr, 0), 0), greatest(mins - a - b, 0)) as c from c2),
dtl as materialized (
  select m, machine_no, mins, kind_hit, has_mo, a, b, c,
         least(greatest(coalesce(s_restart, 0), 0), greatest(mins - a - b - c, 0)) as d
  from c3
),
dt as (
  select m, coalesce(kind_hit, 'unknown') as kind, count(*) as events, sum(mins) as breakdown_min,
         sum(mins - d) as mc_breakdown_min,
         count(*) filter (where d > 0) as mc_trimmed,
         count(*) filter (where has_mo) as mo_events,
         count(*) filter (where a + b + c + d > 0) as split_events,
         sum(a) as seg_precall_min, sum(b) as seg_mtta_min,
         sum(c) as seg_ttr_min,     sum(d) as seg_restart_min,
         sum(greatest(0, mins - a - b - c - d)) as seg_unsplit_min
  from dtl group by 1, 2
),
gap as (
  select m,
         case when nullif(btrim(coalesce(machine_no,'')),'') is null then 'no_machine_no'
              else 'not_in_master' end as reason,
         machine_no, mins
  from dtl where kind_hit is null
),
dt_gap as (
  select m, reason, count(*) as events, round(sum(mins)::numeric, 1) as mins
  from gap group by 1, 2
),
dt_gap_top as (
  select machine_no, count(*) as events, round(sum(mins)::numeric, 1) as mins
  from gap where reason = 'not_in_master'
  group by 1 order by sum(mins) desc nulls last limit 15
),
mach as (
  select coalesce(equipment_kind, 'unknown') as kind, count(*) as n
  from machines where coalesce(is_active, true)
  group by 1
),
mon as (
  select distinct to_char(d.started_at at time zone 'Asia/Bangkok', 'YYYY-MM') as m
  from downtime_logs d
  where d.started_at is not null and (d.started_at at time zone 'Asia/Bangkok')::date between p_from and p_to
)
select jsonb_build_object(
  'mo',         coalesce((select jsonb_agg(to_jsonb(mo) order by m, team) from mo), '[]'::jsonb),
  'dt',         coalesce((select jsonb_agg(to_jsonb(dt) order by m, kind) from dt), '[]'::jsonb),
  'machines',   coalesce((select jsonb_agg(to_jsonb(mach) order by kind) from mach), '[]'::jsonb),
  'months',     coalesce((select jsonb_agg(m order by m) from mon), '[]'::jsonb),
  'dt_gap',     coalesce((select jsonb_agg(to_jsonb(dt_gap) order by m, reason) from dt_gap), '[]'::jsonb),
  'dt_gap_top', coalesce((select jsonb_agg(to_jsonb(dt_gap_top) order by mins desc) from dt_gap_top), '[]'::jsonb)
);
$$;

grant execute on function public.kpi_mtn_rollup(date, date) to anon, authenticated;

comment on function public.kpi_mtn_rollup(date, date) is
  'Σ ต่อเดือน/ชนิดอุปกรณ์ สำหรับ KPI ทีมช่าง (Guideline 2026 หน้า 10) — จับคู่เลขเครื่องด้วย machine_key() 4 ชั้น · dt_gap = ชั่วโมงที่ชี้เจ้าของไม่ได้ · seg_* = แตกไลน์หยุดเป็น 4 ช่วง บวกกลับได้เท่าเดิมเสมอ (2026-11-11)';
