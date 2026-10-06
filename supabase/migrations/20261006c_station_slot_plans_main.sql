-- 20261006c_station_slot_plans_main.sql · ⚠️ Main project — ชื่อในจอ Supabase "MAIN" (ewhdfqwfwofivojtsizn)
--
-- 🧑‍🤝‍🧑 Manpower Control Board — ช่องตำแหน่งระดับ "จุดงาน" (คำสั่ง user 06/10 "ทำช่องตำแหน่งระดับจุดงานต่อเลย")
--   station_slot_plans = จุดงานนี้ต้องมีคนกี่คน "ต่อกะ" · ไม่ตั้ง = จุดนั้นไม่ถูกนับ (บอร์ดถอยไปใช้ช่องต่อทีม/ std ตามเดิม)
--   ⇒ ตารางว่าง = พฤติกรรมเดิมเป๊ะ
--   ทำไมแยกตาราง ไม่เพิ่มคอลัมน์ใน workstations: workstations ถูกเขียนจาก /line-setup ภายใต้สิทธิ์ของหน้านั้น
--   ส่วนค่านี้เป็นของบอร์ดกำลังคน (คีย์ manpower_board:edit) — คีย์บนจอกับ RLS ต้องเป็นตัวเดียวกัน (กฎเหล็กข้อ 3)
--   ลบจุดงาน = แถวนี้หายตาม (on delete cascade) ไม่ค้างกำพร้า
-- สิทธิ์: has_perm('manpower_board:edit') (seed ไว้แล้วใน 20261006b) · audit fn_audit
-- rollback (ย้อนโค้ดก่อน): drop table if exists public.station_slot_plans;
begin;

create table if not exists public.station_slot_plans (
  station_id uuid primary key references public.workstations(id) on delete cascade,
  per_shift  integer not null check (per_shift >= 0 and per_shift <= 20),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.station_slot_plans enable row level security;
drop policy if exists ssp_read  on public.station_slot_plans;
drop policy if exists ssp_write on public.station_slot_plans;
create policy ssp_read  on public.station_slot_plans for select to authenticated using (true);
create policy ssp_write on public.station_slot_plans for all to authenticated
  using (has_perm('manpower_board:edit')) with check (has_perm('manpower_board:edit'));

do $$
begin
  if exists (select 1 from pg_proc where proname = 'fn_set_updated_at') then
    drop trigger if exists trg_set_updated_at on public.station_slot_plans;
    create trigger trg_set_updated_at before update on public.station_slot_plans
      for each row execute function public.fn_set_updated_at();
  end if;
  if exists (select 1 from pg_proc where proname = 'fn_audit') then
    drop trigger if exists trg_audit on public.station_slot_plans;
    create trigger trg_audit after insert or update or delete on public.station_slot_plans
      for each row execute function public.fn_audit();
  end if;
end $$;

commit;
