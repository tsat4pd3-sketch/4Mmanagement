-- ══ OBEYA โหมดปี — แตกถังขยะ downtime ตามเครื่อง (DR · Product DB · eyhclzkifitbhbljgoav) · 2026-09-23 ══
-- คำสั่ง user: *"ทำข้อ 2 ต่อเลย downtime"* = ถังขยะ "อื่นๆ / Alarm ไม่ระบุสาเหตุ" ของพาเรโตดาวน์ไทม์
--
-- ปัญหา: จอโหมด "เดือน" แตกถังขยะตามเครื่องแล้ว (utils/downtimeCategory.js) แต่โหมด "ปี" อ่านจาก
--        RPC ตัวนี้ซึ่งยุบตามชื่อประเภทฝั่ง server ⇒ **จอเดียวกันตอบคนละเลขระหว่างโหมดเดือนกับโหมดปี**
-- วัดจริง 90 วัน: ถังขยะ 438 ใบ / 15,433 นาที · **401 ใบ (92%) กรอก machine_no ไว้แล้ว**
--        เคสที่โผล่ทันทีที่แตก: HDF-02 = 66 ใบ / 2,619 นาที ที่วันนี้ไม่มีจอไหนเห็น
--
-- เปลี่ยนเฉพาะคีย์ `type` ของ CTE `dt` — ไม่แตะ sessions/defects/orders · ไม่แตะ signature/สิทธิ์
-- backward-compatible: คืน jsonb โครงเดิมเป๊ะ · จอเก่าที่ยังไม่ deploy อ่านได้เหมือนเดิม (แค่ป้ายยาวขึ้น)
-- rollback: รัน `supabase/migrations/20260922d_obeya_year_rollup_dr.sql` ทับ (create or replace ตัวเดิม)

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
  -- 🗑️ ประเภทที่ "บอกอะไรไม่ได้" (อื่นๆ / ไม่ระบุสาเหตุ) ต้องแตกตามเครื่องตั้งแต่ตรงนี้
  --    ให้ตรงกับ src/utils/downtimeCategory.js `dtBucketName` ที่โหมดเดือนใช้ (2026-09-23)
  --    ⚠️ แตกเฉพาะถังขยะเท่านั้น — ถ้าใส่ machine_no ในคีย์ของ *ทุก* ประเภท แถวจะบาน
  --       (86 ประเภท × เครื่องทั้งโรงงาน) แล้วเหตุผลที่ทำ RPC นี้ (คืนหลัก KB) ก็หายไป
  select s.m, s.line_name as line,
         case when t.name_th is null or t.name_th ~ 'อื่น|ไม่ระบุ'
              then coalesce(nullif(btrim(d.machine_no), ''), 'ไม่ระบุเครื่อง')
                   || ' · ' || coalesce(t.name_th, 'ไม่ระบุประเภท')
              else t.name_th end as type,
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
