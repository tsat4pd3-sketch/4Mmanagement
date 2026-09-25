-- ══ KPI ช่างตามสูตรทางการ (KPI Guideline 2026 หน้า 10) — ผลรวมรายเดือนฝั่ง DR (Product DB · eyhclzkifitbhbljgoav) · 2026-09-24 ══
-- ที่มา: user ส่ง KPI_Guideline_2026_As_of_29.01.2026.pdf ซ้ำ ("เคยส่งให้แล้ว ดูให้ละเอียดอีกรอบ")
--   หน้า 10 "Maintenance" กำหนดสูตรไว้ครบ:
--     MO Closed on target  = (MO Closed on target / Total MO) × 100
--     Machine Break Down   = (No. of hours the machine has been stopped / No. of hours the machine can work normally) × 100
--     MTBF                 = [(730 × Number of machines) − Total breakdown times] / Number of machines
--     MTTR                 = Total hours of breakdown / Total frequency times
--   ⇒ ตัวตั้ง/ตัวหารทุกตัวเป็น "ผลรวม" ที่ ESM มีอยู่แล้วใน mtn_orders · downtime_logs · machines
-- 🔴 กฎ: ฟังก์ชันนี้คืน **Σ เท่านั้น ไม่หาร ไม่คูณ 730 ไม่ตัดสินสี** — สูตรอยู่ที่ src/utils/kpiAuto.js ที่เดียว
--   (กฎเดียวกับ obeya_year_rollup — SQL คำนวณ KPI เอง = สูตรชุดที่ 2 ที่ drift จากจอ)
-- ทำไมเป็น RPC: downtime_logs ปี 2026 ≈ 9,800 แถว (~1.5 MB ถ้าโหลดดิบ) แต่ที่ต้องการคือ Σ ต่อ (เดือน, ชนิดอุปกรณ์) ไม่กี่สิบแถว
-- ก้อนที่คืน:
--   mo       : ต่อ (เดือนที่ซ่อมเสร็จ, ทีมช่าง mtn_dept) — closed = ใบที่มี repair_done_at · on_target = repair_done_at ≤ target_done_at
--              · no_target = ปิดแล้วแต่ไม่ได้ตั้งกำหนดเสร็จ (จอต้องบอก ไม่ใช่นับเป็นตรงเป้า)
--   dt       : ต่อ (เดือนที่เริ่มหยุด, ชนิดอุปกรณ์ machines.equipment_kind) — เฉพาะ downtime **นอกแผน** ที่ปิดแล้ว
--              (planned = PM/เปลี่ยนรุ่น ไม่ใช่ failure · ยังไม่ปิด = ยังไม่รู้ว่านานเท่าไหร่ ห้ามนับ 0)
--              breakdown_min = duration_min ถ้ามี ไม่งั้นคิดจาก started/ended · events = จำนวนครั้ง
--              kind 'unknown' = ระบุเครื่องไม่ได้/เครื่องไม่อยู่ในทะเบียน (จอต้องเห็นสัดส่วนนี้)
--   machines : จำนวนเครื่อง active ต่อชนิด (ตัวหาร 730 × n ของ MTBF)
--   months   : เดือนที่มี downtime_logs อย่างน้อย 1 แถว (ทั้งโรงงาน) — เดือนที่ไม่มีเลย = "ไม่มีข้อมูล" ไม่ใช่ "ไม่เคยเสีย"
-- เดือนตัดตามเวลาไทย (Asia/Bangkok) · client ฝั่ง DR = anon เสมอ ⇒ grant anon
-- rollback: drop function public.kpi_mtn_rollup(date, date);

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
dtl as (
  select to_char(d.started_at at time zone 'Asia/Bangkok', 'YYYY-MM') as m,
         coalesce(mc.equipment_kind, 'unknown') as kind,
         case when d.duration_min is not null then d.duration_min::numeric
              when d.ended_at is not null then greatest(0, extract(epoch from (d.ended_at - d.started_at)) / 60)
              else null end as mins
  from downtime_logs d
  left join dr_downtime_types t on t.id = d.downtime_type_id
  left join lateral (
    select m2.equipment_kind from machines m2
    where m2.machine_no = d.machine_no
    order by m2.is_active desc nulls last limit 1
  ) mc on true
  where d.started_at is not null
    and (d.started_at at time zone 'Asia/Bangkok')::date between p_from and p_to
    and coalesce(t.category, '') <> 'planned'
    and (d.ended_at is not null or d.duration_min is not null)
),
dt as (
  select m, kind, count(*) as events, sum(mins) as breakdown_min
  from dtl group by 1, 2
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
  'mo',       coalesce((select jsonb_agg(to_jsonb(mo) order by m, team) from mo), '[]'::jsonb),
  'dt',       coalesce((select jsonb_agg(to_jsonb(dt) order by m, kind) from dt), '[]'::jsonb),
  'machines', coalesce((select jsonb_agg(to_jsonb(mach) order by kind) from mach), '[]'::jsonb),
  'months',   coalesce((select jsonb_agg(m order by m) from mon), '[]'::jsonb)
);
$$;

grant execute on function public.kpi_mtn_rollup(date, date) to anon, authenticated;

-- ตรวจผลหลังรัน (Product DB):
-- select jsonb_array_length(r->'mo') mo, jsonb_array_length(r->'dt') dt, r->'machines', r->'months'
--   from kpi_mtn_rollup('2026-01-01','2026-12-31') r;
