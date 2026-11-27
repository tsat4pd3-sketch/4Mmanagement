-- 📈 Live Benefits (`/live-benefits` · 2026-11-26) — ฝั่ง DR ("Product DB" · eyhclzkifitbhbljgoav)
-- คู่กับ 20261126_live_benefits_main.sql — ความหมายของ kind/key/n/val ดูหัวไฟล์นั้น
-- DR = anon เสมอ (กฎเหล็ก supabaseDR) ⇒ SECURITY INVOKER · อ่านได้เท่าที่ anon อ่านตารางพวกนี้ได้อยู่แล้ว · คืนแค่ตัวเลขรวม
-- วันทำงานจาก timestamp = (เวลาไทย − 8 ชม.)::date (ตรงกับ getWorkDate())
-- AM แยกจาก PM ด้วย mtn_teams.kind = 'am' (กฎ isAmTeam — ห้าม hardcode 'production')
-- กะของผลตรวจ AM: ตารางไม่มีช่องกะ ⇒ ตรวจ 08:00–19:59 = กะเช้า · นอกนั้น = กะดึก
-- MO แยก 2 ฟอร์ม (FM-JIG-008 / FM-MTN-006) ด้วยกฎ isMtnFormRow ฝั่ง JS — ที่นี่นับรวมใต้ key 'mo_report' (จอเขียนบอก)
--
-- rollback: drop function if exists public.esm_benefits_rollup(date);

create or replace function public.esm_benefits_rollup(p_from date)
returns table(kind text, key text, month_key text, n bigint, val numeric)
language sql stable security invoker set search_path = public as $$
  with i as (
    select i.jig_id,
           ((i.inspected_at at time zone 'Asia/Bangkok') - interval '8 hour') wt,
           exists (select 1 from checklists c join mtn_teams t on t.key = c.department
                   where c.id = i.checklist_id and t.kind = 'am') is_am
    from inspections i
    where i.inspected_at >= (p_from::timestamp + interval '8 hour') at time zone 'Asia/Bangkok'
  ), s as (
    select * from production_sessions
    where work_date >= p_from and status in ('open','pending_close','closed')
  ), mo as (
    select *, to_char(((coalesce(report_at, created_at) at time zone 'Asia/Bangkok') - interval '8 hour'),'YYYY-MM') m
    from mtn_orders
    where coalesce(report_at, created_at) >= (p_from::timestamp + interval '8 hour') at time zone 'Asia/Bangkok'
      and status <> 'cancelled'
  )
  -- ใบรายงานการผลิตประจำกะ = 1 แผ่นต่อไลน์ × กะ
  select 'paper'::text, 'daily_production_report'::text, to_char(s.work_date,'YYYY-MM'), count(*)::bigint, count(*)::numeric
  from s group by 3
  union all
  -- AM = เดือนละใบต่อเครื่อง × กะ · ครั้งที่บันทึก = ครั้งที่ตรวจ
  select 'paper', 'xlsx_am_monthly', to_char(i.wt,'YYYY-MM'),
         count(distinct (i.jig_id, case when extract(hour from i.wt + interval '8 hour') between 8 and 19 then 'D' else 'N' end))::bigint,
         count(*)::numeric
  from i where i.is_am group by 3
  union all
  -- PM ช่าง FM-JIG-003 = 1 แผ่นต่อครั้งที่ตรวจ
  select 'paper', 'pm_jig', to_char(i.wt,'YYYY-MM'), count(*)::bigint, count(*)::numeric
  from i where not i.is_am group by 3
  union all
  select 'paper', 'mo_report', mo.m, count(*)::bigint, count(*)::numeric from mo group by 3
  union all
  select 'paper', 'prod_problem_report', to_char(r.work_date,'YYYY-MM'), count(*)::bigint, count(*)::numeric
  from prod_problem_reports r where r.work_date >= p_from and coalesce(r.is_active, true) group by 3
  union all
  select 'paper', 'scrap_report', to_char(r.report_date,'YYYY-MM'), count(*)::bigint, count(*)::numeric
  from scrap_reports r where r.report_date >= p_from group by 3
  union all
  -- ถังแดง/เหลือง = ใบรายการต่อไลน์ × วัน · ครั้งที่บันทึก = รายการชิ้นงาน
  select 'paper', 'qbin_' || q.bin, to_char(q.work_date,'YYYY-MM'),
         count(distinct (q.line_name, q.work_date))::bigint, count(*)::numeric
  from quality_bin_records q
  where q.work_date >= p_from and q.bin in ('red','yellow') and coalesce(q.is_active, true) group by 2, 3
  union all
  select 'paper', 'improvement_a3', to_char(((x.created_at at time zone 'Asia/Bangkok') - interval '8 hour'),'YYYY-MM'),
         count(*)::bigint, count(*)::numeric
  from improvements x where x.created_at >= (p_from::timestamp + interval '8 hour') at time zone 'Asia/Bangkok' group by 3
  union all
  -- ⏱ แจ้งซ่อม → ช่างรับงาน (นาที)
  select 'flow', 'mo_accept_min', mo.m, count(*)::bigint,
         round((percentile_cont(0.5) within group (order by extract(epoch from (mo.accept_at - mo.report_at)) / 60))::numeric, 0)
  from mo where mo.accept_at is not null and mo.report_at is not null and mo.accept_at >= mo.report_at group by 3
  union all
  -- ⏱ แจ้งซ่อม → ซ่อมเสร็จ (นาที)
  select 'flow', 'mo_fix_min', mo.m, count(*)::bigint,
         round((percentile_cont(0.5) within group (order by extract(epoch from (mo.repair_done_at - mo.report_at)) / 60))::numeric, 0)
  from mo where mo.repair_done_at is not null and mo.report_at is not null and mo.repair_done_at > mo.report_at group by 3
  union all
  -- 🔗 ใบซ่อมที่เปิดต่อจากใบ downtime / ผลตรวจ AM (ไม่ต้องเขียนอาการซ้ำ) · n = ทั้งหมด · val = ที่เปิดต่อ
  select 'flow', 'mo_linked', mo.m, count(*)::bigint,
         count(*) filter (where mo.source_downtime_id is not null or mo.source_inspection_id is not null)::numeric
  from mo group by 3
  union all
  -- ⏱ ปิดกะหลังเลิกกะ (ชั่วโมง)
  select 'flow', 'close_lag_h', to_char(s.work_date,'YYYY-MM'), count(*)::bigint,
         round((percentile_cont(0.5) within group (order by
           extract(epoch from (s.closed_at - ((s.work_date + s.start_time) at time zone 'Asia/Bangkok'))) / 3600 - s.shift_min / 60.0))::numeric, 1)
  from s where s.closed_at is not null and s.start_time is not null and s.shift_min > 0 group by 3
$$;

revoke all on function public.esm_benefits_rollup(date) from public;
grant execute on function public.esm_benefits_rollup(date) to anon, authenticated;
