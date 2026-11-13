-- 🏭 รวมช่วงหยุดของเครื่องเป็น "ราย เครื่อง × วันทำงาน × กะ × สถานะ" — ให้จอรายงานย้อนหลังไม่ต้องดึงแถวดิบ
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav) · 2026-11-13 · 📄 docs/modules/integration-hub.md §OEE รายจิ๊ก
-- 🔴 RPC แค่ "รวมวินาที/นับครั้ง" — ไม่คิด A/P/Q/OEE (สูตรอยู่ src/utils/machineOee.js ที่เดียว)
-- กะ = กรอบ ESM เวลาไทย: เช้า 08:00–20:00 · ดึก 20:00–08:00 (วันทำงานตัด 08:00) · ช่วงหยุดคร่อมกะ = ตัดแบ่งตามเวลาจริง
-- security invoker (anon อ่านตารางได้อยู่แล้ว) · ย้อน: drop function ท้ายไฟล์

create or replace function public.fn_machine_shift_facts(p_source uuid, p_from timestamptz, p_to timestamptz default now())
returns table (machine_tag text, work_date date, shift text, state text, is_minor boolean, sec numeric, n int)
language sql stable
set search_path = public
as $$
  with ev as (
    select e.machine_tag, e.state, e.is_minor, e.started_at as s,
           coalesce(e.ended_at, e.started_at + make_interval(secs => coalesce(e.duration_sec, 0))) as e
    from public.machine_state_events e
    where e.source_id = p_source and e.started_at < p_to
      and coalesce(e.ended_at, e.started_at) >= p_from - interval '1 day'
  ),
  win as (   -- กรอบกะที่ช่วงนี้แตะ: เริ่มจากต้นกะของ s แล้วไล่ทีละ 12 ชม.
    select ev.*, g as ws, g + interval '12 hours' as we
    from ev,
    lateral generate_series(
      (date_trunc('day', (ev.s at time zone 'Asia/Bangkok') - interval '8 hours') + interval '8 hours'
        + case when extract(hour from (ev.s at time zone 'Asia/Bangkok') - interval '8 hours') >= 12 then interval '12 hours' else interval '0' end)
        at time zone 'Asia/Bangkok',
      ev.e, interval '12 hours') g
    where ev.e > ev.s
  )
  select machine_tag,
         ((ws at time zone 'Asia/Bangkok') - interval '8 hours')::date as work_date,
         case when extract(hour from ws at time zone 'Asia/Bangkok') = 8 then 'day' else 'night' end as shift,
         state, is_minor,
         round(sum(extract(epoch from least(e, we) - greatest(s, ws)))::numeric, 1) as sec,
         count(*) filter (where s >= ws and s < we)::int as n
  from win
  where least(e, we) > greatest(s, ws) and ws >= p_from - interval '12 hours' and ws < p_to
  group by 1, 2, 3, 4, 5
  order by 2, 3, 1, 4
$$;
revoke all on function public.fn_machine_shift_facts(uuid, timestamptz, timestamptz) from public;
grant execute on function public.fn_machine_shift_facts(uuid, timestamptz, timestamptz) to anon, authenticated;

-- ย้อน: drop function if exists public.fn_machine_shift_facts(uuid, timestamptz, timestamptz);
