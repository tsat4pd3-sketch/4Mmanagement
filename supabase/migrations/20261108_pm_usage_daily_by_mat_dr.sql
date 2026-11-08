-- ── DR project "Product DB" (eyhclzkifitbhbljgoav) ──
-- ยอดผลิตรายวัน "ราย MAT" สำหรับนับการใช้งานของแม่พิมพ์ — 2026-11-08 · คำสั่ง user
--
-- ที่มา (user 08/11 · /pm-forecast แท็บยอดผลิตสะสม):
--   "ยอดผลิตสะสมของแม่พิมพ์ตอนนี้เหมือนนับรวมกับเครื่องจักร ผิดนะ ... ไลน์ 800 ผลิตงาน a100, b100
--    เครื่องทำ 200 shot แต่ a ไม่ได้เท่ากับ 200"
--   ⇒ แม่พิมพ์ทำงานเฉพาะตอนผลิต "พาร์ทของมัน" — ต้องนับจาก MAT ของชุด ไม่ใช่ยอดทั้งไลน์
--   วัดจริง 08/11 (120 วัน): ชุด EB3B-41108A70 AA/71AA ยอดไลน์ที่จอเคยโชว์ 191,190 ชิ้น
--   ยอดของพาร์ทชุดนี้จริง 12,880 ชิ้น (เกินจริง ~15 เท่า)
--
-- คู่กับ pm_usage_daily (รายไลน์ · ไม่แตะ) — เงื่อนไขเดียวกันทุกข้อ: ใบ confirmed · qty (รวมของเสีย) · work_date ของกะ
-- 🔴 ไม่กรองไลน์ — แม่พิมพ์ย้ายไปผลิตไลน์อื่นได้ (ทะเบียนไลน์ของแม่พิมพ์บางชุดไม่ตรงไลน์ที่ผลิตจริง)
-- MAT เทียบแบบ trim + upper (die_sets.mat_no กับ prod_orders.mat_no เป็น text ที่คนกรอก)
--
-- rollback: drop function if exists public.pm_usage_daily_by_mat(integer, text[]);

create or replace function public.pm_usage_daily_by_mat(p_days integer default 120, p_mats text[] default null)
returns table(mat_no text, work_date date, qty numeric, orders integer)
language sql stable security definer
set search_path to 'public'
as $$
  select upper(btrim(po.mat_no))           as mat_no,
         ps.work_date,
         sum(coalesce(po.qty, 0))::numeric  as qty,
         count(*)::integer                  as orders
    from public.prod_orders po
    join public.production_sessions ps on ps.id = po.session_id
   where po.status = 'confirmed'
     and po.mat_no is not null
     and upper(btrim(po.mat_no)) = any (select upper(btrim(m)) from unnest(coalesce(p_mats, '{}'::text[])) m)
     and ps.work_date >= ((now() at time zone 'Asia/Bangkok')::date - greatest(1, least(coalesce(p_days, 120), 730)))
   group by upper(btrim(po.mat_no)), ps.work_date
$$;

grant execute on function public.pm_usage_daily_by_mat(integer, text[]) to anon, authenticated;
comment on function public.pm_usage_daily_by_mat(integer, text[]) is
  'ยอดผลิตรายวันราย MAT (ใบ confirmed · qty รวมของเสีย · ทุกไลน์) — ตัวนับการใช้งานแม่พิมพ์ (คู่กับ pm_usage_daily รายไลน์)';
