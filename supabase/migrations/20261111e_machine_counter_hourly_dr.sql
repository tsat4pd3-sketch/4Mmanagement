-- 🔢 สรุปชิ้นรายชั่วโมงจาก machine_counters — ให้จอเทียบ "ข้อมูลจากเครื่อง" ไม่ต้องดึงแถวรายนาที
-- Project: DR ("Product DB" · eyhclzkifitbhbljgoav) · 2026-11-11 · 📄 docs/modules/integration-hub.md §OEE Line D3
-- เหตุผล: 2 เครื่อง × 1440 นาที × 7 วัน ≈ 20,000 แถว (ชนเพดาน 1000/คิวรี + กิน egress) → รายชั่วโมงเหลือ ~340 แถว
-- 🔴 RPC แค่ "รวม" — ไม่คิด OEE/อัตรา (กฎ OBEYA: RPC ห้ามคำนวณ KPI · JS จัดถังกะเอง)
-- ขอบกะ ESM (08:00/20:00 ไทย) ตรงกับต้นชั่วโมงพอดี ⇒ ถังรายชั่วโมงไม่คร่อมกะ
-- security invoker (anon อ่านตารางได้อยู่แล้ว) · ย้อน: drop function ท้ายไฟล์

create or replace function public.fn_machine_counter_hourly(p_source uuid, p_from timestamptz, p_to timestamptz default now())
returns table (machine_tag text, hour_at timestamptz, qty bigint, ng bigint, minutes int)
language sql stable
set search_path = public
as $$
  select c.machine_tag, date_trunc('hour', c.counted_at) as hour_at,
         sum(c.delta)::bigint, sum(c.ng_delta)::bigint, count(*)::int
  from public.machine_counters c
  where c.source_id = p_source and c.counted_at >= p_from and c.counted_at < p_to
  group by 1, 2
  order by 2, 1
$$;
revoke all on function public.fn_machine_counter_hourly(uuid, timestamptz, timestamptz) from public;
grant execute on function public.fn_machine_counter_hourly(uuid, timestamptz, timestamptz) to anon, authenticated;

-- ย้อน: drop function if exists public.fn_machine_counter_hourly(uuid, timestamptz, timestamptz);
