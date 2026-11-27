-- ⚡ Project: DR ("Product DB" · eyhclzkifitbhbljgoav) — 2026-11-27 คำสั่ง user "ทำทุกข้อ เปิดช่องเกณฑ์ไว้ว่างก่อน"
-- ① เกณฑ์ "รอ" ต่อมิเตอร์ (kW ต่ำกว่านี้ = รอ/เดินตัวเปล่า) · ว่าง = ไม่ตัดสิน (บอร์ดขึ้น "ออนไลน์" เหมือนเดิม · ชั่วโมงทำงานเขียนว่ายังไม่ตั้ง)
-- ② แรงดันรายเฟสเก็บเป็นประวัติรายนาที (v1-v3 · ingest v11) — เริ่มนับจากวันที่ deploy · ย้อนหลังไม่ได้ · เก็บ 7 วันเหมือนค่าอื่น
-- ③ แจ้งเตือนที่ยังค้าง — เหตุการณ์ล่าสุดต่อ (ตู้, รหัส) เป็น START / ขาดการสื่อสาร ที่ยังไม่มี CLEAR / กลับมาออนไลน์ ตามมา
-- ย้อน: alter table energy_live_meters drop column idle_kw; alter table energy_readings drop column v1, drop column v2, drop column v3;
--       drop function fn_energy_open_alerts(int);
alter table public.energy_live_meters add column if not exists idle_kw numeric check (idle_kw is null or idle_kw >= 0);
alter table public.energy_readings
  add column if not exists v1 numeric, add column if not exists v2 numeric, add column if not exists v3 numeric;

create or replace function public.fn_energy_open_alerts(p_days int default 30)
 returns table (scope_name text, code text, level text, message text, ev_time timestamptz)
 language sql stable as $$
  select x.scope_name, x.code, x.level, x.message, x.ev_time from (
    select distinct on (e.scope_name, case when e.code in ('offline', 'online') then 'offline' else e.code end)
           e.scope_name, e.code, e.kind, e.level, e.message, e.ev_time
      from public.energy_events e
     where e.ev_time > now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 30)))
       and (e.kind in ('START', 'CLEAR') or e.code in ('offline', 'online'))
     order by e.scope_name, case when e.code in ('offline', 'online') then 'offline' else e.code end, e.ev_time desc
  ) x
  where x.kind = 'START' or x.code = 'offline'
  order by x.ev_time desc;
$$;
grant execute on function public.fn_energy_open_alerts(int) to anon, authenticated;
