-- ═══ แกน C บวก "ค่าซ่อม MO" — rollup ปีฝั่ง DR (2026-11-27 · user: "ใช้ค่าที่ช่างกรอก นับตอนผู้แจ้งอนุมัติรับมอบ ทำเลย")
-- project: DR / "Product DB" (eyhclzkifitbhbljgoav) · ย้อนได้: drop function
-- 🔴 คืน "ผลรวม" เท่านั้น — ไม่ตัดสิน KPI (กฎ OBEYA: RPC ห้ามคำนวณ KPI) · สูตรรายใบลอก `orderCostTotal()` (utils/mtnMoForm.js):
--    ค่าแรง = Σ แถวค่าแรง (amount ถ้ามี ไม่งั้น rate×hours) · ไม่มีแถว = labor_cost ของใบ · ค่าอะไหล่เหมือนกัน (amount ไม่งั้น qty×unit_price · ไม่มีแถว = parts_cost)
--    ใบที่ยังไม่รู้ยอดทั้ง 2 ฝั่ง = ไม่นับเงิน แต่นับ n_nocost (จอต้องเขียนว่ามีกี่ใบ)
-- วันที่นับ = วันที่ผู้แจ้งอนุมัติรับมอบ (`ho_at` ตามเวลาไทย) · ไม่นับ cancelled/rejected
create or replace function public.obeya_mo_cost_rollup(p_from date, p_to date)
returns jsonb language sql stable set search_path to 'pg_catalog', 'public' as $$
  with o as (
    select o.id, o.line_name, o.cost_center,
           to_char((o.ho_at at time zone 'Asia/Bangkok')::date, 'YYYY-MM') as m,
           coalesce((select sum(coalesce(l.amount, l.rate_per_hour * l.hours)) from public.mtn_order_labor l where l.order_id = o.id
                     and (l.amount is not null or (l.rate_per_hour is not null and l.hours is not null))), o.labor_cost) as labor,
           coalesce((select sum(coalesce(p.amount, p.qty * p.unit_price)) from public.mtn_order_parts p where p.order_id = o.id
                     and (p.amount is not null or (p.qty is not null and p.unit_price is not null))), o.parts_cost) as parts
    from public.mtn_orders o
    where o.ho_at is not null
      and (o.ho_at at time zone 'Asia/Bangkok')::date between p_from and p_to
      and coalesce(o.status, '') not in ('cancelled', 'rejected')
  )
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  from (
    select m, line_name as line, cost_center as cc,
           count(*) as n,
           count(*) filter (where labor is null and parts is null) as n_nocost,
           sum(coalesce(labor, 0)) filter (where labor is not null or parts is not null) as labor,
           sum(coalesce(parts, 0)) filter (where labor is not null or parts is not null) as parts
    from o group by 1, 2, 3
  ) r;
$$;
-- ตรวจผล: select * from jsonb_to_recordset(obeya_mo_cost_rollup('2026-11-01','2026-11-30')) as x(m text, line text, cc text, n int, n_nocost int, labor numeric, parts numeric) order by labor+parts desc limit 10;
-- ROLLBACK: drop function public.obeya_mo_cost_rollup(date, date);
