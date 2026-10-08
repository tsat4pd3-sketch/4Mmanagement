-- ══ OBEYA จอ SQDCM โหมด "ปี" — สรุปเช็คชื่อ/PPE รายเดือน ฝั่ง Main (MAIN · ewhdfqwfwofivojtsizn) · 2026-09-22 ══
-- คู่กับ 20260922d_obeya_year_rollup_dr.sql (ฝั่ง DR) — แกน S (PPE ครบ) และ M (มาทำงาน) อ่านจาก
-- daily_production_logs ซึ่งเป็นแถวต่อคนต่อวัน (~300 แถว/วัน ⇒ ทั้งปี ~100k แถว) โหลดดิบไม่ได้
-- คืนผลรวมต่อ (เดือน, ไลน์) เท่านั้น · การหารและสถานะทำใน src/utils/obeyaYear.js
-- security invoker = ใช้สิทธิ์ RLS ของคนเรียกตามปกติ (ตารางนี้ authenticated อ่านได้อยู่แล้ว — จอโหมดเดือนอ่านตรง)
-- rollback: drop function public.obeya_attendance_rollup(date, date);

create or replace function public.obeya_attendance_rollup(p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
  from (
    select to_char(work_date, 'YYYY-MM') as m,
           assigned_line as line,
           count(*) as n,
           count(*) filter (where is_present) as present,
           count(*) filter (where is_present and has_helmet and has_boots and has_gloves) as ppe_ok,
           count(*) filter (where has_ot or has_extended_ot) as ot
    from daily_production_logs
    where work_date between p_from and p_to
    group by 1, 2
  ) r;
$$;

revoke all on function public.obeya_attendance_rollup(date, date) from public, anon;
grant execute on function public.obeya_attendance_rollup(date, date) to authenticated;

-- ตรวจ: select jsonb_array_length(obeya_attendance_rollup('2026-01-01','2026-12-31'));
