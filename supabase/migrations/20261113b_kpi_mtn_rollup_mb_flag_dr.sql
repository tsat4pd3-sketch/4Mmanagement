-- ══ 🔧 kpi_mtn_rollup — เพิ่ม 3 ถังชั่วโมงตามธง is_machine_breakdown ══  2026-11-13
-- Project: DR (ชื่อในจอ Supabase = "Product DB" · eyhclzkifitbhbljgoav)
-- ต่อจาก 20261113_dt_type_is_machine_breakdown_dr.sql
--
-- เพิ่มเฉพาะ 3 คอลัมน์ใน `dt`:  mb_yes_min / mb_no_min / mb_unset_min
-- 🔴 **ของเดิมทุกตัวต้องเท่าเดิมเป๊ะ** — breakdown_min · mc_breakdown_min · seg_* · events
--    ไม่ถูกแตะเลย (ธงนี้ไม่แตะเลขที่ส่งกลุ่ม) · ที่เพิ่มคือ "ชั่วโมงก้อนเดิมแบ่งเป็น 3 ถัง"
-- 🔴 **บวก 3 ถังกลับต้องเท่า breakdown_min เสมอ** (`filter` 3 อันครอบ is true / is false / is null
--    = ครอบทุกแถวแบบไม่ซ้ำไม่ขาด) · จอใช้ความจริงข้อนี้เป็นด่าน "ไม่มีค่าไหนหายไป"
-- 🔴 `mb` มาจาก `dr_downtime_types.is_machine_breakdown` ผ่าน left join ที่ `raw` มีอยู่แล้ว
--    ⇒ แถวที่หา type ไม่เจอ = null = ถัง unset (ถูกต้อง: ไม่มีใครตัดสิน)
-- 🔴 `as materialized` ของทุก CTE lookup ห้ามถอด — เคยทำ RPC ช้าจากวินาที > 60 วินาที
--    (CTE ถูก inline แล้ว machine_key() ถูกเรียกใหม่ทุกแถว · ดู 20261111_kpi_mtn_rollup_machine_key)
--
-- ย้อนกลับ: รัน create or replace ของ 20261111b_kpi_mtn_rollup_segments_dr.sql ซ้ำ
--           (ลายเซ็นเดิม · จอที่ยังไม่มี 3 ช่องนี้ถอยไป known:false เองผ่าน mtnOwnerSeries())
-- เจ้าของกฎฝั่งจอ: src/utils/kpiAuto.js §mtnOwnerSeries · src/utils/dtBreakdownOwner.js

create or replace function public.kpi_mtn_rollup(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
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
         t.is_machine_breakdown as mb,
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
rd as materialized (
  select o.source_downtime_id as id,
         min(o.report_at) as report_at, min(o.accept_at) as accept_at, max(o.repair_done_at) as repair_done_at
  from mtn_orders o
  where o.source_downtime_id is not null and o.repair_done_at is not null
  group by 1
),
seg as materialized (
  select x.m, x.machine_no, coalesce(x.mins, 0) as mins, x.mb,
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
c1 as (select *, least(greatest(coalesce(s_precall, 0), 0), mins) as a from seg),
c2 as (select *, least(greatest(coalesce(s_mtta, 0), 0), greatest(mins - a, 0)) as b from c1),
c3 as (select *, least(greatest(coalesce(s_ttr, 0), 0), greatest(mins - a - b, 0)) as c from c2),
dtl as materialized (
  select m, machine_no, mins, kind_hit, has_mo, mb, a, b, c,
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
         sum(greatest(0, mins - a - b - c - d)) as seg_unsplit_min,
         sum(mins) filter (where mb is true)  as mb_yes_min,
         sum(mins) filter (where mb is false) as mb_no_min,
         sum(mins) filter (where mb is null)  as mb_unset_min
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
$function$;
