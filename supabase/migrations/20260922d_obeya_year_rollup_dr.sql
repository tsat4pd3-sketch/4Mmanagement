-- ══ OBEYA จอ SQDCM โหมด "ปี" — สรุปรายเดือนฝั่ง DR (Product DB · eyhclzkifitbhbljgoav) · 2026-09-22 ══
-- คำสั่ง user: จอ SQDCM ต้องมีรายปี = 12 แท่งรายเดือน + แท่งที่ 13 (เฉลี่ย/รวม) + ตัวเลข YTD
--               กดแท่งเดือนไหน → เจาะลงกราฟรายวันของเดือนนั้น
-- ทำไมต้องเป็น RPC ไม่โหลดแถวดิบเหมือนโหมดเดือน:
--   โหมดเดือนโหลดแถวดิบ ~400 KB/รอบ · โหมดปีถ้าทำแบบเดียวกัน ≈ 5 MB (+เทียบปีก่อนอีกเท่าตัว)
--   บนจอที่รีเฟรชเองทุก 20 นาที = โควต้า egress หมดในไม่กี่วัน (docs/modules/obeya.md §6)
--   ⇒ ฟังก์ชันนี้คืน "ผลรวมต่อ (เดือน, ไลน์)" ไม่กี่ร้อยแถว = หลัก KB
-- 🔴 กฎ: ฟังก์ชันนี้คืน **ผลรวม (Σ) เท่านั้น ไม่หาร ไม่ตัดสินสี ไม่คำนวณ OEE**
--   การหาร/ถ่วงน้ำหนัก/สถานะทำใน src/utils/obeyaYear.js (+ oee.js เป็นเจ้าของสูตร) —
--   ถ้า SQL คำนวณ OEE เอง = สูตรชุดที่ 2 ที่จะ drift จากจอ (กฎ SCADA ใน CLAUDE.md)
--   น้ำหนักที่ส่งกลับตรงกับที่โหมดเดือนใช้จริงผ่าน obeyaKpi.axisOee:
--     wLoad = shift_min (แถว session ที่จอโหมดเดือนส่งให้ axisOee ไม่มี plannedMin ⇒ ถอยเป็น shift_min)
--     wRun  = wLoad × A/100 · wProd = actual_qty + qty_ng   (นิยามใน oee.js บรรทัด wLoad/wRun/wProd)
-- client ฝั่ง DR = anon เสมอ ⇒ ต้อง grant anon (ไม่งั้นจอว่างเงียบ) · อ่านอย่างเดียว (stable)
-- rollback: drop function public.obeya_year_rollup(date, date);

create or replace function public.obeya_year_rollup(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
with s as (
  select ps.id, to_char(ps.work_date, 'YYYY-MM') as m, ps.line_name,
         coalesce(ps.shift_min, 0)::numeric as shift_min,
         ps.oee, ps.oee_a, ps.oee_p, ps.oee_q,
         coalesce(ps.actual_qty, 0)::numeric as qty, coalesce(ps.qty_ng, 0)::numeric as ng
  from production_sessions ps
  where ps.status = 'closed' and ps.work_date between p_from and p_to
),
sess as (
  select m, line_name as line, count(*) as n,
         sum(shift_min)                                   filter (where oee   is not null) as wload,
         sum(oee * shift_min)                             filter (where oee   is not null) as oee_w,
         sum(shift_min)                                   filter (where oee_a is not null) as a_wload,
         sum(oee_a * shift_min)                           filter (where oee_a is not null) as a_w,
         sum(shift_min * coalesce(oee_a, 100) / 100)      filter (where oee_p is not null) as wrun,
         sum(oee_p * shift_min * coalesce(oee_a, 100) / 100) filter (where oee_p is not null) as p_w,
         sum(qty + ng)                                    filter (where oee_q is not null) as wprod,
         sum(oee_q * (qty + ng))                          filter (where oee_q is not null) as q_w,
         sum(qty) as qty, sum(ng) as ng
  from s group by 1, 2
),
dt as (
  select s.m, s.line_name as line,
         coalesce(t.name_th, d.description, 'ไม่ระบุสาเหตุ') as type,
         coalesce(t.category, '') as category,
         sum(coalesce(d.duration_min, 0)) as min
  from downtime_logs d
  join s on s.id = d.session_id
  left join dr_downtime_types t on t.id = d.downtime_type_id
  group by 1, 2, 3, 4
),
df as (
  select s.m, s.line_name as line, po.mat_no as mat, count(*) as rows,
         sum(coalesce(d.qty_ng, 0) + coalesce(d.qty_suspect, 0)) as ng,
         sum(coalesce(d.qty_ng, 0) + coalesce(d.qty_suspect, 0))
           filter (where d.is_trial is true or t.excl_from_q is true) as trial_ng
  from defect_logs d
  join s on s.id = d.session_id
  left join dr_defect_types t on t.id = d.defect_type_id
  left join prod_orders po on po.id = d.prod_order_id
  group by 1, 2, 3
),
od as (
  select s.m, s.line_name as line, o.status, count(*) as n,
         sum(coalesce(o.qty, 0)) as qty,
         sum(coalesce(o.qty_ok, o.qty, 0)) as qty_ok_fb,   -- confirmed: qty_ok ?? qty (กติกาเดียวกับจอโหมดเดือน)
         sum(coalesce(o.qty_actual, 0)) as qty_actual
  from prod_orders o
  join s on s.id = o.session_id
  group by 1, 2, 3
)
select jsonb_build_object(
  'from', p_from, 'to', p_to,
  'sessions', coalesce((select jsonb_agg(to_jsonb(x)) from sess x), '[]'::jsonb),
  'downtime', coalesce((select jsonb_agg(to_jsonb(x)) from dt x),   '[]'::jsonb),
  'defects',  coalesce((select jsonb_agg(to_jsonb(x)) from df x),   '[]'::jsonb),
  'orders',   coalesce((select jsonb_agg(to_jsonb(x)) from od x),   '[]'::jsonb)
);
$$;

revoke all on function public.obeya_year_rollup(date, date) from public;
grant execute on function public.obeya_year_rollup(date, date) to anon, authenticated;

-- ตรวจ: select jsonb_array_length(obeya_year_rollup('2026-01-01','2026-12-31')->'sessions');
